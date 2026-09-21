import { Platform } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { RunArtifacts } from '../dev-src/repository-tests/RunArtifacts'
import {
  buildSummary,
  classifyFailure,
  formatGateSummary,
  formatVerdict,
  gateExitCode,
  rollupSuites,
} from '../dev-src/repository-tests/RunSummary'
import { WorkGraph, type WorkNode, type WorkState } from '../dev-src/repository-tests/WorkGraph'

function finishedState(node: Partial<WorkNode> & { name: string }, outcome: Partial<WorkState> = {}): WorkState {
  return {
    ...WorkGraph.createState({ run: { args: [], command: 'true' }, ...node }),
    elapsedMs: 1_000,
    exitCode: 0,
    status: 'passed',
    ...outcome,
  }
}

Describe('versioned run summary', () => {
  Test('gives same-millisecond runs collision-proof stamps while allowing deterministic injection', () => {
    const first = RunArtifacts.locate({ lane: 'test', repositoryRoot: '/repo' })
    const second = RunArtifacts.locate({ lane: 'test', repositoryRoot: '/repo' })
    const injected = RunArtifacts.locate({ lane: 'test', repositoryRoot: '/repo', stamp: 'fixture-stamp' })

    Expect(first.stamp).not.toBe(second.stamp)
    Expect(first.stamp).toContain(`-${Platform.runtimeProcess.pid}-`)
    Expect(injected.stamp).toBe('fixture-stamp')
  })

  Test('records the lane and each node graph fact a later consumer schedules from', () => {
    const summary = buildSummary({
      elapsedMs: 4_200,
      expectedMs: name => (name === 'studio-canary' ? 30_000 : undefined),
      lane: 'verify-full',
      logRoot: '/repo/.artifacts/logs/verify-full/stamp',
      states: [
        finishedState({ name: 'studio-smoke-native', needs: ['_compile'], resources: ['gui'] }),
        finishedState({ name: 'studio-canary', resources: ['gui'] }),
      ],
    })

    Expect(summary.version).toBe(2)
    Expect(summary.lane).toBe('verify-full')
    Expect(summary.gates[0]?.needs).toEqual(['_compile'])
    Expect(summary.gates[0]?.resources).toEqual(['gui'])
    Expect(summary.gates[0]?.expectedMs).toBeUndefined()
    Expect(summary.gates[1]?.expectedMs).toBe(30_000)
  })

  Test('a node skipped by a failed dependency reports why, and never as passed', () => {
    const summary = buildSummary({
      elapsedMs: 900,
      lane: 'verify',
      logRoot: '/repo/logs',
      states: [
        finishedState({ name: '_compile' }, { exitCode: 1, fullOutput: 'compile blew up', status: 'failed' }),
        finishedState({ name: '_test', needs: ['_compile'] }, {
          elapsedMs: 0,
          exitCode: undefined,
          reason: 'dependency failed: _compile',
          status: 'skipped',
        }),
      ],
    })

    Expect(summary.gates.map(gate => gate.status)).toEqual(['failed', 'skipped'])
    Expect(summary.gates[1]?.reason).toBe('dependency failed: _compile')
    Expect(summary.firstFailure?.name).toBe('_compile')
    Expect(formatGateSummary(summary)).toContain('- _test: skipped — dependency failed: _compile')
    Expect(gateExitCode(summary)).toBe(1)
  })

  Test('an interrupted run fails even when nothing it managed to run failed', () => {
    const summary = buildSummary({
      elapsedMs: 500,
      interrupted: true,
      lane: 'verify',
      logRoot: '/repo/logs',
      states: [finishedState({ name: '_repo-lint' })],
    })

    Expect(summary.status).toBe('failed')
    Expect(gateExitCode(summary)).toBe(1)
  })

  Test('the rollup names both artifact paths an agent reads afterwards', () => {
    const summary = buildSummary({
      elapsedMs: 500,
      lane: 'verify',
      logRoot: '/repo/.artifacts/logs/verify/stamp',
      states: [finishedState({ name: '_repo-lint' })],
    })

    Expect(formatGateSummary(summary)).toContain('logs/verify/stamp')
    Expect(formatGateSummary(summary)).toContain('logs/verify/stamp/summary.json')
  })

  Test('reports a sharded suite as one line and names the shard that failed', () => {
    const summary = buildSummary({
      elapsedMs: 8_000,
      lane: 'verify',
      logRoot: '/repo/logs',
      states: [
        finishedState({ name: 'dev#1' }, { elapsedMs: 4_000 }),
        finishedState({ name: 'dev#2' }, {
          elapsedMs: 6_000,
          exitCode: 1,
          fullOutput: '(fail) renders the board',
          status: 'failed',
        }),
        finishedState({ name: 'stdlib' }, { elapsedMs: 1_000 }),
      ],
      suiteOf: name => (name.startsWith('dev') ? 'dev' : name === 'stdlib' ? 'stdlib' : undefined),
    })
    const rendered = formatGateSummary(summary)

    // A suite is a unit of reporting, not of scheduling: its wall time is its longest shard, and
    // the sum of the shards is the number that says what sharding bought.
    Expect(rollupSuites(summary.gates).map(gate => gate.name)).toEqual(['dev', 'stdlib'])
    Expect(rendered).toContain('- dev: failed 6.0s — 2 shards, 10.0s of work')
    Expect(rendered).not.toContain('- dev#1:')
    // A failing suite has to name the failing shard, or its log cannot be found.
    Expect(rendered).toContain('  - dev#2: failed')
    Expect(summary.firstFailure?.name).toBe('dev#2')
    // The totals count suites, so a sharded run does not read as more work than an unsharded one.
    Expect(rendered).toContain('1 passed, 1 failed, 0 skipped')
    // The per-node results are still published in full for the JSON consumers.
    Expect(summary.gates.map(gate => gate.name)).toEqual(['dev#1', 'dev#2', 'stdlib'])
    Expect(summary.gates[0]?.suite).toBe('dev')
    Expect(gateExitCode(summary)).toBe(1)
  })

  Test('rolls a suite up as skipped only when every one of its shards was skipped', () => {
    const skippedShard = (name: string) =>
      finishedState({ name }, { elapsedMs: 0, exitCode: undefined, reason: 'proved green', status: 'skipped' })
    const suiteOf = (name: string) => (name.startsWith('dev') ? 'dev' : undefined)
    const allSkipped = buildSummary({
      elapsedMs: 10,
      lane: 'verify',
      logRoot: '/repo/logs',
      states: [skippedShard('dev#1'), skippedShard('dev#2')],
      suiteOf,
    })
    const partlyRan = buildSummary({
      elapsedMs: 10,
      lane: 'verify',
      logRoot: '/repo/logs',
      states: [skippedShard('dev#1'), finishedState({ name: 'dev#2' })],
      suiteOf,
    })

    // Reporting a half-run suite as skipped would hide work; reporting it as passed would claim
    // coverage the skipped shard did not deliver, which is why the reason survives the rollup.
    Expect(rollupSuites(allSkipped.gates)[0]?.status).toBe('skipped')
    Expect(rollupSuites(allSkipped.gates)[0]?.reason).toBe('proved green')
    Expect(rollupSuites(partlyRan.gates)[0]?.status).toBe('passed')
  })

  Test('appends what the schedule achieved, and where it lost time', () => {
    const summary = buildSummary({
      elapsedMs: 5_000,
      lane: 'verify',
      logRoot: '/repo/logs',
      schedule: {
        capacity: 8,
        idleSlotSeconds: 12.5,
        makespanMs: 5_000,
        serialFloorMs: 3_000,
        serialFloorPath: ['_fix-dprint', '_typecheck'],
        waits: [{ name: '_typecheck', waits: [{ detail: '_fix-dprint', kind: 'dependency', ms: 1_200 }] }],
      },
      states: [finishedState({ name: '_typecheck' })],
    })
    const rendered = formatGateSummary(summary)

    // A lane that got faster because the machine was idle and one that got faster because its work
    // packs better are indistinguishable from a wall time alone.
    Expect(rendered).toContain('Schedule: 5.0s makespan, 3.0s serial floor (_fix-dprint -> _typecheck)')
    Expect(rendered).toContain('12.5 idle slot-seconds of 8')
    Expect(rendered).toContain('waited: _typecheck 1.2s on dependency _fix-dprint')
    Expect(summary.schedule?.capacity).toBe(8)
  })

  Test('says nothing about a schedule a run did not measure', () => {
    const summary = buildSummary({
      elapsedMs: 500,
      lane: 'verify',
      logRoot: '/repo/logs',
      states: [finishedState({ name: '_repo-lint' })],
    })

    Expect(summary.schedule).toBeUndefined()
    Expect(formatGateSummary(summary)).not.toContain('Schedule:')
  })

  Test('publishes what held each node, and drops scheduling noise', () => {
    const summary = buildSummary({
      elapsedMs: 1_000,
      lane: 'verify',
      logRoot: '/repo/logs',
      states: [
        finishedState({ name: '_typecheck' }, {
          waits: [{ detail: '_fix-dprint', kind: 'dependency', ms: 900 }, { kind: 'capacity', ms: 10 }],
        }),
        finishedState({ name: '_repo-lint' }),
      ],
    })

    Expect(summary.gates[0]?.waits).toEqual([{ detail: '_fix-dprint', kind: 'dependency', ms: 900 }])
    // A node that never waited says nothing, so the field itself means "this one was held".
    Expect(summary.gates[1]?.waits).toBeUndefined()
  })

  Test('ends on a verdict, after the artifact paths and the failure excerpt', () => {
    const passed = buildSummary({
      elapsedMs: 58_200,
      lane: 'verify',
      logRoot: '/repo/.artifacts/logs/verify/stamp',
      states: [finishedState({ name: '_repo-lint' })],
    })
    const failed = buildSummary({
      elapsedMs: 12_000,
      lane: 'verify',
      logRoot: '/repo/.artifacts/logs/verify/stamp',
      states: [
        finishedState({ name: '_typecheck' }),
        finishedState({ name: 'shared' }, { exitCode: 1, fullOutput: '(fail) parses', status: 'failed' }),
      ],
    })

    // Last means last: a verdict above the failure excerpt is one a reader scrolls back to.
    Expect(formatGateSummary(passed).split('\n').at(-1)).toBe('verify: PASSED in 58.2s')
    Expect(formatGateSummary(failed).split('\n').at(-1)).toBe('verify: FAILED in 12.0s — first failure: shared')
    Expect(formatGateSummary(failed)).toContain('First failure — shared')
  })

  Test('a lane skipped whole on a green record still states its verdict', () => {
    const skipped = buildSummary({
      elapsedMs: 300,
      lane: 'verify-full-sandbox',
      logRoot: '/repo/.artifacts/logs/verify-full/earlier',
      states: [
        finishedState({ name: '_typecheck' }, { elapsedMs: 0, exitCode: undefined, status: 'skipped' }),
      ],
    })

    // Nothing ran, so nothing above the last line says whether the tree is good.
    Expect(formatVerdict(skipped)).toBe('verify-full-sandbox: PASSED in 300ms')
  })

  Test('colors the verdict for a terminal and leaves a pipe free of escape codes', () => {
    const passed = buildSummary({
      elapsedMs: 1_000,
      lane: 'check',
      logRoot: '/repo/logs',
      states: [finishedState({ name: '_repo-lint' })],
    })
    const failed = buildSummary({
      elapsedMs: 1_000,
      lane: 'check',
      logRoot: '/repo/logs',
      states: [finishedState({ name: '_repo-lint' }, { exitCode: 1, fullOutput: '(fail) x', status: 'failed' })],
    })

    Expect(formatVerdict(passed, { color: true })).toBe('[32mcheck: PASSED in 1.0s[0m')
    Expect(formatVerdict(failed, { color: true })).toContain('[31m')
    // The default is plain, so a lane that never decided cannot leave escape codes in a log file.
    Expect(formatGateSummary(passed)).not.toContain('')
    Expect(formatGateSummary(failed)).not.toContain('')
    Expect(formatGateSummary(passed, { color: false })).not.toContain('')
  })

  Test('a test-runner timeout under measured contention is not hidden by its FAIL banner', () => {
    const contention = { contended: true, cpuCount: 8, peakLanes: 2, peakLoadAverage: 12 }

    Expect(classifyFailure(
      'FAIL packages/example.test.ts\n(fail) renders\nerror: Test "renders" timed out after 5000ms',
      { contention },
    )).toBe('machine-contention')
  })

  Test('recognizes the native runtime exit messages emitted by Studio', () => {
    Expect(classifyFailure('Native Studio runtime exited with code 7.')).toBe('native-runtime-exit')
    Expect(classifyFailure('Native Studio runtime terminated by signal 6.')).toBe('native-runtime-exit')
  })

  Test('recognizes generated-tree cleanup failures imposed by the host', () => {
    Expect(classifyFailure(
      "EFAULT: bad address in system call argument, rm '/repo/packages/ides/ide-extension/_gen_ide-extension/@tao'",
    )).toBe('sandbox-restriction')
    Expect(classifyFailure(
      "EPERM: operation not permitted, rmdir '/repo/packages/apps/expo-host/.artifacts/tests/run/_gen_tao-app'",
    )).toBe('sandbox-restriction')
  })

  Test('keeps unrelated bad-address failures assigned to the repository', () => {
    Expect(classifyFailure("EFAULT: bad address in system call argument, read '/repo/Apps/HNReader/App.tao'"))
      .toBe('repository')
    Expect(classifyFailure("EFAULT: bad address in system call argument, rm '/repo/Apps/HNReader/App.tao'"))
      .toBe('repository')
  })

  Test('recognizes a Chrome abort before DevTools despite the Bun failure banner', () => {
    Expect(classifyFailure([
      'HostEnvironmentError: Chrome exited before exposing DevTools (exit none, signal SIGABRT)',
      '(fail) Studio dialog restores its live background in Chrome [310.05ms]',
      '0 pass',
      '1 fail',
    ].join('\n'))).toBe('sandbox-restriction')
  })

  Test('does not let a Chrome host abort hide a browser assertion failure', () => {
    Expect(classifyFailure([
      'HostEnvironmentError: Chrome exited before exposing DevTools (exit none, signal SIGABRT)',
      '(fail) another browser test',
      'error: expect(received).toBe(expected)',
    ].join('\n'))).toBe('test-assertion')
  })
})
