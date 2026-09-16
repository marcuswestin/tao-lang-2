import { FS, Platform, Text } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { taoTestShardCount } from '../cli-src/test-command'
import { runTaoCliForTest, withTaoFixture } from './test-cli-files'

const taoApp = (name: string) => `
  use Text from @tao/ui
  app ${name} { view Main }
  view Main() { render Text("${name}") }
`

const taoTest = (name: string) => `
  use ${name} from ./
  test "${name}" {
    test "runs" {
      run ${name}
      expect text "${name}"
    }
  }
`

/** withJestStub points the runtime test runner at an inert module for the duration of one test. */
async function withJestStub(rootDir: string, run: () => Promise<void>): Promise<void> {
  await withEnv('TAO_TEST_JEST_PATH', FS.resolvePath('jest-stub.mjs', rootDir), run)
}

/** withRuntimeRoot compiles one run's generated code under a throwaway runtime package root. */
async function withRuntimeRoot(runtimeRoot: string, run: () => Promise<void>): Promise<void> {
  await withEnv('TAO_TEST_RUNTIME_ROOT', runtimeRoot, run)
}

async function withEnv(name: string, value: string | undefined, run: () => Promise<void>): Promise<void> {
  const previous = Platform.runtimeProcess.env[name]
  if (value === undefined) {
    delete Platform.runtimeProcess.env[name]
  } else {
    Platform.runtimeProcess.env[name] = value
  }
  try {
    await run()
  } finally {
    if (previous === undefined) {
      delete Platform.runtimeProcess.env[name]
    } else {
      Platform.runtimeProcess.env[name] = previous
    }
  }
}

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

/** argvEchoStubSource writes a runtime test runner stand-in that reports the arguments it received. */
function argvEchoStubSource(): string {
  return 'process.stderr.write(`runner args: ${process.argv.slice(2).join(" ")}\\n`)\n'
}

function outputText(result: { stderr: string; stdout: string }): string {
  return Text.stripAnsi(`${result.stdout}${result.stderr}`)
}

function nonEmptyLines(output: string): string[] {
  return output.split('\n').filter(line => line.trim().length > 0)
}

/** resultCountLine finds the line an outer test runner scrapes this command's test counts from. */
function resultCountLine(output: string): string | undefined {
  return nonEmptyLines(output).find(line => line.trim().startsWith('Tests:'))
}

const reportFixture = {
  'Project.tao': 'project { id "test-output-report-test" name "Test output report test" }',
  'App.tao': taoApp('Reported'),
  'App.test.tao': taoTest('Reported'),
} as const

/** listRunRoots lists the generated `tao test` run roots left under one runtime package root. */
async function listRunRoots(runtimeRoot: string): Promise<string[]> {
  const categoryRoot = FS.resolvePath('_gen_tao-app-test/tao-test-command', runtimeRoot)
  return await FS.isDirectory(categoryRoot) ? await FS.listDir(categoryRoot) : []
}

/** writeStaleRunRoot writes a run root whose id claims a run finished long before this one. */
async function writeStaleRunRoot(runtimeRoot: string, ageHours: number): Promise<string> {
  const name = `run-${Date.now() - ageHours * 60 * 60 * 1000}-${Math.random().toString(36).slice(2)}`
  await FS.writeText(FS.resolvePath(`_gen_tao-app-test/tao-test-command/${name}/App.tsx`, runtimeRoot), '')
  return name
}

const lifecycleFixture = {
  'Project.tao': 'project { id "run-root-lifecycle-test" name "Run root lifecycle test" }',
  'App.tao': taoApp('Lifecycle'),
  'App.test.tao': taoTest('Lifecycle'),
} as const

