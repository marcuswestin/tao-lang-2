import { Describe, Expect, Test } from '@shared/test'
import {
  buildJsonReport,
  buildReportText,
  failedBlock,
  startLine,
} from '../agent-cli-src/runner/AgentReport'
import type { AgentFailure } from '../agent-cli-src/runner/FailureParser'

const PASSED = {
  args: [],
  command: 'test-file',
  durationMs: 1_234,
  exitCode: 0,
  failures: [] as readonly AgentFailure[],
  logPath: '.artifacts/logs/agent/test-file/latest.log',
  output: 'ok\n1 pass\n0 fail',
}

Describe('agent report', () => {
  Test('formats the start line with its log path', () => {
    Expect(startLine('verify', '/a/verify/latest.log')).toBe('verify: running — log /a/verify/latest.log')
  })

  Test('names each failure by gate, test, error, and file', () => {
    const failures: AgentFailure[] = [
      { error: 'expect(received).toBe(expected)', file: 'probe.test.ts', gate: 'test-file', test: 'adds numbers' },
      { gate: 'typecheck' },
    ]

    Expect(failedBlock(failures)).toEqual([
      'Failed:',
      '  - test-file — adds numbers — expect(received).toBe(expected) (probe.test.ts)',
      '  - typecheck',
    ])
  })

  Test('omits error and file from a failure line once test already carries the same text', () => {
    // A repo-lint or dead-exports issue names its own detail and location only once, in `test`; a
    // failure line built from it must not echo either back as `error` or `(file)`.
    const failures: AgentFailure[] = [{
      error: "constructs a raw Error; use the repo's error constructors",
      file: 'packages/testing/verification/verification-tests/merge-with-main.test.ts:970',
      gate: '_repo-lint',
      test: 'packages/testing/verification/verification-tests/merge-with-main.test.ts:970 constructs a raw Error; '
        + "use the repo's error constructors",
    }]

    Expect(failedBlock(failures)).toEqual([
      'Failed:',
      '  - _repo-lint — packages/testing/verification/verification-tests/merge-with-main.test.ts:970 constructs '
      + "a raw Error; use the repo's error constructors",
    ])
  })

  Test('bounds the Failed: block to 20 lines plus an elision line', () => {
    const failures: AgentFailure[] = Array.from(
      { length: 25 },
      (_, index) => ({ gate: 'test-file', test: `t${index}` }),
    )

    const block = failedBlock(failures)

    Expect(block[0]).toBe('Failed:')
    Expect(block.length).toBe(22)
    Expect(block.at(-1)).toBe('… and 5 more')
  })

  Test('renders a passing report ending in the log path, with no Failed: block', () => {
    const text = buildReportText(PASSED)

    Expect(text).toBe(['REPORT:', 'test-file: passed (exit 0) in 1.2s', 'ok', '1 pass', '0 fail', PASSED.logPath].join(
      '\n',
    ))
  })

  Test('renders a failing report with its Failed: block ahead of the bounded output', () => {
    const outcome = {
      ...PASSED,
      exitCode: 1,
      failures: [{ gate: 'test-file', test: 'adds numbers' }] as readonly AgentFailure[],
      output: '(fail) adds numbers',
    }

    const text = buildReportText(outcome)

    Expect(text).toBe(
      [
        'REPORT:',
        'test-file: failed (exit 1) in 1.2s',
        'Failed:',
        '  - test-file — adds numbers',
        '(fail) adds numbers',
        PASSED.logPath,
      ]
        .join('\n'),
    )
  })

  Test("drops the child lane's own Failed: block from the tail, keeping the rest around it", () => {
    const outcome = {
      ...PASSED,
      exitCode: 1,
      failures: [{ gate: 'shared', test: 'renders the board' }] as readonly AgentFailure[],
      output: [
        '',
        'Failed:',
        '  - shared › renders the board — expect(received).toBe(expected) (sample.test.ts:5:15)',
        '',
        'First failure — shared:',
        'expect(received).toBe(expected)',
        'Full log: .artifacts/logs/verify-full/latest/shared.log',
        'verify-full: FAILED in 12.0s — first failure: shared',
      ].join('\n'),
    }

    const text = buildReportText(outcome)

    Expect(text).toBe(
      [
        'REPORT:',
        'test-file: failed (exit 1) in 1.2s',
        'Failed:',
        '  - shared — renders the board',
        '',
        '',
        'First failure — shared:',
        'expect(received).toBe(expected)',
        'Full log: .artifacts/logs/verify-full/latest/shared.log',
        'verify-full: FAILED in 12.0s — first failure: shared',
        PASSED.logPath,
      ].join('\n'),
    )
  })

  Test('omits the child output in verbose mode, since it already streamed live', () => {
    const text = buildReportText(PASSED, { verbose: true })

    Expect(text).toBe(['REPORT:', 'test-file: passed (exit 0) in 1.2s', PASSED.logPath].join('\n'))
  })

  Test('builds the one JSON object --json prints, with the bounded output as tail', () => {
    const report = buildJsonReport(PASSED)

    Expect(report).toEqual({
      args: [],
      command: 'test-file',
      durationMs: 1_234,
      exitCode: 0,
      failures: [],
      failuresTruncated: false,
      logPath: PASSED.logPath,
      tail: ['ok', '1 pass', '0 fail'],
      warnings: [],
    })
  })

  Test('names an unwritable log instead of a path nothing was ever written to', () => {
    const outcome = { ...PASSED, logUnavailable: 'EACCES: permission denied' }

    const text = buildReportText(outcome)
    Expect(text.endsWith('log unavailable: EACCES: permission denied')).toBe(true)
    Expect(text).not.toContain(PASSED.logPath)

    const report = buildJsonReport(outcome)
    Expect(report.logUnavailable).toBe('EACCES: permission denied')
    Expect(report.logPath).toBe(PASSED.logPath)
  })

  Test('retains warnings in successful clipped and verbose reports', () => {
    const outcome = {
      ...PASSED,
      output: Array.from({ length: 30 }, (_, index) => `child line ${index}`).join('\n'),
      warnings: ['This command opens a visible window.'],
    }

    for (const options of [{ maxLines: 1 }, { verbose: true }]) {
      const text = buildReportText(outcome, options)
      Expect(text).toContain('test-file: passed (exit 0)')
      Expect(text).toContain('WARNING: This command opens a visible window.')
      Expect(text).not.toContain('child line 0\n')
    }
    const report = buildJsonReport(outcome, { maxLines: 1 })
    Expect(report.warnings).toEqual(['This command opens a visible window.'])
    Expect(report.tail).not.toContain('child line 0')
  })

  Test('caps --json failures at the same limit as the text report and names the cut', () => {
    const failures: AgentFailure[] = Array.from(
      { length: 25 },
      (_, index) => ({ gate: 'test-file', test: `t${index}` }),
    )

    const report = buildJsonReport({ ...PASSED, exitCode: 1, failures })

    Expect(report.failures.length).toBe(20)
    Expect(report.failuresTruncated).toBe(true)
  })
})
