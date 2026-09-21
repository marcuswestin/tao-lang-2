import { FS } from '@shared'
import { Deferred, Describe, Expect, mkTestDir, settle, Test, until } from '@shared/test'
import { runGates } from '../dev-src/repository-tests/GateRunner'
import type { GeneratedEvidence, GeneratedOutput } from '../dev-src/repository-tests/GeneratedEvidence'
import { GreenTree } from '../dev-src/repository-tests/GreenTree'
import { MachineLanes } from '../dev-src/repository-tests/MachineLanes'
import { RunArtifacts } from '../dev-src/repository-tests/RunArtifacts'
import { classifyFailure, formatGateSummary, gateExitCode } from '../dev-src/repository-tests/RunSummary'
import { WorkGraph } from '../dev-src/repository-tests/WorkGraph'

type GateScript = Record<string, { exitCode: number; output: string }>

/**
 * IDLE_MACHINE is the precondition these tests have always meant. A run's contention verdict turns
 * on the host's load average, and a contended run warns about it and declines to teach the timings
 * store — correct behavior that fails any assertion written for a quiet machine. Pinning the
 * reading states the precondition instead of inheriting whatever the other worktrees on this host
 * are doing; `CONTENDED_MACHINE` pins the other side, so both verdicts are covered deliberately.
 */
const IDLE_MACHINE = () => 0
const CONTENDED_MACHINE = () => 1_000

async function run(gates: readonly string[], script: GateScript, extra: Record<string, unknown> = {}) {
  const root = await mkTestDir('tao-gate-runner-')
  try {
    const started: string[] = []
    const summary = await runGates({
      gates,
      jobs: 2,
      logRoot: FS.resolvePath('logs', root),
      machineLoadAverage: IDLE_MACHINE,
      registryRoot: FS.resolvePath('registry', root),
      repositoryRoot: root,
      runGate: async (name, logPath) => {
        started.push(name)
        const result = script[name] ?? { exitCode: 0, output: '' }
        await FS.writeText(logPath, result.output)
        return result
      },
      ...extra,
    })
    return { root, started, summary }
  } finally {
    await FS.remove(root)
  }
}

/**
 * A registry holding live leases that are not this process is what other worktrees' lanes look like
 * from here, and it is the only input that makes a lane narrow itself and call itself contended.
 * Process 1 is the one pid guaranteed alive and not this one.
 */
async function busyRegistryRoot(laneCount = 1): Promise<string> {
  const registryRoot = await mkTestDir('tao-gate-runner-lanes-')
  for (let index = 0; index < laneCount; index += 1) {
    await FS.writeJson(FS.resolvePath(`neighbour-${index}.json`, registryRoot), {
      lane: 'verify',
      pid: 1,
      repositoryRoot: `/another-worktree-${index}`,
      maxSlots: 64,
      slots: 0,
      startedAt: new Date().toISOString(),
    })
  }
  return registryRoot
}