Describe('tao test CLI', () => {
  Test('reports no discovered tests without failing', async () => {
    await withTaoFixture({ 'Main.tao': '' }, async (rootDir) => {
      const result = await runTaoCliForTest(['test', rootDir])

      Expect(result.exitCode).toBe(0)
      Expect(result.stdout).toContain('No Tao tests found under')
    })
  })

  Test('runs tests from a working directory outside any Git worktree', async () => {
    await withTaoFixture({
      'Project.tao': 'project { id "outside-worktree-test" name "Outside worktree test" }',
      'App.tao': taoApp('Solo'),
      'App.test.tao': taoTest('Solo'),
      // Keep the runtime runner inert: this test owns the repository-root fallback, not Jest.
      'jest-stub.mjs': '',
    }, async rootDir => {
      const previousCwd = Platform.runtimeProcess.cwd()
      await withRuntimeRoot(FS.resolvePath('runtime-root', rootDir), async () => {
        await withJestStub(rootDir, async () => {
          try {
            Platform.runtimeProcess.chdir(rootDir)
            const result = await runTaoCliForTest(['test', '.'])

            Expect(`${result.stdout}${result.stderr}`).not.toContain('Git worktree root not found')
            Expect(result.exitCode).toBe(0)
            Expect(result.stdout).toContain('Tao tests finished')
          } finally {
            Platform.runtimeProcess.chdir(previousCwd)
          }
        })
      })
    })
  })

  Test('rejects empty Tao test suites', async () => {
    await withTaoFixture({ 'Empty.test.tao': 'test "Empty" { }\n' }, async (rootDir) => {
      const result = await runTaoCliForTest(['test', rootDir])
      const output = `${result.stdout}${result.stderr}`

      Expect(result.exitCode).not.toBe(0)
      Expect(output).toContain("Test 'Empty' must start exactly one app with run.")
      Expect(output).toContain('Empty.test.tao')
      Expect(output).toContain('Validating Tao test files')
      Expect(output).not.toContain('Compiling apps')
      Expect(output).not.toContain('Running Tao tests')
      Expect(output).not.toContain('runtime-toolchain-tests/tao-test-command.jest.tsx')
      Expect(output).not.toContain('Test Suites:')
    })
  })

  Test('reports preflight validation errors at their source file path', async () => {
    await withTaoFixture({
      'Project.tao': 'project { id "preflight-validation-test" name "Preflight validation test" }',
      'Broken.tao': 'app BrokenApp { }\n',
      'Main.test.tao': `
        use BrokenApp from ./
        test "Smoke" {
          test "renders" {
            run BrokenApp
            expect text "Hello"
          }
        }
      `,
    }, async (rootDir) => {
      const result = await runTaoCliForTest(['test', rootDir])
      const output = `${result.stdout}${result.stderr}`

      Expect(result.exitCode).not.toBe(0)
      Expect(output).toContain('Broken.tao: App BrokenApp must declare exactly one Name, found 0.')
      Expect(output).toContain(
        'Broken.tao: App BrokenApp must declare exactly one Navigator (or root view), found 0.',
      )
      Expect(output).not.toContain('Compiling apps')
    })
  })

  Test('discards its generated run root and prunes stale roots after a passing suite', async () => {
    await withTaoFixture({ ...lifecycleFixture, 'jest-stub.mjs': '' }, async rootDir => {
      const runtimeRoot = FS.resolvePath('runtime-root', rootDir)
      const staleOlder = await writeStaleRunRoot(runtimeRoot, 9)
      const staleNewest = await writeStaleRunRoot(runtimeRoot, 3)

      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(runtimeRoot, async () => {
          const result = await runTaoCliForTest(['test', rootDir])

          Expect(result.exitCode).toBe(0)
          Expect(await listRunRoots(runtimeRoot)).toEqual([staleNewest])
          Expect(await listRunRoots(runtimeRoot)).not.toContain(staleOlder)
        })
      })
    })
  })

  Test('keeps the generated run root of a failing suite for debugging', async () => {
    await withTaoFixture({ ...lifecycleFixture, 'jest-stub.mjs': 'process.exit(1)\n' }, async rootDir => {
      const runtimeRoot = FS.resolvePath('runtime-root', rootDir)

      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(runtimeRoot, async () => {
          const result = await runTaoCliForTest(['test', rootDir])

          Expect(result.exitCode).toBe(1)
          const runRoots = await listRunRoots(runtimeRoot)
          Expect(runRoots.length).toBe(1)
          const manifestPath = `_gen_tao-app-test/tao-test-command/${runRoots[0]}/manifest.json`
          Expect(await FS.isFile(FS.resolvePath(manifestPath, runtimeRoot))).toBe(true)
        })
      })
    })
  })

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

  Test('bounds the test runner workers with the run job budget', async () => {
    await withTaoFixture({ ...reportFixture, 'jest-stub.mjs': argvEchoStubSource() }, async rootDir => {
      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(FS.resolvePath('runtime-root', rootDir), async () => {
          await withEnv('TAO_TEST_JOBS', '2', async () => {
            const budgeted = await runTaoCliForTest(['test', rootDir, '--output', 'lines'])

            Expect(budgeted.exitCode).toBe(0)
            Expect(outputText(budgeted)).toContain('--maxWorkers=2')
          })
          await withEnv('TAO_TEST_JOBS', undefined, async () => {
            const unbudgeted = await runTaoCliForTest(['test', rootDir, '--output', 'lines'])

            Expect(unbudgeted.exitCode).toBe(0)
            Expect(outputText(unbudgeted)).toContain('runner args: ')
            Expect(outputText(unbudgeted)).not.toContain('--maxWorkers')
          })
        })
      })
    })
  })

  Test('clamps runtime shards to three, the test file count, and the available jobs', () => {
    Expect(taoTestShardCount(30, 1)).toBe(1)
    Expect(taoTestShardCount(30, 2)).toBe(2)
    Expect(taoTestShardCount(30, 12)).toBe(3)
    Expect(taoTestShardCount(1, 12)).toBe(1)
    Expect(taoTestShardCount(2, 12)).toBe(2)
  })

  Test('stops every compiler worker after testing separate source directories', async () => {
    await withTaoFixture({
      'Project.tao': 'project { id "worker-lifecycle-test" name "Worker lifecycle test" }',
      'One/App.tao': taoApp('One'),
      'One/App.test.tao': taoTest('One'),
      'Two/App.tao': taoApp('Two'),
      'Two/App.test.tao': taoTest('Two'),
      // This test owns compiler-worker lifecycle coverage. Keep the runtime runner inert so
      // nested Jest startup cannot consume Bun's test timeout under repository-wide load.
      'jest-stub.mjs': '',
    }, async rootDir => {
      await withRuntimeRoot(FS.resolvePath('runtime-root', rootDir), async () => {
        await withJestStub(rootDir, async () => {
          const result = await runTaoCliForTest(['test', rootDir])

          Expect(result.exitCode).toBe(0)
          Expect(result.stdout).toContain('Found 2 Tao test files')
          Expect(result.stdout).toContain('Tao tests finished')
        })
      })
    })
  })
})
