import { Errors } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import {
  type AdmissionExperimentDependencies,
  assertMachineQuiet,
  positionalRoots,
  renderAdmissionReport,
  runAdmissionExperiment,
} from '../dev-src/performance/admission-experiment'

type LaneScript = {
  elapsedMs: number
  failedGates?: readonly string[]
  peakLanes?: number
  peakLoadAverage?: number
}

/**
 * The fake runs no lanes. It returns a scripted elapsed time per checkout, which is what the real
 * experiment reads out of each lane's own `summary.json` rather than measuring itself — so the
 * arithmetic under test here is exactly the arithmetic that will run against real lanes.
 */
function fakeDependencies(options: {
  lanes?: readonly { lane: string; repositoryRoot: string }[]
  loadAverage?: number
  scripts?: Record<string, LaneScript>
} = {}) {
  const calls: Array<{ args: readonly string[]; cwd?: string }> = []
  let clock = 0
  const dependencies: AdmissionExperimentDependencies = {
    activeLanes: async () => options.lanes ?? [],
    cpuCount: () => 18,
    loadAverage: () => options.loadAverage ?? 1,
    now: () => {
      clock += 1_000
      return new Date(clock)
    },
    readJson: async <ValueT>(path: string) => {
      const root = Object.keys(options.scripts ?? {}).find(candidate => path.includes(candidate))
      if (root === undefined) {
        Errors.throwUserInput(`no scripted summary for ${path}`)
      }
      const script = (options.scripts ?? {})[root] as LaneScript
      return {
        contention: { peakLanes: script.peakLanes ?? 1, peakLoadAverage: script.peakLoadAverage ?? 4 },
        elapsedMs: script.elapsedMs,
        gates: (script.failedGates ?? []).map(name => ({ name, status: 'failed' })),
        status: (script.failedGates ?? []).length > 0 ? 'failed' : 'passed',
      } as ValueT
    },
    run: async (_command, spec) => {
      calls.push({ args: spec.args ?? [], cwd: spec.cwd })
      return {
        args: [...(spec.args ?? [])],
        command: 'x',
        cwd: spec.cwd,
        error: undefined,
        exitCode: 0,
        signal: null,
        stderr: '',
        stdout: '',
      }
    },
  }
  return { calls, dependencies }
}

Describe('admission experiment', () => {
  // The registry cannot certify a quiet machine on its own: only top-level lanes register, and this
  // machine was measured at load 22.2 with zero registered lanes. Both questions get asked.
  Test('refuses to measure while a lane is registered', async () => {
    const fake = fakeDependencies({ lanes: [{ lane: 'verify', repositoryRoot: '/repo/other' }] })
    await Expect(assertMachineQuiet(fake.dependencies)).rejects.toThrow('The machine is not quiet')
  })

  Test('refuses to measure on a loaded machine even when no lane is registered', async () => {
    const fake = fakeDependencies({ loadAverage: 22.2 })
    await Expect(assertMachineQuiet(fake.dependencies)).rejects.toThrow('does not register')
  })

  Test('admits a quiet machine', async () => {
    const fake = fakeDependencies({ loadAverage: 1.2 })
    await Expect(assertMachineQuiet(fake.dependencies)).resolves.toBeUndefined()
  })

  // The bar is written about the earliest completions, because the whole point of a queue is that
  // the last lane waits: a median over all ten would fail a policy that is working as designed.
  Test('measures the bar over the first completions rather than over every lane', async () => {
    const fake = fakeDependencies({
      scripts: {
        '/repo/a': { elapsedMs: 40_000 },
        '/repo/b': { elapsedMs: 44_000 },
        '/repo/c': { elapsedMs: 48_000 },
        '/repo/d': { elapsedMs: 300_000 },
      },
    })

    const report = await runAdmissionExperiment(
      { lanes: 4, repeats: 1, repositoryRoots: ['/repo/a', '/repo/b', '/repo/c', '/repo/d'] },
      fake.dependencies,
    )

    Expect(report.trial.firstCompletionsMedianMs).toBe(44_000)
    Expect(report.trial.summary.medianMs).toBe(46_000)
    Expect(report.contentionRatio).toBe(1.1)
    Expect(report.acceptanceMet).toBe(true)
  })

  // A configuration that finishes sooner while starving tests into false reds is not better, and
  // completion time cannot see the difference — so a failing gate fails the acceptance outright.
  Test('fails acceptance on a starved gate even when every lane finished quickly', async () => {
    const fake = fakeDependencies({
      scripts: {
        '/repo/a': { elapsedMs: 40_000 },
        '/repo/b': { elapsedMs: 41_000, failedGates: ['dev'] },
      },
    })

    const report = await runAdmissionExperiment(
      { lanes: 2, repeats: 1, repositoryRoots: ['/repo/a', '/repo/b'] },
      fake.dependencies,
    )

    Expect(report.contentionRatio).toBeLessThan(1.5)
    Expect(report.trial.falseReds).toBe(1)
    Expect(report.acceptanceMet).toBe(false)
    Expect(renderAdmissionReport(report)).toContain('FAIL b: dev')
  })

  // Found by running the command against a checkout that does not exist: every lane wrote no
  // summary, the medians came out 0.0s, and the acceptance read as met. Nothing is worse in a
  // measurement tool than reporting success from an absence of measurement.
  Test('never meets the bar when a lane wrote no summary at all', async () => {
    const fake = fakeDependencies({ scripts: {} })

    const report = await runAdmissionExperiment(
      { lanes: 2, repeats: 1, repositoryRoots: ['/repo/a', '/repo/b'] },
      fake.dependencies,
    )

    Expect(report.trial.unmeasured).toBe(2)
    Expect(report.acceptanceMet).toBe(false)
    Expect(renderAdmissionReport(report)).toContain('nothing here is a measurement')
  })

  // Filtering only on a leading `--` left `verify` from `--lane verify` looking exactly like a
  // checkout path, so it joined the list and the run measured a different number of lanes than it
  // was asked for. Found by reading the smoke test's arguments back.
  Test('does not mistake a flag value for a checkout path', () => {
    Expect(positionalRoots(['/repo/a', '--lane', 'verify', '--lanes', '10', '--repeats', '3'])).toEqual(['/repo/a'])
    Expect(positionalRoots(['--provision', '10'])).toEqual([])
    Expect(positionalRoots(['--allow-busy-machine', '/repo/a'])).toEqual(['/repo/a'])
  })

  Test('refuses to start without one checkout per lane', async () => {
    const fake = fakeDependencies()
    await Expect(
      runAdmissionExperiment({ lanes: 4, repeats: 1, repositoryRoots: ['/repo/a'] }, fake.dependencies),
    ).rejects.toThrow('one checkout per lane')
  })

  // A recorded green tree would let a lane finish without doing the work, which measures nothing
  // about how the machine shares itself.
  Test('runs every lane with --no-cache', async () => {
    const fake = fakeDependencies({ scripts: { '/repo/a': { elapsedMs: 10_000 } } })

    await runAdmissionExperiment({ lanes: 1, repeats: 1, repositoryRoots: ['/repo/a'] }, fake.dependencies)

    Expect(fake.calls.every(call => call.args.includes('--no-cache'))).toBe(true)
  })
})
