import { Describe, Expect, Test } from '@shared/test'
import { testBudgetConventionIssues } from '../verification-src/TestBudgetConventions'

const testPath = 'packages/shared/shared-tests/example.test.ts'

Describe('test wall-clock budget convention', () => {
  Test('flags a short timeoutMs literal that wraps real work', () => {
    const source = [
      "Test('waits for a real process', async () => {",
      '  await until(() => FS.exists(path), { timeoutMs: 2_000 })',
      '})',
    ].join('\n')
    const issues = testBudgetConventionIssues([{ path: testPath, source }])
    Expect(issues).toHaveLength(1)
    Expect(issues[0]).toContain(`${testPath}:2`)
    Expect(issues[0]).toContain('a budget in a test is for a busy host, not for a slow condition')
  })

  Test('allows a short timeoutMs literal marked budget-ok on its own or the previous line', () => {
    const source = [
      "Test('proves the timeout fires', async () => {",
      '  // budget-ok: this is the timeout under test.',
      '  await until(() => false, { timeoutMs: 20 })',
      '  await until(() => false, { timeoutMs: 30 }) // budget-ok: also the timeout under test.',
      '})',
    ].join('\n')
    Expect(testBudgetConventionIssues([{ path: testPath, source }])).toEqual([])
  })

  Test('does not flag a timeoutMs at or above the budget threshold', () => {
    const source = 'await until(() => FS.exists(path), { timeoutMs: 10_000 })'
    Expect(testBudgetConventionIssues([{ path: testPath, source }])).toEqual([])
  })

  Test('does not flag a literal that is part of an arithmetic expression', () => {
    const source = 'const spec = { timeoutMs: 30 * 60_000 }'
    Expect(testBudgetConventionIssues([{ path: testPath, source }])).toEqual([])
  })

  Test('does not let a trailing budget-ok on the previous line cover an unrelated short budget below it', () => {
    const source = [
      'doRealWork() // budget-ok: this call is the timeout under test, not the one below.',
      'await until(() => false, { timeoutMs: 20 })',
    ].join('\n')
    const issues = testBudgetConventionIssues([{ path: testPath, source }])
    Expect(issues).toHaveLength(1)
    Expect(issues[0]).toContain(`${testPath}:2`)
  })

  Test('flags a speed assertion on elapsed wall time below the threshold', () => {
    const source = [
      'const startedAt = Date.now()',
      'Expect(Date.now() - startedAt).toBeLessThan(750)',
    ].join('\n')
    const issues = testBudgetConventionIssues([{ path: testPath, source }])
    Expect(issues).toHaveLength(1)
    Expect(issues[0]).toContain(`${testPath}:2`)
  })

  Test('flags a toBeLessThanOrEqual assertion on a *Ms operand below the threshold', () => {
    const source = 'Expect(reports[0]?.waitedMs).toBeLessThanOrEqual(1_000)'
    Expect(testBudgetConventionIssues([{ path: testPath, source }])).toHaveLength(1)
  })

  Test('allows a speed assertion whose operand has no timing keyword', () => {
    const source = 'Expect(report.contentionRatio).toBeLessThan(1.5)'
    Expect(testBudgetConventionIssues([{ path: testPath, source }])).toEqual([])
  })

  Test('allows a speed assertion whose operand only holds Ms as part of another word', () => {
    const source = 'Expect(errorMsgs.length).toBeLessThan(3)'
    Expect(testBudgetConventionIssues([{ path: testPath, source }])).toEqual([])
  })

  Test('allows a speed assertion marked budget-ok on the previous line', () => {
    const source = [
      '// budget-ok: bounds scheduling overhead alone, not real work.',
      'Expect(Time.nowMs() - startedMs).toBeLessThan(2_000)',
    ].join('\n')
    Expect(testBudgetConventionIssues([{ path: testPath, source }])).toEqual([])
  })

  Test('flags a Promise.race that arbitrates real work against a bare sleep', () => {
    const source = [
      "Test('reclaims a lock', async () => {",
      '  Expect(await Promise.race([opened, Time.sleep(500).then(() => false)])).toBe(true)',
      '})',
    ].join('\n')
    const issues = testBudgetConventionIssues([{ path: testPath, source }])
    Expect(issues).toHaveLength(1)
    Expect(issues[0]).toContain(`${testPath}:2`)
  })

  Test('flags a multi-line Promise.race racing a setTimeout against real work', () => {
    const source = [
      'await Expect(Promise.race([',
      '  opening,',
      "  Time.sleep(500).then(() => Errors.throwUnexpected('too slow')),",
      '])).rejects.toThrow(/no valid owner/u)',
    ].join('\n')
    const issues = testBudgetConventionIssues([{ path: testPath, source }])
    Expect(issues).toHaveLength(1)
    Expect(issues[0]).toContain(`${testPath}:1`)
  })

  Test('allows awaiting the real promise directly instead of racing it against a sleep', () => {
    const source = 'Expect(await opened).toBe(true)'
    Expect(testBudgetConventionIssues([{ path: testPath, source }])).toEqual([])
  })

  Test('allows a Promise.race marked budget-ok', () => {
    const source = [
      '// budget-ok: both branches settle in-memory, no real wall time at stake.',
      'await Promise.race([fakeOpened, Time.sleep(5).then(() => false)])',
    ].join('\n')
    Expect(testBudgetConventionIssues([{ path: testPath, source }])).toEqual([])
  })

  Test('is scoped to test files: a package-source file with the same shapes is not scanned', () => {
    const source = 'await until(() => FS.exists(path), { timeoutMs: 2_000 })'
    Expect(testBudgetConventionIssues([{ path: 'packages/shared/shared-src/Thing.ts', source }])).toEqual([])
  })

  Test('excludes its own test file, whose fixtures are the violations it proves it catches', () => {
    const source = 'await until(() => FS.exists(path), { timeoutMs: 2_000 })'
    const ownPath = 'packages/testing/verification/verification-tests/test-budget-conventions.test.ts'
    Expect(testBudgetConventionIssues([{ path: ownPath, source }])).toEqual([])
  })

  Test('scans every named test-file shape the sweep covered', () => {
    const source = 'await until(() => FS.exists(path), { timeoutMs: 2_000 })'
    const paths = [
      'packages/shared/shared-tests/example.test.ts',
      'packages/apps/runtime/TR-tests/example.test.ts',
      'packages/cli/tao-cli/cli-tests/example.test.ts',
      'packages/ides/studio-tooling/studio-smoke/example.test.ts',
      'packages/testing/e2e-testing/browser/example.host.spec.ts',
      'packages/apps/expo-host/expo-host-tests/example.jest-test.tsx',
    ]
    for (const path of paths) {
      Expect(testBudgetConventionIssues([{ path, source }])).toHaveLength(1)
    }
  })
})
