import { Platform, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { RunArtifacts } from '../verification-src/RunArtifacts'
import {
  buildSummary,
  classifyFailure,
  formatGateSummary,
  formatVerdict,
  gateExitCode,
  rollupSuites,
} from '../verification-src/RunSummary'
import { WorkGraph, type WorkNode, type WorkState } from '../verification-src/WorkGraph'

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

  Test('reports a partially run suite as incomplete while preserving the work that ran', () => {
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

    // The reason preserves work that ran without claiming the missing shard passed.
    Expect(rollupSuites(allSkipped.gates)[0]?.status).toBe('skipped')
    Expect(rollupSuites(allSkipped.gates)[0]?.reason).toBe('proved green')
    Expect(rollupSuites(partlyRan.gates)[0]?.status).toBe('skipped')
    Expect(rollupSuites(partlyRan.gates)[0]?.reason).toContain('1 not run: proved green')
  })

  Test('a failed suite names shards that fail-fast left unrun', () => {
    const summary = buildSummary({
      elapsedMs: 10,
      lane: 'verify',
      logRoot: '/unused',
      states: [
        finishedState({ name: 'dev#1' }, { status: 'failed', exitCode: 1, fullOutput: 'defect' }),
        finishedState({ name: 'dev#2' }, {
          status: 'skipped',
          elapsedMs: 0,
          reason: 'not run after definite failure: dev#1',
        }),
      ],
      suiteOf: () => 'dev',
    })
    Expect(rollupSuites(summary.gates)[0]?.status).toBe('failed')
    Expect(formatGateSummary(summary)).toContain('1 not run: not run after definite failure: dev#1')
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

Describe('structured failures', () => {
  // Captured from a real `bun test` run against one failing assertion, rather than hand-typed: the
  // blank lines, the `error:` line preceding the `(fail)` line, and the `at` frame's exact shape all
  // matter to the parser and are easy to get subtly wrong by hand.
  const BUN_LOG = [
    'sample.test.ts:',
    // The specifier is split so this fixture line is not itself read as a direct runner import.
    '1 | import { describe, test, expect } from "bun' + ':test"',
    '2 | ',
    '3 | describe("widget board", () => {',
    '4 |   test("renders the board", () => {',
    '5 |     expect(1).toBe(2)',
    '                  ^',
    'error: expect(received).toBe(expected)',
    '',
    'Expected: 2',
    'Received: 1',
    '',
    '      at <anonymous> (sample.test.ts:5:15)',
    '(fail) widget board > renders the board [0.18ms]',
    '',
    ' 1 pass',
    ' 1 fail',
    ' 2 expect() calls',
    'Ran 2 tests across 1 file. [31.00ms]',
  ].join('\n')

  // Captured from a real Jest run: `●` heads the failure, the assertion line follows it, and the
  // numbered source-frame lines between it and the `at` frame must not be mistaken for the assertion.
  const JEST_LOG = [
    'FAIL jest-sample.test.js',
    '  widget board',
    '    ✕ renders the board (2 ms)',
    '    ✓ passes',
    '',
    '  ● widget board › renders the board',
    '',
    '    expect(received).toBe(expected) // Object.is equality',
    '',
    '    Expected: 2',
    '    Received: 1',
    '',
    '      1 | describe("widget board", () => {',
    '      2 |   test("renders the board", () => {',
    '    > 3 |     expect(1).toBe(2)',
    '        |               ^',
    '      4 |   })',
    '      5 |   test("passes", () => {',
    '      6 |     expect(1).toBe(1)',
    '',
    '      at Object.toBe (jest-sample.test.js:3:15)',
    '',
    'Test Suites: 1 failed, 1 total',
    'Tests:       1 failed, 1 passed, 2 total',
  ].join('\n')

  // The repository's own sharded test runner, as `TestResultSummary.printSuiteSummaries` writes it.
  const SHARDED_LOG = [
    'Test suite summary:',
    '- language/validator: failed; tests 120; pass 118; fail 2; expect 340; duration 4.2s; 2 shards over 6.1s of work',
    '- language/parser: passed; tests 40; pass 40; fail 0; expect 90; duration 1.1s',
  ].join('\n')

  const TSC_LOG = "packages/foo/bar.ts(12,5): error TS2345: Argument of type 'string' is not assignable "
    + "to parameter of type 'number'."

  const ISSUE_LOG = [
    'repo lint: packages/foo/bar.ts:42 writes through the global console; use `HCI.writeLine`',
    'dead exports: packages/foo/baz.ts:10 someExport is exported but never imported.',
  ].join('\n')

  function failedSummary(fullOutput: string, name = 'shared') {
    return buildSummary({
      elapsedMs: 100,
      lane: 'verify',
      logRoot: '/repo/logs',
      states: [finishedState({ name }, { exitCode: 1, fullOutput, status: 'failed' })],
    })
  }

  Test('extracts a failing Bun test, its assertion, and its source frame', () => {
    const summary = failedSummary(BUN_LOG)

    Expect(summary.gates[0]?.failures).toEqual([
      {
        error: 'expect(received).toBe(expected)',
        file: 'sample.test.ts:5:15',
        test: 'widget board > renders the board',
      },
    ])
    Expect(summary.gates[0]?.failuresTruncated).toBeUndefined()
    Expect(summary.failures).toEqual([
      {
        error: 'expect(received).toBe(expected)',
        file: 'sample.test.ts:5:15',
        gate: 'shared',
        test: 'widget board > renders the board',
      },
    ])
  })

  Test('extracts a failing Jest test, its assertion, and its source frame', () => {
    const summary = failedSummary(JEST_LOG, 'runtime-jest')

    Expect(summary.gates[0]?.failures).toEqual([
      {
        error: 'expect(received).toBe(expected) // Object.is equality',
        file: 'jest-sample.test.js:3:15',
        test: 'widget board › renders the board',
      },
    ])
  })

  Test("extracts the repository's own sharded suite failures from a gate that embeds them", () => {
    const summary = failedSummary(SHARDED_LOG, 'dev')

    Expect(summary.gates[0]?.failures).toEqual([
      { error: '2 of 120 tests failed (118 passed)', test: 'language/validator' },
    ])
  })

  Test('extracts a tsc diagnostic, naming its file and message', () => {
    const summary = failedSummary(TSC_LOG, '_typecheck')

    Expect(summary.gates[0]?.failures).toEqual([
      {
        error: "TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.",
        file: 'packages/foo/bar.ts:12:5',
        test: TSC_LOG,
      },
    ])
  })

  Test('extracts repo-lint and dead-exports issue lines, one failure per line', () => {
    const summary = failedSummary(ISSUE_LOG, '_repo-lint')

    // `test` is the issue's own detail, not the whole prefixed line, and carries no `error` of its
    // own — `formatFailureLine` would otherwise have nothing left to add without repeating it.
    Expect(summary.gates[0]?.failures).toEqual([
      { file: 'packages/foo/bar.ts:42', test: 'writes through the global console; use `HCI.writeLine`' },
      { file: 'packages/foo/baz.ts:10', test: 'someExport is exported but never imported.' },
    ])
  })

  Test('excludes an issue-prefixed summary count line that names no path:line', () => {
    const summary = failedSummary(
      'dead exports: 2 unused, 159 bound from .tao sources, 3 reached through a namespace facade, '
        + '0 republished by an import-type query.',
      'dead-exports',
    )

    Expect(summary.gates[0]?.failures).toBeUndefined()
    Expect(summary.failures).toBeUndefined()
  })

  Test('caps one gate at 20 failures and counts the rest instead of dropping them silently', () => {
    const lines = (start: number) => Array.from({ length: 25 }, (_, index) => `(fail) t${start + index} [1ms]`)
    const summary = failedSummary(lines(0).join('\n'))

    Expect(summary.gates[0]?.failures).toHaveLength(20)
    Expect(summary.gates[0]?.failuresTruncated).toBe(5)
  })

  Test("caps the summary's own failures list at 40 across every failed gate", () => {
    const lines = (start: number) => Array.from({ length: 25 }, (_, index) => `(fail) t${start + index} [1ms]`)
    const summary = buildSummary({
      elapsedMs: 100,
      lane: 'verify',
      logRoot: '/repo/logs',
      states: [
        finishedState({ name: 'a' }, { exitCode: 1, fullOutput: lines(0).join('\n'), status: 'failed' }),
        finishedState({ name: 'b' }, { exitCode: 1, fullOutput: lines(100).join('\n'), status: 'failed' }),
      ],
    })

    Expect(summary.failures).toHaveLength(40)
  })

  Test('a tolerated node carries no failures once it is reported passed', () => {
    const summary = buildSummary({
      elapsedMs: 100,
      lane: 'verify',
      logRoot: '/repo/logs',
      states: [finishedState({ name: 'shared' }, { exitCode: 1, fullOutput: BUN_LOG, status: 'failed' })],
      toleratedFlakes: [{
        evidence: '3 outcome reversals in the last 4 recorded runs',
        file: 'sample.test.ts',
        id: 'widget board > renders the board',
        node: 'shared',
      }],
    })

    Expect(summary.gates[0]?.status).toBe('passed')
    Expect(summary.gates[0]?.failures).toBeUndefined()
    Expect(summary.gates[0]?.failuresTruncated).toBeUndefined()
    Expect(summary.failures).toBeUndefined()
  })

  Test('formatGateSummary prints a Failed: block before the raw excerpt', () => {
    const summary = failedSummary(BUN_LOG)
    const rendered = formatGateSummary(summary)

    const failedIndex = rendered.indexOf('Failed:')
    const firstFailureIndex = rendered.indexOf('First failure —')
    Expect(failedIndex).toBeGreaterThan(-1)
    Expect(failedIndex).toBeLessThan(firstFailureIndex)
    Expect(rendered).toContain(
      '- shared › widget board > renders the board — expect(received).toBe(expected) (sample.test.ts:5:15)',
    )
  })

  Test('formatGateSummary shrinks the raw excerpt to 15 lines once Failed: already names the test', () => {
    const markers = Array.from({ length: 30 }, (_, index) => `marker${index}`).join('\n')
    const summary = failedSummary(`${markers}\n${BUN_LOG}`)

    // The build-time excerpt still keeps 40 lines, so the JSON artifact is unaffected.
    Expect(summary.firstFailure?.output).toContain('marker29')
    // Once `Failed:` already names the test, the raw tail beside it shrinks to 15 lines — short
    // enough that none of the 30 marker lines above the Bun transcript survive into it.
    Expect(formatGateSummary(summary)).not.toContain('marker')
  })

  Test('formatGateSummary keeps the raw excerpt at 40 lines when nothing was extracted', () => {
    const markers = Array.from({ length: 30 }, (_, index) => `marker${index}`).join('\n')
    const summary = failedSummary(`${markers}\nsegmentation fault\ncore dumped`)

    Expect(summary.failures).toBeUndefined()
    Expect(formatGateSummary(summary)).toContain('marker0')
  })

  Test('formatGateSummary shows at most 20 Failed lines and counts the rest', () => {
    const lines = (start: number) => Array.from({ length: 25 }, (_, index) => `(fail) t${start + index} [1ms]`)
    const summary = buildSummary({
      elapsedMs: 100,
      lane: 'verify',
      logRoot: '/repo/logs',
      states: [
        finishedState({ name: 'a' }, { exitCode: 1, fullOutput: lines(0).join('\n'), status: 'failed' }),
        finishedState({ name: 'b' }, { exitCode: 1, fullOutput: lines(100).join('\n'), status: 'failed' }),
      ],
    })
    const rendered = formatGateSummary(summary)
    const failedLines = rendered.split('\n').filter(line => line.startsWith('- ') && line.includes(' › '))

    Expect(failedLines).toHaveLength(20)
    Expect(rendered).toContain('… and 20 more')
  })

  Test('formatGateSummary prints an absolute failure path relative to the repository root', () => {
    const absolute = Repo.resolvePath('packages/foo/bar.ts')
    const log = `${absolute}(12,5): error TS2345: Argument of type 'string' is not assignable `
      + "to parameter of type 'number'."
    const summary = failedSummary(log, '_typecheck')
    const rendered = formatGateSummary(summary)

    // `(file:line:col)` is the trailing location every reader clicks on; it is rewritten relative
    // to the repository root, even though the diagnostic's own raw text — quoted verbatim as the
    // test name — still carries the absolute path it was extracted from.
    Expect(rendered).toContain('(packages/foo/bar.ts:12:5)')
    Expect(rendered).not.toContain(`(${absolute}:12:5)`)
  })

  Test('formatGateSummary truncates only the error text at the width limit, never the file:line', () => {
    const longAssertion = `expect(received).toBe(expected) ${'x'.repeat(300)}`
    const log = [
      'sample.test.ts:',
      '1 | import { describe, test, expect } from "bun' + ':test"',
      '5 |     expect(1).toBe(2)',
      `error: ${longAssertion}`,
      '      at <anonymous> (sample.test.ts:5:15)',
      '(fail) widget board > renders the board [0.18ms]',
    ].join('\n')
    const summary = failedSummary(log)
    const rendered = formatGateSummary(summary)
    const failedLine = rendered.split('\n').find(line => line.startsWith('- shared › '))

    Expect(failedLine).toBeDefined()
    Expect(failedLine!.length).toBeLessThanOrEqual(160)
    Expect(failedLine).toContain('(sample.test.ts:5:15)')
    Expect(failedLine).toContain('…')
  })

  Test('formatGateSummary renders a repo-lint issue line once, truncating its long detail instead of the file', () => {
    const longDetail = "constructs a raw Error; use the repo's error constructors instead, build "
      + `\`new Errors.UnexpectedBehaviorError(...)\` ${'x'.repeat(200)}`
    const file = 'packages/testing/verification/verification-tests/merge-with-main.test.ts:970'
    const log = `repo lint: ${file} ${longDetail}`
    const summary = failedSummary(log, '_repo-lint')
    const rendered = formatGateSummary(summary)
    const failedLine = rendered.split('\n').find(line => line.startsWith('- _repo-lint › '))

    Expect(failedLine).toBeDefined()
    Expect(failedLine!.length).toBeLessThanOrEqual(160)
    Expect(failedLine).toContain(`(${file})`)
    Expect(failedLine).toContain('…')
    // The detail appears exactly once — no ` — <detail again>` echo now that an issue line never
    // sets both `test` and `error` to the same text.
    Expect(failedLine?.match(/constructs a raw Error/g)?.length).toBe(1)
  })
})
