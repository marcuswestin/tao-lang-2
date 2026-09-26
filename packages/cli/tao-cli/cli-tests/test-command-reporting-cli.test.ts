import { FS, Text } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { runTaoCliForTest, withTaoFixture } from './test-cli-files'
import {
  listRunRoots,
  outputText,
  reportFixture,
  withEnv,
  withJestStub,
  withRuntimeRoot,
} from './test-command-fixtures'

/** RUNNER_REPORT_LINES is how many per-test lines the stubbed test runner prints before its summary. */
const RUNNER_REPORT_LINES = 60

/** runnerLine names one stubbed per-test output line by its position in the report. */
function runnerLine(position: number): string {
  return `runner-line-${String(position).padStart(3, '0')}`
}

/** stubbedRunnerReport builds one test runner report: a line per test, then the result summary. */
function stubbedRunnerReport(counts: { failed: number; passed: number }): string {
  const total = counts.failed + counts.passed
  const failedPrefix = counts.failed > 0 ? `${counts.failed} failed, ` : ''
  return [
    ...Array.from({ length: RUNNER_REPORT_LINES }, (_unused, index) => runnerLine(index + 1)),
    '',
    `Test Suites: ${counts.failed > 0 ? '1 failed, ' : ''}1 total`,
    `Tests:       ${failedPrefix}${counts.passed} passed, ${total} total`,
    'Snapshots:   0 total',
    'Time:        1.234 s',
    'Ran all test suites.',
    '',
  ].join('\n')
}

/** jestStubSource writes a runtime test runner stand-in that prints a report and exits with a code. */
function jestStubSource(report: string, exitCode: number): string {
  // The real runner reports through stderr, so the stub does too.
  return `process.stderr.write(${JSON.stringify(report)})\nprocess.exit(${exitCode})\n`
}

function nonEmptyLines(output: string): string[] {
  return output.split('\n').filter(line => line.trim().length > 0)
}

/** resultCountLine finds the line an outer test runner scrapes this command's test counts from. */
function resultCountLine(output: string): string | undefined {
  return nonEmptyLines(output).find(line => line.trim().startsWith('Tests:'))
}

Describe('tao test CLI reporting', () => {
  Test('keeps a passing quiet run to its phase lines and the test result summary', async () => {
    await withTaoFixture({
      ...reportFixture,
      'jest-stub.mjs': jestStubSource(stubbedRunnerReport({ failed: 0, passed: 2 }), 0),
    }, async rootDir => {
      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(FS.resolvePath('runtime-root', rootDir), async () => {
          const result = await runTaoCliForTest(['test', rootDir, '--output', 'quiet'])
          const output = outputText(result)

          Expect(result.exitCode).toBe(0)
          // The repository test runner counts Tao behavior tests by scraping this line out of the
          // command's output, so a quiet run must still print it unprefixed.
          Expect(resultCountLine(output)).toBe('Tests:       2 passed, 2 total')
          Expect(output).toContain('Time:        1.234 s')
          Expect(output).not.toContain(runnerLine(1))
          Expect(output).not.toContain(runnerLine(RUNNER_REPORT_LINES))
          Expect(nonEmptyLines(output).length).toBeLessThanOrEqual(12)
        })
      })
    })
  })

  Test('streams the whole test runner report once in lines mode', async () => {
    await withTaoFixture({
      ...reportFixture,
      'jest-stub.mjs': jestStubSource(stubbedRunnerReport({ failed: 0, passed: 2 }), 0),
    }, async rootDir => {
      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(FS.resolvePath('runtime-root', rootDir), async () => {
          const result = await runTaoCliForTest(['test', rootDir, '--output', 'lines'])
          const output = outputText(result)

          Expect(result.exitCode).toBe(0)
          Expect(output).toContain(runnerLine(1))
          Expect(output).toContain(runnerLine(RUNNER_REPORT_LINES))
          // The streamed lines already carry the summary; the finished-run report must not repeat it.
          Expect(nonEmptyLines(output).filter(line => line.trim().startsWith('Tests:'))).toEqual([
            'Tests:       2 passed, 2 total',
          ])
        })
      })
    })
  })

  Test('names the log file and prints the end of a failing quiet run', async () => {
    await withTaoFixture({
      ...reportFixture,
      'jest-stub.mjs': jestStubSource(stubbedRunnerReport({ failed: 1, passed: 1 }), 1),
    }, async rootDir => {
      const runtimeRoot = FS.resolvePath('runtime-root', rootDir)

      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(runtimeRoot, async () => {
          const result = await runTaoCliForTest(['test', rootDir, '--output', 'quiet'])
          const output = outputText(result)

          Expect(result.exitCode).toBe(1)
          Expect(output).toContain('... 25 earlier output lines omitted ...')
          Expect(output).toContain(runnerLine(26))
          Expect(output).toContain(runnerLine(RUNNER_REPORT_LINES))
          Expect(output).not.toContain(runnerLine(25))
          Expect(resultCountLine(output)).toBe('Tests:       1 failed, 1 passed, 2 total')

          const runRoots = await listRunRoots(runtimeRoot)
          Expect(runRoots.length).toBe(1)
          const logPath = FS.resolvePath(
            `_gen_tao-app-test/tao-test-command/${runRoots[0]}/test-output.log`,
            runtimeRoot,
          )
          const logLine = nonEmptyLines(output).find(line => line.startsWith('log: '))
          Expect(logLine).toBeDefined()
          Expect(FS.resolvePath(logLine!.slice('log: '.length))).toBe(logPath)
          // Only the tail reached the terminal; the log keeps every line the runner wrote.
          const logged = await FS.readText(logPath)
          Expect(logged).toContain(runnerLine(1))
          Expect(logged).toContain(runnerLine(RUNNER_REPORT_LINES))
        })
      })
    })
  })

  Test('rejects an unknown output mode', async () => {
    await withTaoFixture(reportFixture, async rootDir => {
      const result = await runTaoCliForTest(['test', rootDir, '--output', 'dashboard'])

      Expect(result.exitCode).toBe(1)
      Expect(Text.stripAnsi(result.stderr)).toContain(
        "Unknown output mode 'dashboard' from --output. Use lines, quiet, tui.",
      )
      Expect(result.stdout).not.toContain('Finding Tao tests under')
    })
  })

  Test('takes the output mode a lane pinned unless the run asks for another', async () => {
    await withTaoFixture({
      ...reportFixture,
      'jest-stub.mjs': jestStubSource(stubbedRunnerReport({ failed: 0, passed: 2 }), 0),
    }, async rootDir => {
      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(FS.resolvePath('runtime-root', rootDir), async () => {
          // A dashboard lane captures its children's lines, so a pinned `tui` streams them here.
          await withEnv('TAO_OUTPUT_MODE', 'tui', async () => {
            const pinned = await runTaoCliForTest(['test', rootDir])
            const overridden = await runTaoCliForTest(['test', rootDir, '--output', 'quiet'])

            Expect(outputText(pinned)).toContain(runnerLine(1))
            Expect(outputText(overridden)).not.toContain(runnerLine(1))
            Expect(resultCountLine(outputText(overridden))).toBe('Tests:       2 passed, 2 total')
          })
        })
      })
    })
  })
})
