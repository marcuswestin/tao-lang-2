import { CLI, Errors, FS, HCI, Platform, Repo } from '@shared'
import { type LaneInspection, type MachineLane, MachineLanes } from '@verification/MachineLanes'

type Observation = { at: string; available: boolean; loadAverage: number; activePeers: string[] }
type StageResult = { name: 'language' | 'studio-preview'; exitCode: number }
type PerformanceCheckReport = {
  status: 'passed' | 'failed' | 'inconclusive'
  artifactRoot: string
  reasons: string[]
  observations: Observation[]
  stages: StageResult[]
}

type Dependencies = {
  acquire: () => Promise<MachineLane>
  inspect: () => Promise<LaneInspection>
  cpuCount: () => number
  loadAverage: () => number
  now: () => string
  monitor: (sample: () => Promise<void>) => () => Promise<void>
  runLanguage: (env: Record<string, string>) => Promise<number>
  runStudio: (runId: string, env: Record<string, string>) => Promise<number>
  qualifyStudio: (artifactRoot: string) => Promise<number>
  writeReport: (report: PerformanceCheckReport) => Promise<void>
  log: (message: string) => void
}

/** PerformanceCheck owns sequential timing protection under one machine-wide exclusive lease. */
export const PerformanceCheck = { run } as const

const quietLoadRatio = 0.5
const studioFile = 'packages/ides/studio-tooling/studio-smoke/studio-preview-latency.test.ts'

const defaults: Dependencies = {
  acquire: async () => await MachineLanes.acquire({ lane: 'performance-check', repositoryRoot: Repo.getRoot() }),
  inspect: async () => {
    // inspectLanes treats a missing registry as an empty one for ordinary commands. Timing proof
    // requires an existing, inspectable registry and must never use that availability fallback.
    if (!await FS.exists(MachineLanes.registryRoot())) {
      return { available: false, lanes: [] }
    }
    return await MachineLanes.inspectLanes()
  },
  cpuCount: Platform.cpuCount,
  loadAverage: Platform.loadAverage,
  now: () => new Date().toISOString(),
  monitor: sample => {
    let pending = Promise.resolve()
    let sampling = false
    const timer = setInterval(() => {
      if (!sampling) {
        sampling = true
        pending = sample().finally(() => {
          sampling = false
        })
      }
    }, 1_000)
    return async () => {
      clearInterval(timer)
      await pending
    }
  },
  runLanguage: async env => {
    const result = await CLI.run('bun', {
      args: ['run', 'packages/cli/dev-cli/dev-cli-src/performance/language-performance.ts'],
      env,
      stdio: 'inherit',
    })
    return result.error === undefined ? result.exitCode ?? 1 : 1
  },
  runStudio: async (runId, env) => {
    // This enters StudioSmoke directly, rather than a gate/test runner that would register a
    // second slot lane and wait forever for the exclusive lease held by its own parent.
    const result = await CLI.run('bun', {
      args: ['run', 'packages/cli/dev-cli/dev-cli-src/dev.ts', 'studio-smoke', studioFile, '--run-id', runId],
      env,
      stdio: 'inherit',
    })
    return result.error === undefined ? result.exitCode ?? 1 : 1
  },
  qualifyStudio: async artifactRoot => {
    const { StudioPreviewPerformance } = await import('@studio-tooling/StudioPreviewPerformance')
    const breaches = await StudioPreviewPerformance.evaluateArtifacts(
      artifactRoot,
      StudioPreviewPerformance.ceilings,
      StudioPreviewPerformance.sourceCeilings,
    )
    return breaches.length === 0 ? 0 : 1
  },
  writeReport: async report => {
    await FS.mkdir(report.artifactRoot)
    await FS.writeJson(FS.resolvePath('summary.json', report.artifactRoot), report)
  },
  log: HCI.writeLine,
}