Describe('repository gate runner', () => {
  Test('reports every gate with its status, cost, and log path', async () => {
    const { summary } = await run(['_repo-lint', '_typecheck'], {})

    Expect(summary.status).toBe('passed')
    Expect(summary.version).toBe(2)
    Expect(summary.lane).toBe('verify')
    Expect(summary.gates.map(gate => gate.name)).toEqual(['_repo-lint', '_typecheck'])
    Expect(summary.gates.every(gate => gate.status === 'passed')).toBe(true)
    Expect(summary.gates.every(gate => gate.logPath !== undefined)).toBe(true)
    Expect(gateExitCode(summary)).toBe(0)
  })

  Test('fails the wrapper when one gate fails, never hiding its status', async () => {
    const { summary } = await run(['_repo-lint', '_typecheck'], {
      _typecheck: { exitCode: 2, output: 'error TS2345: bad argument' },
    })

    Expect(summary.status).toBe('failed')
    Expect(gateExitCode(summary)).toBe(1)
    Expect(summary.gates.find(gate => gate.name === '_typecheck')?.exitCode).toBe(2)
    Expect(summary.gates.find(gate => gate.name === '_repo-lint')?.status).toBe('passed')
  })

  Test('names the first actionable failure in declaration order', async () => {
    const { summary } = await run(['_repo-lint', '_typecheck', 'dead-exports'], {
      'dead-exports': { exitCode: 1, output: 'unreferenced export' },
      _typecheck: { exitCode: 2, output: 'error TS2345: bad argument' },
    })

    Expect(summary.firstFailure?.name).toBe('_typecheck')
    Expect(summary.firstFailure?.output).toContain('error TS2345')
    Expect(formatGateSummary(summary)).toContain('First failure — _typecheck')
  })

  Test('expands the test marker into suite nodes instead of running it as a recipe', async () => {
    // `_test` in a lane's list is not a recipe: `just _test` is never run, and the marker is
    // replaced by one node per suite, each reporting under the suite it belongs to.
    const { started, summary } = await run(['_repo-lint', '_test'], {
      _test: { exitCode: 1, output: 'a recipe that must never run' },
    })

    Expect(started).toContain('_repo-lint')
    Expect(started).not.toContain('_test')
    Expect(summary.gates.map(gate => gate.name)).not.toContain('_test')
    Expect(summary.gates.map(gate => gate.name)).toContain('_repo-lint')
    Expect(summary.gates.some(gate => gate.suite === 'tao-apps')).toBe(true)
    Expect(started).toContain('tao-apps')
  })

  Test('fails a suite node that exited zero without writing the results it promised', async () => {
    // A suite process that leaves no structured report proved nothing, whatever it exited. The
    // summary has to say so itself: reading the reports after rolling the run up would publish
    // `passed` and then record the failure, and the lane would disagree with its own ledger.
    const { summary } = await run(['_test'], {})
    const performanceChecks = summary.gates.find(gate => gate.name === 'performance-checks')

    Expect(summary.status).toBe('failed')
    Expect(performanceChecks?.status).toBe('failed')
    Expect(performanceChecks?.reason).toContain('test result report unavailable')
  })

  Test('reports a skipped gate as skipped, with why, and never as passed', async () => {
    const { summary } = await run(['_repo-lint'], {}, {
      skipped: ['studio-smoke=slow lane; run just studio-smoke or just verify-full'],
    })

    const skipped = summary.gates.find(gate => gate.name === 'studio-smoke')
    Expect(skipped?.status).toBe('skipped')
    Expect(skipped?.reason).toBe('slow lane; run just studio-smoke or just verify-full')
    Expect(summary.gates.filter(gate => gate.status === 'passed').map(gate => gate.name)).toEqual(['_repo-lint'])
    Expect(formatGateSummary(summary)).toContain('1 passed, 0 failed, 1 skipped')
  })

  Test('skips every catalogued unsandboxed gate before scheduling it', async () => {
    const hostOnly = [
      'studio-smoke',
      'studio-proof-real-app',
      'studio-smoke-simulated-user',
      'keyboard-navigation-smoke',
      'studio-dialog-browser',
      'studio-agent-browser',
      'studio-smoke-native',
      'studio-canary',
    ]
    const { started, summary } = await run(['_repo-lint', ...hostOnly], {}, { skipUnsandboxed: true })

    Expect(started).toEqual(['_repo-lint'])
    Expect(summary.gates.filter(gate => gate.status === 'skipped').map(gate => gate.name)).toEqual(hostOnly)
    Expect(
      summary.gates.filter(gate => gate.status === 'skipped').every(gate =>
        gate.reason?.includes('requires unsandboxed host capabilities')
      ),
    ).toBe(true)
  })

  Test('surfaces warnings a gate printed without failing on them', async () => {
    const { summary } = await run(['_ide-extension-build'], {
      '_ide-extension-build': { exitCode: 0, output: 'Warning: rule declared but never referenced' },
    }, {
      greenTree: {
        captureGenerated: async () => ({
          outputs: {
            'ide-extension': { inputs: 'same-inputs', outputs: 'same-outputs' },
            parser: { inputs: 'parser-inputs', outputs: 'parser-outputs' },
          },
          version: 1,
        }),
        hashTree: async () => 'tree-1',
        lanes: ['verify'],
      },
    })

    Expect(summary.warnings).toEqual(['_ide-extension-build: Warning: rule declared but never referenced'])
    Expect(summary.status).toBe('passed')
    Expect(formatGateSummary(summary)).toContain('! _ide-extension-build: Warning:')
  })

  Test('reports a contended host alongside the gate warnings, and teaches no timings from it', async () => {
    const root = await mkTestDir('tao-gate-runner-contended-')
    const registryRoot = await mkTestDir('tao-gate-runner-contended-lanes-')
    try {
      const summary = await runGates({
        gates: ['_repo-lint'],
        machineCpuCount: 8,
        machineLoadAverage: CONTENDED_MACHINE,
        registryRoot,
        repositoryRoot: root,
        runGate: async (_gate, logPath) => {
          await FS.writeText(logPath, 'Warning: rule declared but never referenced')
          return { exitCode: 0, output: 'Warning: rule declared but never referenced' }
        },
      })

      Expect(summary.status).toBe('passed')
      Expect(summary.warnings).toContain('_repo-lint: Warning: rule declared but never referenced')
      Expect(summary.warnings.some(warning => warning.startsWith('machine contention:'))).toBe(true)
      // Durations measured while the host was busy would teach the next run to expect the wrong
      // thing, so a contended run records none. This is the behavior the idle assertions above
      // would silently invert if the load reading were ever dropped.
      Expect(await FS.exists(FS.resolvePath('.artifacts/timings/durations.json', root))).toBe(false)
    } finally {
      await FS.remove(root)
      await FS.remove(registryRoot)
    }
  })

  Test('runs every gate exactly once, whatever the concurrency', async () => {
    const { started } = await run(['a', 'b', 'c', 'd', 'e'], {})

    Expect(started.toSorted()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  Test('propagates the enclosing lane identity to nested diagnostics', async () => {
    const root = await mkTestDir('tao-gate-runner-lane-env-')
    const registryRoot = FS.resolvePath('registry', root)
    let laneId: string | undefined
    try {
      await runGates({
        gates: ['_doctor-json'],
        registryRoot,
        repositoryRoot: root,
        runGate: async (_name, _logPath, environment) => {
          laneId = environment[MachineLanes.LANE_ID_ENV_KEY]
          return { exitCode: 0, output: '' }
        },
      })

      Expect(laneId).toMatch(/^\d+-[0-9a-f-]+$/u)
    } finally {
      await FS.remove(root)
    }
  })

  Test('writes a JSON summary artifact when one is requested', async () => {
    const root = await mkTestDir('tao-gate-runner-json-')
    try {
      await runGates({
        gates: ['_repo-lint'],
        jsonPath: 'summary.json',
        logRoot: FS.resolvePath('logs', root),
        registryRoot: FS.resolvePath('registry', root),
        repositoryRoot: root,
        runGate: async () => ({ exitCode: 0, output: '' }),
      })

      const written = await FS.readJson<{ status: string; version: number }>(FS.resolvePath('summary.json', root))
      Expect(written.version).toBe(2)
      Expect(written.status).toBe('passed')
    } finally {
      await FS.remove(root)
    }
  })

  Test('leaves every run the same trail: per-gate logs, a summary, and a latest link', async () => {
    const root = await mkTestDir('tao-gate-runner-artifacts-')
    try {
      const summary = await runGates({
        gates: ['_repo-lint'],
        lane: 'check',
        registryRoot: FS.resolvePath('registry', root),
        repositoryRoot: root,
        runGate: async () => ({ exitCode: 0, output: 'lint ok\n' }),
      })

      Expect(FS.relativePath(root, summary.logRoot).startsWith('.artifacts/logs/check/')).toBe(true)
      Expect(await FS.readText(FS.resolvePath('repo-lint.log', summary.logRoot))).toBe('lint ok\n')
      const written = await FS.readJson<{ lane: string }>(FS.resolvePath('summary.json', summary.logRoot))
      Expect(written.lane).toBe('check')
      const latest = FS.resolvePath('.artifacts/logs/check/latest', root)
      Expect(await FS.realPath(latest)).toBe(await FS.realPath(summary.logRoot))
      Expect(await FS.readText(FS.resolvePath('repo-lint.log', latest))).toBe('lint ok\n')
    } finally {
      await FS.remove(root)
    }
  })

  Test('publishes a gate log as that gate finishes, before the lane finishes', async () => {
    const root = await mkTestDir('tao-gate-runner-live-log-')
    const held = Deferred()
    try {
      const finished = runGates({
        gates: ['first', 'held'],
        jobs: 2,
        logRoot: FS.resolvePath('logs', root),
        registryRoot: FS.resolvePath('registry', root),
        repositoryRoot: root,
        runGate: async name => {
          if (name === 'held') {
            await held.promise
          }
          return { exitCode: 0, output: `${name} output\n` }
        },
      })

      const firstLog = FS.resolvePath('logs/first.log', root)
      // Waiting for the file to exist and then reading it is a race the lane loses under load: the
      // path appears when the write opens, not when it lands, so the read returns an empty file and
      // the assertion blames the lane for the test's own timing. Wait for the write to land, then
      // assert what landed — waiting for the exact bytes instead would report a lane that published
      // the wrong output as a timeout, which says nothing about what went wrong.
      await until(async () => await FS.isFile(firstLog) && (await FS.readText(firstLog)).length > 0, {
        description: 'the completed gate log to be published',
      })
      Expect(await FS.readText(firstLog)).toBe('first output\n')
      Expect(await FS.isFile(FS.resolvePath('logs/summary.json', root))).toBe(false)

      held.resolve()
      Expect((await finished).status).toBe('passed')
    } finally {
      held.resolve()
      await FS.remove(root)
    }
  })

  Test('forwards completion only after the announced log path is readable', async () => {
    const root = await mkTestDir('tao-gate-runner-log-order-')
    try {
      const location = RunArtifacts.locate({ lane: 'verify', logRoot: 'logs', repositoryRoot: root })
      const state = WorkGraph.createState({ name: 'gate', run: { args: [], command: 'true' } })
      state.fullOutput = 'finished\n'
      state.status = 'passed'
      await RunArtifacts.assignLogPaths([state], location)
      let readableWhenForwarded = false
      const writer = RunArtifacts.liveWriter(location, event => {
        if (event.kind === 'complete') {
          readableWhenForwarded = state.logPath !== undefined && FS.existsSync(state.logPath)
        }
      })

      writer.handle({ kind: 'complete', state })
      await writer.finish()

      Expect(readableWhenForwarded).toBe(true)
      Expect(await FS.readText(state.logPath!)).toBe('finished\n')
    } finally {
      await FS.remove(root)
    }
  })

  Test('records every gate duration in the timings store the next run plans from', async () => {
    const root = await mkTestDir('tao-gate-runner-timings-')
    const registryRoot = await mkTestDir('tao-gate-runner-lanes-')
    try {
      await runGates({
        gates: ['_repo-lint'],
        machineLoadAverage: IDLE_MACHINE,
        registryRoot,
        repositoryRoot: root,
        runGate: async () => ({ exitCode: 0, output: '' }),
      })

      const store = await FS.readJson<{ nodes: Record<string, { samples: number }> }>(
        FS.resolvePath('.artifacts/timings/durations.json', root),
      )
      Expect(store.nodes['_repo-lint']?.samples).toBe(1)
      const history = await FS.readText(FS.resolvePath('.artifacts/timings/history.jsonl', root))
      Expect(history.trim().split('\n').length).toBe(1)
      Expect(history).toContain('"lane":"verify"')
    } finally {
      await FS.remove(root)
      await FS.remove(registryRoot)
    }
  })

  Test('does not teach the timings store from failed or interrupted work', async () => {
    const root = await mkTestDir('tao-gate-runner-failed-timings-')
    const registryRoot = await mkTestDir('tao-gate-runner-lanes-')
    try {
      await runGates({
        gates: ['_repo-lint', '_doctor-json'],
        machineLoadAverage: IDLE_MACHINE,
        registryRoot,
        repositoryRoot: root,
        runGate: async name => ({
          exitCode: name === '_doctor-json' ? 1 : 0,
          output: name === '_doctor-json' ? 'interrupted before completion' : '',
        }),
      })

      const store = await FS.readJson<{ nodes: Record<string, { samples: number }> }>(
        FS.resolvePath('.artifacts/timings/durations.json', root),
      )
      Expect(store.nodes['_repo-lint']?.samples).toBe(1)
      Expect(store.nodes['_doctor-json']).toBeUndefined()
    } finally {
      await FS.remove(root)
      await FS.remove(registryRoot)
    }
  })
})

Describe('gate failure classification', () => {
  Test('separates the failures that need different people to act', () => {
    Expect(classifyFailure('PermissionDenied: copy file android/.idea/migrations.xml'))
      .toBe('sandbox-restriction')
    Expect(classifyFailure("Tao's pinned devenv profile is unavailable.")).toBe('environment-setup')
    Expect(classifyFailure("error: Cannot find module 'ink'")).toBe('environment-setup')
    Expect(classifyFailure('watchman is not installed')).toBe('optional-tooling')
    Expect(classifyFailure('error TS2345: Argument of type string is not assignable')).toBe('repository')
  })

  Test('keeps native host, phase, runtime, probe, assertion, and interruption failures distinct', () => {
    Expect(classifyFailure(
      "Machine resource 'studio-native-host' is busy: studio-canary in /other/worktree (PID 42)",
    )).toBe('native-host-busy')
    Expect(classifyFailure('Hutch install timed out after 30000ms')).toBe('hutch-install-timeout')
    Expect(classifyFailure('Hutch electrobun prepare timed out after 45000ms'))
      .toBe('electrobun-prepare-timeout')
    Expect(classifyFailure('Electrobun exited before writing its runtime probe result.'))
      .toBe('native-runtime-exit')
    Expect(classifyFailure('Timed out waiting for the Electrobun runtime probe.'))
      .toBe('native-probe-timeout')
    Expect(classifyFailure('(fail) native capability\nexpect(received).toBe(expected)'))
      .toBe('test-assertion')
    Expect(classifyFailure('', { interrupted: true })).toBe('user-interruption')
  })

  Test('calls a timeout contention only when the run measured contention', () => {
    const timeout = 'error: Test "renders the board" timed out after 5000ms'
    const shared = MachineLanes.contentionReport({ cpuCount: 8, peakLanes: 2, peakLoadAverage: 20 })
    const alone = MachineLanes.contentionReport({ cpuCount: 8, peakLanes: 1, peakLoadAverage: 3 })

    Expect(classifyFailure(timeout, { contention: shared })).toBe('machine-contention')
    // On a machine this run had to itself the same timeout is the repository's problem, and calling
    // it anything else would excuse a real regression.
    Expect(classifyFailure(timeout, { contention: alone })).toBe('repository')
    Expect(classifyFailure(timeout)).toBe('repository')
    // A busy machine never excuses a wrong answer.
    Expect(classifyFailure('expect(received).toBe(expected)', { contention: shared })).toBe('test-assertion')
  })

  Test('names the kind of failure alongside the exit status', async () => {
    const { summary } = await run(['_typecheck'], {
      _typecheck: { exitCode: 2, output: 'error TS2345: bad argument' },
    })

    Expect(summary.gates[0]?.failureKind).toBe('repository')
    Expect(summary.gates[0]?.reason).toBe('exited 2 (repository)')
  })
})

Describe('gate runner under a shared machine', () => {
  Test('starts nothing while whole lanes are admitted ahead of it, then runs at full width', async () => {
    // The machine admits whole lanes in arrival order, so two neighbours registered before this run
    // put it third in the queue. A queued lane holds no slots at all: it starts no gate, rather than
    // running every gate through a share too narrow to be worth the contention.
    const registryRoot = await busyRegistryRoot(2)
    const root = await mkTestDir('tao-gate-runner-')
    const held = Deferred()
    const started: string[] = []

    const finished = runGates({
      gates: ['_repo-lint', '_dprint-check', '_runtime-pack-check'],
      logRoot: FS.resolvePath('logs', root),
      machineCpuCount: 4,
      registryRoot,
      repositoryRoot: root,
      runGate: async (name, logPath) => {
        started.push(name)
        await held.promise
        await FS.writeText(logPath, '')
        return { exitCode: 0, output: '' }
      },
    })

    await settle(20)
    Expect(started).toEqual([])

    // One lane ahead ends. The queue drains in order, and this lane is admitted whole: every gate
    // it has runs at once, because its width is the machine's rather than a quarter of it.
    await FS.remove(FS.resolvePath('neighbour-0.json', registryRoot))
    await until(() => started.length === 3, {
      description: 'the queued lane to be admitted and run every gate at once',
      // A queued lane polls once a second, because nothing it waits for changes faster than a lane
      // ending; the budget is for that poll and for a busy host, not for a slow condition.
      timeoutMs: 10_000,
    })

    held.resolve()
    const summary = await finished
    Expect(started).toHaveLength(3)
    Expect(summary.status).toBe('passed')
    // The wait itself is reported rather than swallowed; what the broker said about it — the
    // position and the lanes ahead — is asserted where the broker forms it, in `machine-lanes`.
    Expect(summary.gates.flatMap(gate => gate.waits ?? []).length).toBeGreaterThan(0)
    await FS.remove(root)
    await FS.remove(registryRoot)
  })

  Test('does not teach the timings store how slow a shared machine was', async () => {
    const registryRoot = await busyRegistryRoot()
    const root = await mkTestDir('tao-gate-runner-')

    await runGates({
      gates: ['_repo-lint'],
      registryRoot,
      repositoryRoot: root,
      runGate: async () => ({ exitCode: 0, output: '' }),
    })

    // Ordering falls back to `cost` when a node has no measured history. An estimate learned from a
    // contended run has no fallback: it mis-orders every later run in this checkout.
    Expect(await FS.exists(FS.resolvePath('.artifacts/timings/durations.json', root))).toBe(false)
    await FS.remove(root)
    await FS.remove(registryRoot)
  })

  Test('re-runs a gate that timed out under contention and reports that it took a retry', async () => {
    const registryRoot = await busyRegistryRoot()
    const root = await mkTestDir('tao-gate-runner-')
    let attempts = 0

    const summary = await runGates({
      gates: ['_repo-lint'],
      logRoot: FS.resolvePath('logs', root),
      registryRoot,
      repositoryRoot: root,
      runGate: async (_name, logPath) => {
        attempts += 1
        const result = attempts === 1
          ? { exitCode: 1, output: 'error: Test "renders" timed out after 5000ms' }
          : { exitCode: 0, output: 'ok' }
        await FS.writeText(logPath, result.output)
        return result
      },
    })

    Expect(attempts).toBe(2)
    Expect(summary.status).toBe('passed')
    Expect(summary.gates[0]?.retried).toBe(true)
    Expect(summary.gates[0]?.reason).toContain('passed on an isolated retry')
    Expect(summary.warnings.some(warning => warning.startsWith('machine contention:'))).toBe(true)
    await FS.remove(root)
    await FS.remove(registryRoot)
  })
})

Describe('gate runner green trees', () => {
  const generatedEvidence = async (
    _root: string,
    outputs: readonly GeneratedOutput[],
  ): Promise<GeneratedEvidence> => ({
    outputs: Object.fromEntries(outputs.map(output => [
      output,
      { inputs: `inputs-${output}`, outputs: `outputs-${output}` },
    ])),
    version: 1,
  })

  async function runOnce(
    root: string,
    options: {
      gates?: readonly string[]
      hash: string
      lanes: readonly string[]
      noCache?: boolean
      script?: GateScript
    },
  ) {
    const started: string[] = []
    const summary = await runGates({
      // Two recordable readers that read no generated class, so a record stands for them in a lane
      // holding no generator. `_typecheck` reads both generated trees and is the wrong default here.
      gates: options.gates ?? ['_dprint-check', '_repo-lint'],
      greenTree: {
        captureGenerated: generatedEvidence,
        hashTree: async () => options.hash,
        lanes: options.lanes,
        noCache: options.noCache,
      },
      jobs: 2,
      lane: options.lanes[0],
      logRoot: FS.resolvePath('logs', root),
      registryRoot: FS.resolvePath('registry', root),
      repositoryRoot: root,
      runGate: async (name, logPath) => {
        started.push(name)
        const result = options.script?.[name] ?? { exitCode: 0, output: '' }
        await FS.writeText(logPath, result.output)
        return result
      },
    })
    return { started, summary }
  }

  Test('a green run records its tree and an identical tree is not run again', async () => {
    const root = await mkTestDir('tao-gate-runner-green-')
    try {
      const first = await runOnce(root, { hash: 'tree-1', lanes: ['verify'] })
      Expect(first.started.sort()).toEqual(['_dprint-check', '_repo-lint'])
      Expect(first.summary.greenTree).toBeUndefined()

      const second = await runOnce(root, { hash: 'tree-1', lanes: ['verify'] })
      Expect(second.started).toEqual([])
      Expect(second.summary.status).toBe('passed')
      Expect(second.summary.greenTree?.lane).toBe('verify')
      Expect(second.summary.greenTree?.logRoot).toBe(first.summary.logRoot)
      // A tree hash does not describe the tools that read it, so the record carries both halves of
      // its key and the summary publishes both. This checkout pins no profile.
      Expect(second.summary.greenTree?.treeHash).toBe('tree-1')
      Expect(second.summary.greenTree?.toolchain).toBe(GreenTree.NO_TOOLCHAIN)
      Expect((await GreenTree.load(root)).lanes['verify']?.toolchain).toBe(GreenTree.NO_TOOLCHAIN)
      Expect(second.summary.gates.map(gate => gate.status)).toEqual(['skipped', 'skipped'])
      Expect(second.summary.gates[0]?.reason).toContain('tree unchanged since the green verify run')

      const edited = await runOnce(root, { hash: 'tree-2', lanes: ['verify'] })
      Expect(edited.started.sort()).toEqual(['_dprint-check', '_repo-lint'])
    } finally {
      await FS.remove(root)
    }
  })

  Test('a red run records nothing, and --no-cache runs everything while still recording', async () => {
    const root = await mkTestDir('tao-gate-runner-green-red-')
    try {
      const red = await runOnce(root, {
        hash: 'tree-1',
        lanes: ['verify'],
        script: { '_dprint-check': { exitCode: 1, output: 'boom' } },
      })
      Expect(red.summary.status).toBe('failed')

      const again = await runOnce(root, { hash: 'tree-1', lanes: ['verify'] })
      Expect(again.started.length).toBe(2)

      const fresh = await runOnce(root, { hash: 'tree-1', lanes: ['verify'], noCache: true })
      Expect(fresh.started.length).toBe(2)
      Expect(fresh.summary.greenTree).toBeUndefined()
      Expect((await runOnce(root, { hash: 'tree-1', lanes: ['verify'] })).started).toEqual([])
    } finally {
      await FS.remove(root)
    }
  })

  Test('rejects a run whose tree changes after the pre-run snapshot', async () => {
    const root = await mkTestDir('tao-gate-runner-green-drift-')
    const hashes = ['tree-before', 'tree-after']
    try {
      const summary = await runGates({
        gates: ['_repo-lint'],
        greenTree: { hashTree: async () => hashes.shift()!, lanes: ['verify'] },
        logRoot: FS.resolvePath('logs', root),
        registryRoot: FS.resolvePath('registry', root),
        repositoryRoot: root,
        runGate: async () => ({ exitCode: 0, output: '' }),
      })

      Expect(summary.status).toBe('failed')
      Expect(summary.warnings).toContain(
        'working tree changed while verification was running; this run is not green evidence',
      )
      Expect((await GreenTree.load(root)).lanes['verify']).toBeUndefined()
    } finally {
      await FS.remove(root)
    }
  })

  Test('snapshots after mutating gates settle and before reader gates start', async () => {
    const root = await mkTestDir('tao-gate-runner-green-mutator-')
    const hashes = ['before-fix', 'after-fix', 'after-fix']
    const started: string[] = []
    try {
      const summary = await runGates({
        gates: ['_fix-dprint', '_repo-lint'],
        greenTree: { hashTree: async () => hashes.shift()!, lanes: ['verify'] },
        logRoot: FS.resolvePath('logs', root),
        registryRoot: FS.resolvePath('registry', root),
        repositoryRoot: root,
        runGate: async name => {
          started.push(name)
          return { exitCode: 0, output: '' }
        },
      })

      Expect(started).toEqual(['_fix-dprint', '_repo-lint'])
      Expect(summary.status).toBe('passed')
      Expect((await GreenTree.load(root)).lanes['verify']?.treeHash).toBe('after-fix')
    } finally {
      await FS.remove(root)
    }
  })

  Test('a failed mutating gate prevents every reader from running', async () => {
    const root = await mkTestDir('tao-gate-runner-mutator-failure-')
    const started: string[] = []
    try {
      const summary = await runGates({
        gates: ['_fix-dprint', '_repo-lint'],
        logRoot: FS.resolvePath('logs', root),
        registryRoot: FS.resolvePath('registry', root),
        repositoryRoot: root,
        runGate: async name => {
          started.push(name)
          return { exitCode: name === '_fix-dprint' ? 1 : 0, output: '' }
        },
      })

      Expect(started).toEqual(['_fix-dprint'])
      Expect(summary.status).toBe('failed')
      Expect(summary.gates.find(gate => gate.name === '_repo-lint')?.status).toBe('skipped')
      Expect(summary.gates.find(gate => gate.name === '_repo-lint')?.reason).toContain('dependency failed')
    } finally {
      await FS.remove(root)
    }
  })

  Test('a reader of a generated tree stands on its record only while the generator runs beside it', async () => {
    const root = await mkTestDir('tao-gate-runner-green-generated-')
    try {
      // `_typecheck` compiles `_gen_tao-app` and `_gen_tao-parser`. Both are Git-ignored, so the
      // tree hash its record is keyed by says nothing about whether they exist or are current — a
      // fresh checkout hashes identically to one that has them.
      const allGenerated = ['_compile-word-flower-app', '_ide-extension-build', '_parser-gen', '_typecheck']
      await runOnce(root, { gates: allGenerated, hash: 'tree-1', lanes: ['verify'] })
      const recorded = (await GreenTree.load(root)).lanes['verify']
      Expect(recorded?.generated?.version).toBe(1)
      Expect(Object.keys(recorded?.generated?.outputs ?? {}).sort()).toEqual([
        'compiled-app',
        'ide-extension',
        'parser',
      ])

      // With both generators in the lane they regenerate whatever the record says, because a
      // generator is never recordable, so the record is safe to stand on.
      const withGenerators = await runOnce(root, { gates: allGenerated, hash: 'tree-1', lanes: ['verify'] })
      Expect(withGenerators.started.sort()).toEqual([
        '_compile-word-flower-app',
        '_ide-extension-build',
        '_parser-gen',
      ])

      // Drop the one that writes the generated app and the same record no longer covers it.
      const withoutAppGenerator = await runOnce(root, {
        gates: ['_parser-gen', '_typecheck'],
        hash: 'tree-1',
        lanes: ['verify'],
      })
      Expect(withoutAppGenerator.started.sort()).toEqual(['_parser-gen', '_typecheck'])
    } finally {
      await FS.remove(root)
    }
  })

  Test('records no lane when generated output changes after its readers start', async () => {
    const root = await mkTestDir('tao-gate-runner-generated-drift-')
    let capture = 0
    try {
      const summary = await runGates({
        gates: ['_parser-gen', '_repo-lint'],
        greenTree: {
          captureGenerated: async () => ({
            outputs: { parser: { inputs: 'same-inputs', outputs: `output-${String(capture++)}` } },
            version: 1,
          }),
          hashTree: async () => 'tree-1',
          lanes: ['verify'],
        },
        logRoot: FS.resolvePath('logs', root),
        registryRoot: FS.resolvePath('registry', root),
        repositoryRoot: root,
        runGate: async () => ({ exitCode: 0, output: '' }),
      })

      Expect(summary.status).toBe('failed')
      Expect(summary.warnings).toContain(
        'generated output changed or became unreadable while verification was running; '
          + 'this run is not green evidence',
      )
      Expect((await GreenTree.load(root)).lanes['verify']).toBeUndefined()
    } finally {
      await FS.remove(root)
    }
  })

  Test('never records a whole lane that includes host-dependent evidence', async () => {
    const root = await mkTestDir('tao-gate-runner-host-record-')
    try {
      const run = await runOnce(root, {
        gates: ['_compile-word-flower-app', '_parser-gen', '_typecheck', 'ship-bundle-proof'],
        hash: 'tree-1',
        lanes: ['verify-full'],
      })

      Expect(run.summary.status).toBe('passed')
      Expect((await GreenTree.load(root)).lanes['verify-full']).toBeUndefined()
    } finally {
      await FS.remove(root)
    }
  })

  Test('a lane stands on a superset lane record but a superset never stands on a subset', async () => {
    const root = await mkTestDir('tao-gate-runner-green-superset-')
    try {
      await runOnce(root, { hash: 'tree-1', lanes: ['verify-full'] })

      const verify = await runOnce(root, { hash: 'tree-1', lanes: ['verify', 'verify-full'] })
      Expect(verify.started).toEqual([])
      Expect(verify.summary.greenTree?.lane).toBe('verify-full')

      await runOnce(root, { hash: 'tree-2', lanes: ['verify', 'verify-full'] })
      const full = await runOnce(root, { hash: 'tree-2', lanes: ['verify-full'] })
      // The subset lane's record is not accepted as the superset's, so this run happens — but the
      // gates that record proved at this exact tree are not run a second time.
      Expect(full.summary.greenTree).toBeUndefined()
      Expect(full.started).toEqual([])
      Expect(full.summary.gates.map(gate => gate.status)).toEqual(['skipped', 'skipped'])
      Expect(full.summary.gates[0]?.reason).toContain('proved green at this tree')
    } finally {
      await FS.remove(root)
    }
  })

  Test('a lane runs the gates no record covers, and always runs the gates that rewrite the tree', async () => {
    const root = await mkTestDir('tao-gate-runner-green-gates-')
    try {
      const verify = await runOnce(root, {
        gates: ['_parser-gen', '_repo-lint', '_typecheck'],
        hash: 'tree-1',
        lanes: ['verify'],
      })
      Expect(verify.started.sort()).toEqual(['_parser-gen', '_repo-lint', '_typecheck'])

      const full = await runOnce(root, {
        gates: ['_parser-gen', '_repo-lint', '_typecheck', 'dead-exports'],
        hash: 'tree-1',
        lanes: ['verify-full'],
      })
      // `_parser-gen` fills a generated directory the tree hash does not describe, so a record can
      // never stand for it; `dead-exports` has no record of its own yet; and `_typecheck` reads the
      // generated app, whose generator this lane does not run, so its record cannot be trusted here.
      Expect(full.started.sort()).toEqual(['_parser-gen', '_typecheck', 'dead-exports'])
      Expect(full.summary.status).toBe('passed')

      // What the superset run proved is now recorded too, so the subset lane stands on its record.
      const again = await runOnce(root, { gates: ['_repo-lint'], hash: 'tree-1', lanes: ['verify'] })
      Expect(again.started).toEqual([])
    } finally {
      await FS.remove(root)
    }
  })

  Test('a run that skipped gates on an earlier proof is not green evidence once its fixers move the tree', async () => {
    const root = await mkTestDir('tao-gate-runner-green-moved-')
    try {
      await runOnce(root, { hash: 'tree-1', lanes: ['verify'] })

      // The lane includes a fixer, so the prepare phase runs and can move the tree under the
      // readers that were skipped on the earlier proof. The three readings are the starting tree,
      // the post-prepare snapshot, and the final tree: the last two agree, so this is the fixers'
      // own rewrite and not concurrent drift — which is the case only this guard catches.
      const hashes = ['tree-1', 'tree-2', 'tree-2']
      const moved = await runGates({
        gates: ['_fix-dprint', '_repo-lint', '_typecheck'],
        greenTree: {
          hashTree: async () => hashes.shift()!,
          // A lane no whole-lane record covers, so the run happens and reaches its gate records.
          lanes: ['verify-full'],
        },
        jobs: 2,
        lane: 'verify-full',
        logRoot: FS.resolvePath('logs-moved', root),
        registryRoot: FS.resolvePath('registry', root),
        repositoryRoot: root,
        runGate: async (_name, logPath) => {
          await FS.writeText(logPath, '')
          return { exitCode: 0, output: '' }
        },
      })

      // Exiting 0 here is the whole failure: `merge-with-main` reads the exit code and nothing else,
      // so a warning alone would let an unproved tree through.
      Expect(moved.status).toBe('failed')
      Expect(moved.warnings).toContain(
        'nodes were skipped on an earlier proof and the prepare phase then changed the tree; '
          + 'this run is not green evidence. Re-run with --no-cache.',
      )
      // Nothing was recorded against the tree this run left behind.
      Expect((await runOnce(root, { hash: 'tree-2', lanes: ['verify'] })).started.length).toBe(2)
    } finally {
      await FS.remove(root)
    }
  })
})
