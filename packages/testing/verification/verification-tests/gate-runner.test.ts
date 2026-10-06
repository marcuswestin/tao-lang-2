import { Errors, FS } from '@shared'
import {
  Deferred,
  Describe,
  Expect,
  mkTestDir,
  setClockForTest,
  settle,
  Test,
  testOverrideSlot,
  until,
} from '@shared/test'
import { runGates } from '../verification-src/GateRunner'
import type { GeneratedEvidence, GeneratedOutput } from '../verification-src/GeneratedEvidence'
import { GreenTree } from '../verification-src/GreenTree'
import { MachineLanes } from '../verification-src/MachineLanes'
import { RunArtifacts } from '../verification-src/RunArtifacts'
import { classifyFailure, formatGateSummary, gateExitCode } from '../verification-src/RunSummary'
import { TestLedger } from '../verification-src/TestLedger'
import { TestNodes } from '../verification-src/TestNodes'
import { TestRunner } from '../verification-src/TestRunner'
import { WorkGraph } from '../verification-src/WorkGraph'

type GateScript = Record<string, { exitCode: number; output: string }>

Describe('diagnostic resume', () => {
  Test('a diagnostic generator run reports its result without claiming uncaptured green evidence', async () => {
    const root = await mkTestDir('tao-diagnostic-generator-')
    try {
      const summary = await runGates({
        gates: ['_parser-gen', '_repo-lint'],
        jobs: 1,
        lane: 'diagnose-verification',
        logRoot: FS.resolvePath('logs', root),
        machineLoadAverage: IDLE_MACHINE,
        registryRoot: FS.resolvePath('registry', root),
        repositoryRoot: root,
        runGate: async () => ({ exitCode: 0, output: '' }),
      })
      Expect(summary.status).toBe('passed')
      Expect(summary.warnings.some(warning => warning.includes('generated output changed'))).toBe(false)
      Expect(await FS.isFile(FS.resolvePath('.artifacts/verify/green-tree.json', root))).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('retains explicitly completed diagnostic parts without skipping verification work', async () => {
    const root = await mkTestDir('tao-diagnostic-resume-')
    try {
      for (const lane of ['diagnose-verification', 'verify-changed']) {
        const ran: string[] = []
        const summary = await runGates({
          diagnosticCompleted: ['first'],
          gates: ['first', 'second'],
          jobs: 1,
          lane,
          logRoot: FS.resolvePath(lane, root),
          machineLoadAverage: IDLE_MACHINE,
          registryRoot: FS.resolvePath('registry', root),
          repositoryRoot: root,
          runGate: async name => {
            ran.push(name)
            return { exitCode: 0, output: `${name} passed\n` }
          },
        })
        Expect(summary.status).toBe('passed')
        Expect(ran).toEqual(lane === 'diagnose-verification' ? ['second'] : ['first', 'second'])
        Expect(await FS.isFile(FS.resolvePath('.artifacts/verify/green-tree.json', root))).toBe(false)
      }
    } finally {
      await FS.remove(root)
    }
  })
})

const resourceAcquisition = testOverrideSlot<typeof MachineLanes.acquireResource>({
  read: () => MachineLanes.acquireResource,
  write: value => Object.defineProperty(MachineLanes, 'acquireResource', { value }),
})

const testPlanSlot = testOverrideSlot<typeof TestRunner.testNodesFor>({
  read: () => TestRunner.testNodesFor,
  write: value => Object.defineProperty(TestRunner, 'testNodesFor', { value }),
})

Describe('gate test evidence', () => {
  Test('retains a reviewed completed diagnostic suite after its shard plan changes', async () => {
    const root = await mkTestDir('tao-diagnostic-reshard-')
    const original = TestRunner.testNodesFor
    const files = ['one', 'two', 'three'].map(name => `packages/shared/shared-tests/${name}.test.ts`)
    const buildPlan = () =>
      TestNodes.build({
        ledger: { version: 1, tests: {} },
        timings: { version: 1, nodes: {} },
        selected: files.map((file, index) => ({
          name: `fixture-${index}`,
          files: [file],
          buildProcess: (_name, selected) => ({ command: 'fixture-runner', args: [], files: selected }),
        })),
      })
    try {
      for (const lane of ['diagnose-verification', 'verify-changed']) {
        const ran: string[] = []
        const plan = buildPlan()
        // Simulate learned timing turning the same reviewed suite into fresh shard names.
        for (const [index, state] of plan.states.entries()) {
          state.suite = 'completed-suite'
          state.name = `completed-suite#${index + 1}`
        }
        const replacePlan = testPlanSlot.install(async options =>
          options.repositoryRoot === root ? { ...plan, states: [...plan.states] } : original(options)
        )
        try {
          const summary = await runGates({
            diagnosticCompleted: ['completed-suite'],
            gates: ['_test'],
            jobs: 1,
            lane,
            logRoot: FS.resolvePath(lane, root),
            machineLoadAverage: IDLE_MACHINE,
            registryRoot: FS.resolvePath('registry', root),
            repositoryRoot: root,
            runGate: async name => {
              ran.push(name)
              return { exitCode: 0, output: '' }
            },
          })
          Expect(summary.status).toBe('passed')
          Expect(ran).toEqual(lane === 'diagnose-verification' ? [] : plan.states.map(state => state.name))
        } finally {
          replacePlan()
        }
      }
    } finally {
      await FS.remove(root)
    }
  })

  Test('records full-run wall time and preserves it when fail-fast leaves tests unrun', async () => {
    const root = await mkTestDir('tao-gate-test-evidence-')
    let wallTime = Date.UTC(2026, 9, 1, 12)
    const restoreClock = setClockForTest(() => wallTime)
    const original = TestRunner.testNodesFor
    const files = ['first', 'second'].map(name => `packages/shared/shared-tests/${name}.test.ts`)
    const restorePlan = testPlanSlot.install(async options => {
      if (options.repositoryRoot !== root) {
        return original(options)
      }
      // Supply a small runner inventory while keeping graph execution and evidence recording real.
      const plan = TestNodes.build({
        ledger: { version: 1, tests: {} },
        timings: { version: 1, nodes: {} },
        selected: files.map((file, index) => ({
          name: `fixture-${index}`,
          files: [file],
          buildProcess: (name, selected) => ({
            command: 'fixture-runner',
            args: [],
            files: selected,
            testReport: { format: 'bun-junit', suite: name, path: FS.resolvePath(`${name}.xml`, root) },
          }),
        })),
      })
      return { ...plan, states: [...plan.states] }
    })
    let fail = false
    try {
      for (const file of files) {
        await FS.writeText(FS.resolvePath(file, root), '// test inventory fixture\n')
      }
      const execute = () =>
        runGates({
          gates: ['_test'],
          jobs: 1,
          now: () => 123,
          machineLoadAverage: IDLE_MACHINE,
          repositoryRoot: root,
          registryRoot: FS.resolvePath('registry', root),
          logRoot: FS.resolvePath(fail ? 'partial-logs' : 'complete-logs', root),
          runGate: async name => {
            const file = files[Number(name.split('-')[1])]
            const failure = fail ? '<failure message="Tao regression" />' : ''
            await FS.writeText(
              FS.resolvePath(`${name}.xml`, root),
              `<testsuite tests="1"><testcase file="${file}" name="protects Tao">${failure}</testcase></testsuite>`,
            )
            return { exitCode: fail ? 1 : 0, output: fail ? 'Tao regression' : '' }
          },
        })
      Expect((await execute()).status).toBe('passed')
      const fullRunAt = new Date(wallTime).toISOString()
      Expect((await TestLedger.load(root)).lastFullRunStartedAt).toBe(fullRunAt)
      fail = true
      wallTime += 1_000
      const partial = await execute()
      Expect(partial.status).toBe('failed')
      Expect(partial.gates.some(gate => gate.status === 'skipped')).toBe(true)
      Expect((await TestLedger.load(root)).lastFullRunStartedAt).toBe(fullRunAt)
    } finally {
      restorePlan()
      restoreClock()
      await FS.remove(root)
    }
  })
})

Describe('gate release lifetime', () => {
  Test('observes early release failure and waits for both owned cleanups before returning it', async () => {
    const root = await mkTestDir('tao-gate-release-')
    const completeRead = Deferred()
    const completeGui = Deferred()
    const completePrepare = Deferred()
    const started: string[] = []
    const released: string[] = []
    const original = MachineLanes.acquireResource
    const failure = new Errors.HostEnvironmentError('controlled prepare release failure')
    const restore = resourceAcquisition.install(async options => {
      const lease = await original(options)
      if (options.repositoryRoot !== root) {
        return lease
      }
      return {
        ...lease,
        release: async () => {
          started.push(options.name)
          await (options.name === 'gui' ? completeGui.promise : completePrepare.promise)
          await lease.release()
          released.push(options.name)
          if (options.name !== 'gui') {
            throw failure
          }
        },
      }
    })
    let finished = false
    const run = runGates({
      showStudio: true,
      gates: ['_fix-dprint', 'studio-canary', '_typecheck'],
      jobs: 8,
      machineCpuCount: 8,
      machineLoadAverage: IDLE_MACHINE,
      repositoryRoot: root,
      registryRoot: FS.resolvePath('registry', root),
      logRoot: FS.resolvePath('logs', root),
      runGate: async name => {
        if (name === '_typecheck') {
          await completeRead.promise
        }
        return { exitCode: 0, output: '' }
      },
    }).then(() => {
      finished = true
      return undefined
    }, error => {
      finished = true
      return error
    })
    try {
      await until(() => started.length >= 2)
      completePrepare.resolve()
      await until(() => released.includes('verify-prepare'))
      // Leave the graph open through rejection delivery, proving early failure is observed.
      await settle()
      Expect(finished).toBe(false)
      completeRead.resolve()
      await settle()
      Expect(finished).toBe(false)
      completeGui.resolve()
      Expect(await run).toBe(failure)
      Expect(started.toSorted()).toEqual(['gui', 'verify-prepare'])
      Expect(released.toSorted()).toEqual(['gui', 'verify-prepare'])
    } finally {
      completeRead.resolve()
      completePrepare.resolve()
      completeGui.resolve()
      await run
      restore()
      await FS.remove(root)
    }
  })
})

/**
 * IDLE_MACHINE is the precondition these tests have always meant. A run's contention verdict turns
 * on the host's load average, and a contended run warns about it and declines to teach the timings
 * store — correct behavior that fails any assertion written for a quiet machine. Pinning the
 * reading states the precondition instead of inheriting whatever the other worktrees on this host
 * are doing; `CONTENDED_MACHINE` pins the other side, so both verdicts are covered deliberately.
 */
const IDLE_MACHINE = () => 0
const CONTENDED_MACHINE = () => 1_000

async function run(
  gates: readonly string[],
  script: GateScript,
  extra: Record<string, unknown> = {},
  fixtureFiles: Readonly<Record<string, string>> = {},
) {
  const root = await mkTestDir('tao-gate-runner-')
  try {
    for (const [path, source] of Object.entries(fixtureFiles)) {
      await FS.writeText(FS.resolvePath(path, root), source)
    }
    const started: string[] = []
    const summary = await runGates({
      showStudio: true,
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
      // These simulated neighbours precede this lane even when registration shares a millisecond.
      startedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    })
  }
  return registryRoot
}

Describe('repository gate runner', () => {
  Test('broad verification stops after a definite failure and keeps a complete diagnostic record', async () => {
    const root = await mkTestDir('tao-gate-runner-fail-fast-')
    const started: string[] = []
    try {
      const summary = await runGates({
        showStudio: true,
        gates: ['first', 'second'],
        jobs: 1,
        logRoot: FS.resolvePath('logs', root),
        machineLoadAverage: IDLE_MACHINE,
        registryRoot: FS.resolvePath('registry', root),
        repositoryRoot: root,
        runGate: async name => {
          started.push(name)
          return { exitCode: name === 'first' ? 1 : 0, output: name === 'first' ? 'definite failure' : '' }
        },
      })

      Expect(started).toEqual(['first'])
      Expect(summary.status).toBe('failed')
      Expect(summary.firstFailure?.name).toBe('first')
      Expect(summary.firstFailure?.output).toContain('definite failure')
      Expect(summary.gates.find(gate => gate.name === 'second')?.reason)
        .toBe('not run after definite failure: first')
      Expect(summary.warnings).toContain('verification stopped after definite failure in first; 1 check not run')
      Expect(await FS.exists(FS.resolvePath('logs/summary.json', root))).toBe(true)
      Expect(await FS.readText(FS.resolvePath('logs/first.log', root))).toContain('definite failure')
    } finally {
      await FS.remove(root)
    }
  })

  Test('diagnostic execution collects failures within its explicit scope', async () => {
    const { started, summary } = await run(['first', 'second'], {
      first: { exitCode: 1, output: 'first defect' },
      second: { exitCode: 1, output: 'second defect' },
    }, { failurePolicy: 'collect-all', jobs: 1 })
    Expect(started).toEqual(['first', 'second'])
    Expect(summary.gates.map(gate => gate.status)).toEqual(['failed', 'failed'])
    Expect(summary.warnings.some(warning => warning.startsWith('verification stopped after definite failure'))).toBe(
      false,
    )
  })

  Test('full verification keeps admitting checks after a timeout that may recover on retry', async () => {
    const { started, summary } = await run(['first', 'second'], {
      first: { exitCode: 1, output: 'timed out after 5000ms' },
    }, { jobs: 1, lane: 'verify-full' })

    Expect(started.slice(0, 2)).toEqual(['first', 'second'])
    Expect(summary.gates.find(gate => gate.name === 'second')?.status).toBe('passed')
    Expect(summary.warnings.some(warning => warning.startsWith('verification stopped after definite failure'))).toBe(
      false,
    )
  })

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
    }, { failurePolicy: 'collect-all' })

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
    }, { failurePolicy: 'collect-all' })

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
    const { started, summary } = await run(['_test'], {}, {}, {
      'packages/cli/dev-cli/performance-checks/missing-results.test.ts': '// Test inventory fixture.\n',
    })
    const performanceChecks = summary.gates.find(gate => gate.name === 'performance-checks')

    Expect(started).toContain('performance-checks')
    Expect(performanceChecks).toBeDefined()
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
      'studio-network-simulation',
      'studio-canary',
    ]
    const { started, summary } = await run(['_repo-lint', ...hostOnly], {}, { skipUnsandboxed: true })

    Expect(started).toEqual(['_repo-lint'])
    Expect(summary.gates.filter(gate => gate.status === 'skipped').map(gate => gate.name)).toEqual(hostOnly)
    Expect(
      summary.gates.filter(gate => gate.status === 'skipped').every(gate =>
        gate.reason === 'requires unsandboxed host capabilities; run ./agent unsandboxed verify-full'
      ),
    ).toBe(true)
  })

  Test('a split lane runs each reader on exactly one machine and the prepare phase on every one', async () => {
    const gates = ['_fix-dprint', '_repo-lint', '_typecheck', 'dead-exports']
    const first = await run(gates, {}, { partition: { count: 2, index: 0 } })
    const second = await run(gates, {}, { partition: { count: 2, index: 1 } })

    Expect(first.started).toContain('_fix-dprint')
    Expect(second.started).toContain('_fix-dprint')
    const readers = [...first.started, ...second.started].filter(name => name !== '_fix-dprint').sort()
    Expect(readers).toEqual(['_repo-lint', '_typecheck', 'dead-exports'])
    Expect(first.summary.partition?.digest).toBe(second.summary.partition?.digest)
    Expect(first.summary.partition?.index).toBe(1)
    Expect(
      first.summary.gates.filter(gate => gate.status === 'skipped').every(gate =>
        gate.reason === 'runs on partition 2/2'
      ),
    ).toBe(true)
  })

  Test('partitions test nodes by current membership estimates despite stale shard-name timings', async () => {
    const root = await mkTestDir('tao-gate-partition-estimates-')
    const files = ['heavy.test.ts', 'light.test.ts', 'other.test.ts'].map(name =>
      `packages/example/example-tests/${name}`
    )
    const started: string[] = []
    const originalPlan = TestRunner.testNodesFor
    const restorePlan = testPlanSlot.install(async options => {
      if (options.repositoryRoot !== root) {
        return await originalPlan(options)
      }
      const plan = TestNodes.build({
        ledger: { version: 1, tests: {} },
        timings: {
          nodes: {
            'fixture-weighted': {
              emaMs: 20_600,
              lastMs: 20_600,
              lastRunAt: '2026-01-01T00:00:00.000Z',
              samples: 1,
              source: 'wall',
            },
            'fixture-weighted#1': {
              emaMs: 100,
              lastMs: 100,
              lastRunAt: '2026-01-01T00:00:00.000Z',
              samples: 10,
              source: 'wall',
            },
            'fixture-weighted#2': {
              emaMs: 19_000,
              lastMs: 19_000,
              lastRunAt: '2026-01-01T00:00:00.000Z',
              samples: 10,
              source: 'wall',
            },
          },
          version: 1,
        },
        selected: [{
          buildProcess: (name, selected) => ({
            args: [],
            command: 'fixture-runner',
            files: selected,
            testReport: { format: 'bun-junit', path: FS.resolvePath(`${name}.xml`, root), suite: 'fixture-weighted' },
          }),
          estimationUnits: files,
          files: files.slice(0, 2),
          name: 'fixture-weighted',
          unitCostMs: new Map([[files[0]!, 8_000], [files[1]!, 1_000], [files[2]!, 1_000]]),
        }],
      })
      return { ...plan, states: [...plan.states] }
    })
    try {
      for (const file of files.slice(0, 2)) {
        await FS.writeText(FS.resolvePath(file, root), '// test inventory fixture\n')
      }
      await FS.writeJson(FS.resolvePath('.artifacts/timings/durations.json', root), {
        nodes: {
          'fixture-weighted#1': {
            emaMs: 100,
            lastMs: 100,
            lastRunAt: '2026-01-01T00:00:00.000Z',
            samples: 10,
            source: 'wall',
          },
          'fixture-weighted#2': {
            emaMs: 19_000,
            lastMs: 19_000,
            lastRunAt: '2026-01-01T00:00:00.000Z',
            samples: 10,
            source: 'wall',
          },
        },
        version: 1,
      })
      const summary = await runGates({
        gates: ['_test'],
        jobs: 1,
        logRoot: FS.resolvePath('logs', root),
        machineLoadAverage: IDLE_MACHINE,
        partition: { count: 2, index: 0 },
        registryRoot: FS.resolvePath('registry', root),
        repositoryRoot: root,
        runGate: async (name, logPath) => {
          started.push(name)
          const report = FS.resolvePath(`${name}.xml`, root)
          await FS.writeText(report, `<testsuite tests="1"><testcase file="${files[0]}" name="weighted" /></testsuite>`)
          await FS.writeText(logPath, '')
          return { exitCode: 0, output: '' }
        },
      })

      Expect(started).toEqual(['fixture-weighted#1'])
      Expect(summary.gates.find(gate => gate.name === 'fixture-weighted#2')?.reason)
        .toBe('runs on partition 2/2')
    } finally {
      restorePlan()
      await FS.remove(root)
    }
  })

  Test('a partition records only the suites wholly inside it, never one sharded across partitions', async () => {
    const root = await mkTestDir('tao-gate-partition-record-')
    const original = TestRunner.testNodesFor
    const files = ['one', 'two', 'three'].map(name => `packages/shared/shared-tests/${name}.test.ts`)
    const restorePlan = testPlanSlot.install(async options => {
      if (options.repositoryRoot !== root) {
        return original(options)
      }
      const plan = TestNodes.build({
        ledger: { version: 1, tests: {} },
        timings: { version: 1, nodes: {} },
        selected: files.map((file, index) => ({
          name: `fixture-${index}`,
          files: [file],
          buildProcess: (_name, selected) => ({ command: 'fixture-runner', args: [], files: selected }),
        })),
      })
      // Equal unknown costs place by name: split#1 on partition 1, split#2 on partition 2, whole on 1.
      const shapes = [['split-suite', 'split-suite#1'], ['split-suite', 'split-suite#2'], ['whole-suite', 'whole-suite']]
      for (const [index, state] of plan.states.entries()) {
        state.suite = shapes[index]![0]!
        state.name = shapes[index]![1]!
      }
      return { ...plan, states: [...plan.states] }
    })
    try {
      for (const file of files) {
        await FS.writeText(FS.resolvePath(file, root), '// test inventory fixture\n')
      }
      const started: string[] = []
      // The suites read every generated tree, so a record stands for them only beside the generators.
      const generated = async (_root: string, outputs: readonly GeneratedOutput[]): Promise<GeneratedEvidence> => ({
        outputs: Object.fromEntries(outputs.map(output => [output, { inputs: 'inputs', outputs: 'outputs' }])),
        version: 1,
      })
      const summary = await runGates({
        gates: ['_compile-word-flower-app', '_ide-extension-build', '_parser-gen', '_test'],
        greenTree: { captureGenerated: generated, hashTree: async () => 'tree-1', lanes: ['verify'] },
        jobs: 1,
        lane: 'verify',
        logRoot: FS.resolvePath('logs', root),
        machineLoadAverage: IDLE_MACHINE,
        partition: { count: 2, index: 0 },
        registryRoot: FS.resolvePath('registry', root),
        repositoryRoot: root,
        runGate: async name => {
          started.push(name)
          return { exitCode: 0, output: '' }
        },
      })

      Expect(summary.status).toBe('passed')
      Expect(started.filter(name => name.includes('suite')).toSorted()).toEqual(['split-suite#1', 'whole-suite'])
      const records = (await GreenTree.load(root)).gates
      // The other partition's shard never ran here, so the suite is not proved by this run.
      Expect(records['split-suite']).toBeUndefined()
      Expect(records['whole-suite']?.treeHash).toBe('tree-1')
    } finally {
      restorePlan()
      await FS.remove(root)
    }
  })

  Test('skips the macOS-only gates off macOS and runs them on it', async () => {
    const macOnly = ['studio-canary']
    const linux = await run(['_repo-lint', ...macOnly], {}, { hostPlatform: 'linux' })
    const darwin = await run(['_repo-lint', ...macOnly], {}, { hostPlatform: 'darwin' })

    Expect(linux.started).toEqual(['_repo-lint'])
    Expect(linux.summary.gates.filter(gate => gate.status === 'skipped').map(gate => gate.name)).toEqual(macOnly)
    Expect(
      linux.summary.gates.filter(gate => gate.status === 'skipped').every(gate =>
        gate.reason === 'requires macOS; not run on linux'
      ),
    ).toBe(true)
    Expect(darwin.started.toSorted()).toEqual(['_repo-lint', ...macOnly].toSorted())
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
        showStudio: true,
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

  Test('propagates the enclosing lane identity to nested diagnostics', async () => {
    const root = await mkTestDir('tao-gate-runner-lane-env-')
    const registryRoot = FS.resolvePath('registry', root)
    let laneId: string | undefined
    try {
      await runGates({
        showStudio: true,
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

  Test('a lane paused for landing priority holds neither GUI nor prepare', async () => {
    const root = await mkTestDir('tao-gate-runner-priority-')
    const registryRoot = FS.resolvePath('registry', root)
    const priority = await MachineLanes.beginLandingPriority(registryRoot)
    Expect(priority).toBeDefined()
    const started: string[] = []
    const pending = runGates({
      showStudio: true,
      gates: ['studio-canary', '_fix-just-fmt'],
      jobs: 2,
      registryRoot,
      repositoryRoot: root,
      runGate: async name => {
        started.push(name)
        return { exitCode: 0, output: '' }
      },
    })
    try {
      await until(async () => (await MachineLanes.activeLanes(registryRoot)).length === 1, {
        description: 'the paused gate lane to register',
      })
      Expect(started).toEqual([])
      const gui = await MachineLanes.tryAcquireResource({ name: 'gui', registryRoot, repositoryRoot: root })
      const prepare = await MachineLanes.tryAcquireResource({
        name: 'verify-prepare',
        registryRoot: FS.resolvePath('.artifacts/verify/prepare-lock', root),
        repositoryRoot: root,
      })
      Expect(gui).toBeDefined()
      Expect(prepare).toBeDefined()
      await gui?.release()
      await prepare?.release()
      await priority?.release()
      Expect((await pending).status).toBe('passed')
      Expect(started.toSorted()).toEqual(['_fix-just-fmt', 'studio-canary'])
    } finally {
      await priority?.release()
      await pending.catch(() => undefined)
      await FS.remove(root)
    }
  })

  Test('writes a JSON summary artifact when one is requested', async () => {
    const root = await mkTestDir('tao-gate-runner-json-')
    try {
      await runGates({
        showStudio: true,
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
        showStudio: true,
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
    } finally {
      await FS.remove(root)
    }
  })

  Test('publishes a gate log as that gate finishes, before the lane finishes', async () => {
    const root = await mkTestDir('tao-gate-runner-live-log-')
    const held = Deferred()
    try {
      const finished = runGates({
        showStudio: true,
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

  Test('streams node output while it is running, then publishes the final output', async () => {
    const root = await mkTestDir('tao-gate-runner-live-output-')
    const release = Deferred()
    const location = RunArtifacts.locate({ lane: 'verify', logRoot: 'logs', repositoryRoot: root })
    const state = WorkGraph.createState({ name: 'held', run: { args: [], command: 'true' } })
    let running: Promise<Awaited<ReturnType<typeof WorkGraph.run>>> | undefined
    try {
      await RunArtifacts.assignLogPaths([state], location)
      const writer = RunArtifacts.liveWriter(location, () => {})
      running = WorkGraph.run([state], {
        jobs: 1,
        onEvent: writer.handle,
        runNode: async (_state, context) => {
          context.onOutput('visible while running\n')
          await release.promise
          return { exitCode: 0, output: 'written at completion\n' }
        },
        watchInterrupt: () => () => {},
      })

      const logPath = state.logPath!
      await until(async () =>
        state.status === 'running' && await FS.isFile(logPath)
        && await FS.readText(logPath) === 'visible while running\n', {
        description: 'live output to appear while its node is running',
      })
      Expect(state.status).toBe('running')
      Expect(await FS.readText(logPath)).toBe('visible while running\n')

      release.resolve()
      Expect((await running).states[0]?.status).toBe('passed')
      await writer.finish()
      Expect(await FS.readText(logPath)).toBe('visible while running\nwritten at completion\n')
    } finally {
      release.resolve()
      if (running !== undefined) {
        await running
      }
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

  Test('surfaces live log write failures when the writer finishes', async () => {
    const root = await mkTestDir('tao-gate-runner-live-log-failure-')
    try {
      const location = RunArtifacts.locate({ lane: 'verify', logRoot: 'logs', repositoryRoot: root })
      const state = WorkGraph.createState({ name: 'gate', run: { args: [], command: 'true' } })
      await RunArtifacts.assignLogPaths([state], location)
      await FS.mkdir(state.logPath!)
      const writer = RunArtifacts.liveWriter(location, () => {})

      writer.handle({ kind: 'start', state })
      writer.handle({ kind: 'output', output: 'unwritable output\n', state })

      await Expect(writer.finish()).rejects.toThrow()
    } finally {
      await FS.remove(root)
    }
  })

  Test('records every gate duration in the timings store the next run plans from', async () => {
    const root = await mkTestDir('tao-gate-runner-timings-')
    const registryRoot = await mkTestDir('tao-gate-runner-lanes-')
    try {
      await runGates({
        showStudio: true,
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
        showStudio: true,
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
      "Machine resource 'studio-native-host:com.devtao.studio' is busy: studio-native in /primary (PID 42)",
    )).toBe('native-host-busy')
    Expect(classifyFailure(
      "Machine resource 'studio-native-probe' is busy: studio-canary in /other/worktree (PID 42)",
    )).toBe('native-host-busy')
    Expect(classifyFailure("Machine resource 'studio-native-elsewhere' is busy")).not.toBe('native-host-busy')
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
    let declined = false

    const finished = runGates({
      showStudio: true,
      gates: ['_repo-lint', '_dprint-check', '_runtime-pack-check'],
      logRoot: FS.resolvePath('logs', root),
      machineCpuCount: 4,
      onEvent: event => {
        if (event.kind === 'waiting') {
          declined = true
        }
      },
      registryRoot,
      repositoryRoot: root,
      runGate: async (name, logPath) => {
        started.push(name)
        await held.promise
        await FS.writeText(logPath, '')
        return { exitCode: 0, output: '' }
      },
    })

    // The broker's `waiting` event is the lane's first refused admission: an observed fact, where a
    // turn count or a sleep would be a guess about how long registration takes on a busy host.
    await until(() => declined, {
      description: 'this run to report its first declined admission attempt',
    })
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
    // A refused lane sleeps one whole poll before it asks again, so the wait clears the reporting
    // noise floor on any host. Its kind is incidental, so only its presence is asserted.
    Expect(summary.gates.flatMap(gate => gate.waits ?? []).length).toBeGreaterThan(0)
    await FS.remove(root)
    await FS.remove(registryRoot)
  })

  Test('does not teach the timings store how slow a shared machine was', async () => {
    const registryRoot = await busyRegistryRoot()
    const root = await mkTestDir('tao-gate-runner-')

    await runGates({
      showStudio: true,
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
      showStudio: true,
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
      showStudio: true,
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
        showStudio: true,
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
        showStudio: true,
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
        showStudio: true,
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
      Expect(summary.gates.find(gate => gate.name === '_repo-lint')?.reason).toBe(
        'not run after definite failure: _fix-dprint',
      )
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
        showStudio: true,
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
        showStudio: true,
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