async function run(dependencies: Dependencies = defaults): Promise<number> {
  const runId = `performance-${Platform.randomUUID()}`
  const report: PerformanceCheckReport = {
    status: 'inconclusive',
    artifactRoot: Repo.resolvePath(`.artifacts/performance/${runId}`),
    reasons: [],
    observations: [],
    stages: [],
  }
  let lane: MachineLane | undefined
  let exclusive: Awaited<ReturnType<MachineLane['acquireExclusive']>>
  let stopMonitor: (() => Promise<void>) | undefined
  const reason = (message: string) => {
    if (!report.reasons.includes(message)) {
      report.reasons.push(message)
    }
  }
  const sample = async (admission = false) => {
    try {
      const inspection = await dependencies.inspect()
      const loadAverage = dependencies.loadAverage()
      const cpuCount = dependencies.cpuCount()
      const peers = inspection.lanes.filter(peer => lane === undefined || peer.id !== lane.id)
      const activePeers = peers.filter(peer => admission || peer.slots > 0).map(peer => peer.lane)
      report.observations.push({ at: dependencies.now(), available: inspection.available, loadAverage, activePeers })
      if (!inspection.available || (lane !== undefined && !inspection.lanes.some(peer => peer.id === lane?.id))) {
        reason('The machine lane registry is unavailable or lost this performance registration.')
      }
      if (activePeers.length > 0) {
        reason(`Other machine lanes were active: ${activePeers.join(', ')}.`)
      }
      if (
        !Number.isFinite(loadAverage) || loadAverage < 0 || !Number.isFinite(cpuCount) || cpuCount < 1
        || loadAverage > cpuCount * quietLoadRatio
      ) {
        reason(`The machine is not quiet: load ${loadAverage} on ${cpuCount} CPUs (maximum ratio ${quietLoadRatio}).`)
      }
    } catch (error) {
      reason(`Machine activity could not be inspected: ${Errors.formatForUser(error)}`)
    }
  }
  try {
    dependencies.log('performance-check: checking quiet-machine admission')
    await sample(true)
    if (report.reasons.length === 0) {
      lane = await dependencies.acquire()
      if (lane.id === undefined) {
        reason('The performance lane could not register in the machine-wide registry.')
      } else {
        dependencies.log('performance-check: acquiring the exclusive machine lease')
        exclusive = await lane.acquireExclusive()
        if (exclusive === undefined) {
          reason('The exclusive machine lease could not be acquired.')
        }
      }
      // Close the race between admission and obtaining exclusivity. Queued zero-slot peers do
      // not contaminate a run; the exclusive lease prevents them from starting any work.
      await sample()
      if (report.reasons.length === 0) {
        stopMonitor = dependencies.monitor(async () => await sample())
        const env = {
          [MachineLanes.LANE_ID_ENV_KEY]: lane.id!,
          TAO_STUDIO_PREVIEW_PERFORMANCE: 'true',
          TAO_STUDIO_PREVIEW_PERFORMANCE_ARTIFACT_ROOT: report.artifactRoot,
        }
        dependencies.log('performance-check: measuring language services')
        report.stages.push({ name: 'language', exitCode: await dependencies.runLanguage(env) })
        await sample()
        if (report.reasons.length === 0) {
          dependencies.log('performance-check: measuring real Studio preview interactions')
          const studioExit = await dependencies.runStudio(runId, env)
          const qualificationExit = studioExit === 0
            ? await dependencies.qualifyStudio(report.artifactRoot)
            : studioExit
          report.stages.push({ name: 'studio-preview', exitCode: qualificationExit })
          await sample()
        }
      }
    }
  } catch (error) {
    reason(`Performance measurement did not complete: ${Errors.formatForUser(error)}`)
  } finally {
    try {
      await stopMonitor?.()
    } catch (error) {
      reason(`Machine activity monitoring did not finish: ${Errors.formatForUser(error)}`)
    } finally {
      try {
        await exclusive?.release()
      } catch (error) {
        reason(`The exclusive machine lease could not be released: ${Errors.formatForUser(error)}`)
      } finally {
        try {
          await lane?.release()
        } catch (error) {
          reason(`The performance lane registration could not be released: ${Errors.formatForUser(error)}`)
        }
      }
    }
  }
  report.status = report.reasons.length > 0 || report.stages.length !== 2
    ? 'inconclusive'
    : report.stages.some(stage => stage.exitCode !== 0)
    ? 'failed'
    : 'passed'
  await dependencies.writeReport(report)
  dependencies.log(
    `performance-check: ${report.status}; evidence ${FS.resolvePath('summary.json', report.artifactRoot)}`,
  )
  for (const message of report.reasons) {
    dependencies.log(`  ${message}`)
  }
  return report.status === 'passed' ? 0 : report.status === 'inconclusive' ? 2 : 1
}
