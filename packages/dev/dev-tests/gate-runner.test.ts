import { FS } from '@shared'
import { Deferred, Describe, Expect, mkTestDir, settle, Test, until } from '@shared/test'
import { runGates } from '../dev-src/repository-tests/GateRunner'
import { MachineLanes } from '../dev-src/repository-tests/MachineLanes'
import { classifyFailure, formatGateSummary, gateExitCode } from '../dev-src/repository-tests/RunSummary'

type GateScript = Record<string, { exitCode: number; output: string }>

async function run(gates: readonly string[], script: GateScript, extra: Record<string, unknown> = {}) {
  const root = await mkTestDir('tao-gate-runner-')
  try {
    const started: string[] = []
    const summary = await runGates({
      gates,
      jobs: 2,
      logRoot: FS.resolvePath('logs', root),
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
    const { summary } = await run(['_repo-lint', '_typecheck', '_test'], {
      _test: { exitCode: 1, output: 'test failed' },
      _typecheck: { exitCode: 2, output: 'error TS2345: bad argument' },
    })

    Expect(summary.firstFailure?.name).toBe('_typecheck')
    Expect(summary.firstFailure?.output).toContain('error TS2345')
    Expect(formatGateSummary(summary)).toContain('First failure — _typecheck')
  })

  Test('reports a skipped gate as skipped, with why, and never as passed', async () => {
    const { summary } = await run(['_repo-lint'], {}, {
      skipped: ['studio-smoke=slow lane; run just studio-smoke or just full-verify'],
    })

    const skipped = summary.gates.find(gate => gate.name === 'studio-smoke')
    Expect(skipped?.status).toBe('skipped')
    Expect(skipped?.reason).toBe('slow lane; run just studio-smoke or just full-verify')
    Expect(summary.gates.filter(gate => gate.status === 'passed').map(gate => gate.name)).toEqual(['_repo-lint'])
    Expect(formatGateSummary(summary)).toContain('1 passed, 0 failed, 1 skipped')
  })

  Test('skips every catalogued unsandboxed gate before scheduling it', async () => {
    const hostOnly = [
      '_full-verify-smoke-launch',
      '_full-verify-real-app',
      '_full-verify-simulated',
      '_full-verify-native',
      '_full-verify-canary',
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
    })

    Expect(summary.warnings).toEqual(['_ide-extension-build: Warning: rule declared but never referenced'])
    Expect(summary.status).toBe('passed')
    Expect(formatGateSummary(summary)).toContain('! _ide-extension-build: Warning:')
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

  Test('records every gate duration in the timings store the next run plans from', async () => {
    const root = await mkTestDir('tao-gate-runner-timings-')
    const registryRoot = await mkTestDir('tao-gate-runner-lanes-')
    try {
      await runGates({
        gates: ['_repo-lint'],
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
    Expect(classifyFailure('expect(received).toBe(expected)', { contention: shared })).toBe('repository')
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
  Test('runs only as many gates at once as its share of a machine full of other lanes allows', async () => {
    // Three neighbours plus this lane divide the injected four-CPU machine to exactly one slot each,
    // so the assertion does not depend on how many CPUs the host running the test happens to have.
    const registryRoot = await busyRegistryRoot(3)
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

    await until(() => started.length === 1, {
      description: 'the lane to fill its share of the machine',
    })
    await settle(20)
    // Without a machine-wide share the third gate would already be running: an untuned gate costs
    // one slot and the graph would have had a whole machine of them.
    // More live lanes than CPUs means some lanes wait and each admitted lane owns one slot; a
    // minimum of two here would itself oversubscribe the machine.
    Expect(started).toHaveLength(1)

    held.resolve()
    const summary = await finished
    Expect(started).toHaveLength(3)
    Expect(summary.status).toBe('passed')
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
