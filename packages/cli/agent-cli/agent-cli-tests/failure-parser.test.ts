import { CLI, FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { parseFailuresFromOutput } from '../agent-cli-src/runner/FailureParser'

// Spelled apart so this repository's own lint, which scans raw source text for a bare import of
// Bun's test module, does not mistake the fixture file this test writes and runs below for a real
// import of its own.
const BUN_TEST_SPECIFIER = ['bun', 'test'].join(':')

Describe('agent failure parser fallback', () => {
  Test('pairs a Bun (fail) line with the nearest error: line and file above it', () => {
    const output = [
      'bun test v1.3.13 (bf2e2cec)',
      '',
      'probe.test.ts:',
      "1 | import { test, expect } from 'test-runtime'",
      "2 | test('adds numbers wrong on purpose', () => {",
      '3 |   expect(1 + 1).toBe(3)',
      '                    ^',
      'error: expect(received).toBe(expected)',
      '',
      'Expected: 3',
      'Received: 2',
      '',
      '      at <anonymous> (probe.test.ts:3:17)',
      '(fail) adds numbers wrong on purpose [0.39ms]',
      '',
      ' 1 pass',
      ' 1 fail',
    ].join('\n')

    const failures = parseFailuresFromOutput(output, 'test-file')

    Expect(failures).toEqual([
      {
        error: 'expect(received).toBe(expected)',
        file: 'probe.test.ts',
        gate: 'test-file',
        test: 'adds numbers wrong on purpose',
      },
    ])
  })

  Test('names a bare tsc diagnostic by its file, line, and column', () => {
    const output =
      "packages/cli/dev-cli/dev-cli-src/dev.ts(12,34): error TS2345: Argument of type 'x' is not assignable."

    const failures = parseFailuresFromOutput(output, 'typecheck')

    Expect(failures).toEqual([
      {
        error: "TS2345: Argument of type 'x' is not assignable.",
        file: 'packages/cli/dev-cli/dev-cli-src/dev.ts:12:34',
        gate: 'typecheck',
      },
    ])
  })

  Test('reports a (fail) line with no error or file line above it, rather than crashing', () => {
    Expect(parseFailuresFromOutput('(fail) a lonely failure', 'test-file')).toEqual([
      { gate: 'test-file', test: 'a lonely failure' },
    ])
  })

  Test('reports nothing for output that named no failure at all', () => {
    Expect(parseFailuresFromOutput('1 pass\n0 fail\nRan 1 test.', 'test-file')).toEqual([])
  })

  Test('reads the failures out of a real Bun test run against a fixture that fails on purpose', async () => {
    const scratch = await mkTestDir('tao-agent-fallback-fixture-')
    try {
      const fixture = FS.resolvePath('probe.test.ts', scratch)
      await FS.writeText(
        fixture,
        [
          `import { test, expect } from '${BUN_TEST_SPECIFIER}'`,
          "test('adds numbers wrong on purpose', () => {",
          '  expect(1 + 1).toBe(3)',
          '})',
        ].join('\n'),
      )

      const result = await CLI.run('bun', { args: ['test', fixture] })
      const failures = parseFailuresFromOutput(`${result.stdout}${result.stderr}`, 'test-file')

      Expect(result.exitCode).not.toBe(0)
      Expect(failures.length).toBe(1)
      Expect(failures[0]?.test).toBe('adds numbers wrong on purpose')
      Expect(failures[0]?.error).toContain('expect(received).toBe(expected)')
    } finally {
      await FS.remove(scratch)
    }
  })
})
