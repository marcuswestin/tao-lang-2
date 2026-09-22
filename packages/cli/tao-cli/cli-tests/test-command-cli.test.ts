import { RuntimeTesting } from '@expo-host/testing/runtime-testing'
import { FS, Platform, TaoTestProtocol, Text } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
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
  // The category also holds the reuse index, which is not generated code and never a run root.
  return await FS.isDirectory(categoryRoot)
    ? (await FS.listDir(categoryRoot)).filter(name => name.startsWith('run-'))
    : []
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

const reuseFixture = {
  'Project.tao': 'project { id "compiled-output-reuse-test" name "Compiled output reuse test" }',
  'App.tao': taoApp('Reused'),
  'App.test.tao': taoTest('Reused'),
} as const

/** COMPILED and REUSED are the phase lines that say which of the two paths one run took. */
const COMPILED = 'Compiling apps'
const REUSED = 'Reusing compiled apps'

/**
 * taoTestJourneys writes a Tao test file of `count` journeys, which is what decides whether a run
 * has enough work to be worth dividing between Jest entrypoints at all.
 */
function taoTestJourneys(name: string, count: number): string {
  return [
    `use ${name} from ./`,
    `test "${name}" {`,
    ...Array.from({ length: count }, (_unused, index) => [
      `  test "runs ${index + 1}" {`,
      `    run ${name}`,
      `    expect text "${name}"`,
      '  }',
    ]).flat(),
    '}',
    '',
  ].join('\n')
}

/**
 * splittableFixture is two Tao test files carrying between them exactly the journeys two Jest
 * entrypoints need to be worth their two module registries.
 */
const splittableFixture = {
  'Project.tao': 'project { id "entrypoint-split-test" name "Entrypoint split test" }',
  'One/App.tao': taoApp('SplitOne'),
  'One/App.test.tao': taoTestJourneys('SplitOne', RuntimeTesting.TestHarnessFiles.JOURNEYS_PER_SHARD),
  'Two/App.tao': taoApp('SplitTwo'),
  'Two/App.test.tao': taoTestJourneys('SplitTwo', RuntimeTesting.TestHarnessFiles.JOURNEYS_PER_SHARD),
} as const

/** listEntrypoints lists the Jest entrypoints of the plan a run `width` workers wide generated. */
async function listEntrypoints(runtimeRoot: string, width: number): Promise<string[]> {
  const found: string[] = []
  // Plans live beside the run roots rather than inside one, so that the directory Jest is configured
  // with does not move from compile to compile.
  const plans = FS.resolvePath(
    `_gen_tao-app-test/tao-test-command/${RuntimeTesting.TestHarnessFiles.DIRECTORY_NAME}`,
    runtimeRoot,
  )
  for (const plan of await FS.isDirectory(plans) ? await FS.listDir(plans) : []) {
    if (plan.startsWith(`${width}-`)) {
      found.push(...await FS.listDir(FS.resolvePath(plan, plans)))
    }
  }
  return found.toSorted()
}

/** listCachedFingerprints lists the reuse index entries left under one runtime package root. */
async function listCachedFingerprints(runtimeRoot: string): Promise<string[]> {
  const cacheRoot = FS.resolvePath('_gen_tao-app-test/tao-test-command/.cache', runtimeRoot)
  return await FS.isDirectory(cacheRoot) ? await FS.listDir(cacheRoot) : []
}

Describe('tao test CLI', () => {
  Test('writes a versioned live-render artifact when Studio requests journey observations', async () => {
    await withTaoFixture({ ...reportFixture, 'jest-stub.mjs': '' }, async rootDir => {
      const artifactPath = FS.resolvePath('journey-observations.json', rootDir)
      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(FS.resolvePath('runtime-root', rootDir), async () => {
          const result = await runTaoCliForTest([
            'test',
            rootDir,
            '--journey-observations',
            artifactPath,
          ])

          Expect(result.exitCode).toBe(0)
          Expect(await FS.readJson<RuntimeTesting.JourneyObservationsArtifact>(artifactPath)).toEqual({
            checks: [],
            format: 'tao-journey-observations',
            version: 1,
          })
        })
      })
    })
  })

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
      Expect(output).toContain("Test 'Empty' declares no checks, so it would run nothing.")
      Expect(output).toContain('Empty.test.tao')
      Expect(output).toContain('Validating Tao test files')
      Expect(output).not.toContain('Compiling apps')
      Expect(output).not.toContain('Running Tao tests')
      Expect(output).not.toContain('expo-host-tests/tao-test-command.jest.tsx')
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

  // A run that publishes nothing has nothing to keep, which is the lifecycle every passing run had
  // before compiled output became reusable and the one the opt-out restores.
  Test('discards its generated run root and prunes stale roots when reuse is switched off', async () => {
    await withTaoFixture({ ...lifecycleFixture, 'jest-stub.mjs': '' }, async rootDir => {
      const runtimeRoot = FS.resolvePath('runtime-root', rootDir)
      const staleOlder = await writeStaleRunRoot(runtimeRoot, 9)
      const staleNewest = await writeStaleRunRoot(runtimeRoot, 3)

      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(runtimeRoot, async () => {
          await withEnv('TAO_TEST_NO_CACHE', 'true', async () => {
            const result = await runTaoCliForTest(['test', rootDir])

            Expect(result.exitCode).toBe(0)
            Expect(await listRunRoots(runtimeRoot)).toEqual([staleNewest])
            Expect(await listRunRoots(runtimeRoot)).not.toContain(staleOlder)
          })
        })
      })
    })
  })

  // Most of a `tao test` run is validating and compiling apps that have not changed since the last
  // run compiled them. The second run below must do neither and still run the same tests.
  Test("reuses a passing run's compiled apps when nothing they are built from has changed", async () => {
    await withTaoFixture({ ...reuseFixture, 'jest-stub.mjs': '' }, async rootDir => {
      const runtimeRoot = FS.resolvePath('runtime-root', rootDir)
      const staleOlder = await writeStaleRunRoot(runtimeRoot, 9)
      const staleNewest = await writeStaleRunRoot(runtimeRoot, 3)

      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(runtimeRoot, async () => {
          const cold = await runTaoCliForTest(['test', rootDir])
          const warm = await runTaoCliForTest(['test', rootDir])

          Expect(cold.exitCode).toBe(0)
          Expect(outputText(cold)).toContain(COMPILED)
          Expect(outputText(cold)).not.toContain(REUSED)
          Expect(warm.exitCode).toBe(0)
          Expect(outputText(warm)).toContain(REUSED)
          Expect(outputText(warm)).not.toContain(COMPILED)
          Expect(outputText(warm)).not.toContain('Validating Tao test files')
          Expect(outputText(warm)).toContain('Tao tests finished')
          // The published root is kept rather than discarded, and pruning still reaches the rest.
          const runRoots = await listRunRoots(runtimeRoot)
          Expect(runRoots).toContain(staleNewest)
          Expect(runRoots).not.toContain(staleOlder)
          Expect(runRoots).toHaveLength(2)
        })
      })
    })
  })

  Test('compiles again after a Tao source under test changes', async () => {
    await withTaoFixture({ ...reuseFixture, 'jest-stub.mjs': '' }, async rootDir => {
      const runtimeRoot = FS.resolvePath('runtime-root', rootDir)

      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(runtimeRoot, async () => {
          await runTaoCliForTest(['test', rootDir])
          Expect(outputText(await runTaoCliForTest(['test', rootDir]))).toContain(REUSED)

          await FS.writeText(FS.resolvePath('App.tao', rootDir), taoApp('Reused').replace('Reused")', 'Edited")'))
          const afterEdit = await runTaoCliForTest(['test', rootDir])

          Expect(afterEdit.exitCode).toBe(0)
          Expect(outputText(afterEdit)).toContain(COMPILED)
          Expect(outputText(afterEdit)).not.toContain(REUSED)
          Expect(await listCachedFingerprints(runtimeRoot)).toHaveLength(2)
        })
      })
    })
  })

  // A false green is worse than a slow suite, so only a run that both compiled and passed may be
  // handed to a later run.
  Test('publishes nothing a failing run compiled', async () => {
    await withTaoFixture({ ...reuseFixture, 'jest-stub.mjs': 'process.exit(1)\n' }, async rootDir => {
      const runtimeRoot = FS.resolvePath('runtime-root', rootDir)

      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(runtimeRoot, async () => {
          const failed = await runTaoCliForTest(['test', rootDir])
          const again = await runTaoCliForTest(['test', rootDir])

          Expect(failed.exitCode).toBe(1)
          Expect(await listCachedFingerprints(runtimeRoot)).toEqual([])
          Expect(again.exitCode).toBe(1)
          Expect(outputText(again)).toContain(COMPILED)
          Expect(outputText(again)).not.toContain(REUSED)
        })
      })
    })
  })

  Test('compiles from source and publishes nothing when reuse is switched off', async () => {
    await withTaoFixture({ ...reuseFixture, 'jest-stub.mjs': '' }, async rootDir => {
      const runtimeRoot = FS.resolvePath('runtime-root', rootDir)

      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(runtimeRoot, async () => {
          await withEnv('TAO_TEST_NO_CACHE', 'true', async () => {
            const first = await runTaoCliForTest(['test', rootDir])
            const second = await runTaoCliForTest(['test', rootDir])

            Expect(first.exitCode).toBe(0)
            Expect(second.exitCode).toBe(0)
            Expect(outputText(second)).toContain(COMPILED)
            Expect(outputText(second)).not.toContain(REUSED)
            Expect(await listCachedFingerprints(runtimeRoot)).toEqual([])
            Expect(await listRunRoots(runtimeRoot)).toEqual([])
          })

          // The opt-out is per run, not a state it leaves behind: the next run caches again.
          Expect(outputText(await runTaoCliForTest(['test', rootDir]))).toContain(COMPILED)
          Expect(outputText(await runTaoCliForTest(['test', rootDir]))).toContain(REUSED)
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

  // Jest distributes test files rather than cases, so a run only uses the width it was granted if it
  // is split into that many entrypoints. The pool and the split are therefore one number.
  Test('bounds the test runner workers and the entrypoint split with the run job budget', async () => {
    await withTaoFixture({ ...splittableFixture, 'jest-stub.mjs': argvEchoStubSource() }, async rootDir => {
      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(FS.resolvePath('runtime-root', rootDir), async () => {
          await withEnv('TAO_TEST_JOBS', '1', async () => {
            const budgeted = await runTaoCliForTest(['test', rootDir, '--output', 'lines'])

            Expect(budgeted.exitCode).toBe(0)
            Expect(outputText(budgeted)).toContain('--maxWorkers=1')
            Expect(await listEntrypoints(FS.resolvePath('runtime-root', rootDir), 1)).toEqual([
              'shard-1-of-1.jest.tsx',
            ])
          })
          await withEnv('TAO_TEST_JOBS', undefined, async () => {
            const unbudgeted = await runTaoCliForTest(['test', rootDir, '--output', 'lines'])

            Expect(unbudgeted.exitCode).toBe(0)
            Expect(outputText(unbudgeted)).toContain('--maxWorkers=2')
            Expect(await listEntrypoints(FS.resolvePath('runtime-root', rootDir), 2)).toEqual([
              'shard-1-of-2.jest.tsx',
              'shard-2-of-2.jest.tsx',
            ])
          })
        })
      })
    })
  })

  // Jest hashes its whole configuration into the key of every transform it caches, and the
  // entrypoint directory is in that configuration. When it sat inside the run root, every compile
  // moved it and the runner re-transformed React Native and everything else it loads.
  Test('hands the test runner the same entrypoint directory after an edit compiles a new run root', async () => {
    const entrypointsStub =
      `process.stderr.write(\`entrypoints: \${process.env.${RuntimeTesting.TestHarnessFiles.ENTRYPOINTS_ENV}}\\n\`)\n`
    await withTaoFixture({ ...reportFixture, 'jest-stub.mjs': entrypointsStub }, async rootDir => {
      await withJestStub(rootDir, async () => {
        const runtimeRoot = FS.resolvePath('runtime-root', rootDir)
        await withRuntimeRoot(runtimeRoot, async () => {
          const entrypointsOf = (output: string) => /entrypoints: (.+)/.exec(output)?.[1]

          const first = await runTaoCliForTest(['test', rootDir, '--output', 'lines'])
          const firstRunRoots = await listRunRoots(runtimeRoot)
          await FS.writeText(FS.resolvePath('App.tao', rootDir), taoApp('Reported').replace('"Reported"', '"Edited"'))
          const second = await runTaoCliForTest(['test', rootDir, '--output', 'lines'])

          Expect(first.exitCode).toBe(0)
          Expect(second.exitCode).toBe(0)
          Expect(await listRunRoots(runtimeRoot)).not.toEqual(firstRunRoots)
          Expect(entrypointsOf(outputText(first))).toBeDefined()
          Expect(entrypointsOf(outputText(second))).toBe(entrypointsOf(outputText(first)))
          Expect(entrypointsOf(outputText(first))).not.toContain('/run-')
        })
      })
    })
  })

  // A run with little to divide is better off undivided: every entrypoint stands up its own React
  // Native module registry, and one app's own suite is the common shape.
  Test('leaves a small run on one entrypoint however wide the budget', async () => {
    await withTaoFixture({ ...reportFixture, 'jest-stub.mjs': argvEchoStubSource() }, async rootDir => {
      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(FS.resolvePath('runtime-root', rootDir), async () => {
          await withEnv('TAO_TEST_JOBS', '8', async () => {
            const result = await runTaoCliForTest(['test', rootDir, '--output', 'lines'])

            Expect(result.exitCode).toBe(0)
            Expect(outputText(result)).toContain('--maxWorkers=1')
            Expect(await listEntrypoints(FS.resolvePath('runtime-root', rootDir), 1)).toEqual([
              'shard-1-of-1.jest.tsx',
            ])
          })
        })
      })
    })
  })

  // One Jest case per Tao journey is what makes a name pattern able to select a journey at all, so
  // the pattern goes to the runner unaltered and the runner does the selecting.
  Test('forwards a name pattern to the test runner', async () => {
    await withTaoFixture({ ...reportFixture, 'jest-stub.mjs': argvEchoStubSource() }, async rootDir => {
      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(FS.resolvePath('runtime-root', rootDir), async () => {
          const result = await runTaoCliForTest(['test', rootDir, '--name', 'runs', '--output', 'lines'])

          Expect(result.exitCode).toBe(0)
          Expect(outputText(result)).toContain('--testNamePattern runs')
          Expect(outputText(result)).toContain('Selected 1 of 1 Tao journey')
        })
      })
    })
  })

  // The runner reaches the same journeys either way, but it stands up a module registry for every
  // entrypoint it opens, so an entrypoint the pattern can select nothing from is a worker that loads
  // React Native to run nothing. Selecting one journey is the inner loop this protects.
  Test('keeps a name pattern out of the entrypoints it can select nothing from', async () => {
    await withTaoFixture({ ...splittableFixture, 'jest-stub.mjs': argvEchoStubSource() }, async rootDir => {
      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(FS.resolvePath('runtime-root', rootDir), async () => {
          const result = await runTaoCliForTest([
            'test',
            rootDir,
            '--name',
            'SplitOne > runs 1$',
            '--output',
            'lines',
          ])

          Expect(result.exitCode).toBe(0)
          // The command still reports the selection against every journey the run discovered.
          Expect(outputText(result)).toContain(
            `Selected 1 of ${RuntimeTesting.TestHarnessFiles.JOURNEYS_PER_SHARD * 2} Tao journeys`,
          )
          Expect(outputText(result)).toContain('--maxWorkers=1')
          Expect(await listEntrypoints(FS.resolvePath('runtime-root', rootDir), 1)).toEqual([
            'shard-1-of-1.jest.tsx',
          ])
        })
      })
    })
  })

  // The runner would filter every case out, report a run with no tests in it, and exit zero. A
  // pattern that selects nothing is a mistake in the pattern, so it is reported as one.
  Test('fails with a clear message when a name pattern matches no journey', async () => {
    await withTaoFixture({ ...reportFixture, 'jest-stub.mjs': argvEchoStubSource() }, async rootDir => {
      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(FS.resolvePath('runtime-root', rootDir), async () => {
          const result = await runTaoCliForTest(['test', rootDir, '--name', 'never written'])
          const output = outputText(result)

          Expect(result.exitCode).toBe(1)
          Expect(output).toContain('No Tao test journey matches --name "never written". Searched 1 journey under')
          Expect(output).toContain('run tao test without --name to run them all.')
          // Nothing ran, so the runner was never started and nothing it would have printed appears.
          Expect(output).not.toContain('runner args: ')
          Expect(output).not.toContain('Tests:')
        })
      })
    })
  })

  // A scheduler hands one pattern to every suite it knows about, and a Tao journey will never be
  // named like a Bun test, so the suites the pattern cannot describe have to be able to sit out
  // without turning the filtered run red. The empty selection is still reported, not hidden.
  Test('passes on a name pattern that matches no journey when asked to', async () => {
    await withTaoFixture({ ...reportFixture, 'jest-stub.mjs': argvEchoStubSource() }, async rootDir => {
      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(FS.resolvePath('runtime-root', rootDir), async () => {
          const result = await runTaoCliForTest(['test', rootDir, '--name', 'never written', '--pass-with-no-tests'])
          const output = outputText(result)

          Expect(result.exitCode).toBe(0)
          Expect(output).toContain('No Tao test journey matches --name "never written". Searched 1 journey under')
          // The repository test runner reads this marker to tell this pass from a pass that ran
          // something: the Tao suite writes no per-test report, so the line is the only evidence.
          // Asserting the literal here would let the two ends drift apart silently.
          Expect(output).toContain(`${TaoTestProtocol.NO_JOURNEYS_MATCHED}.`)
          Expect(TaoTestProtocol.ranNoJourneys(output)).toBe(true)
          // Passing is not running: the remedy for a mistyped pattern is not offered, and the
          // runner is still never started.
          Expect(output).not.toContain('run tao test without --name to run them all.')
          Expect(output).not.toContain('runner args: ')
          Expect(output).not.toContain('Tests:')
        })
      })
    })
  })

  // The flag settles the empty selection and nothing else; a pattern that does select journeys runs
  // them, so a scheduler that always passes it cannot silently stop testing what it does reach.
  Test('still runs the journeys a name pattern selects while passing with no tests', async () => {
    await withTaoFixture({ ...reportFixture, 'jest-stub.mjs': argvEchoStubSource() }, async rootDir => {
      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(FS.resolvePath('runtime-root', rootDir), async () => {
          const result = await runTaoCliForTest([
            'test',
            rootDir,
            '--name',
            'runs',
            '--pass-with-no-tests',
            '--output',
            'lines',
          ])

          Expect(result.exitCode).toBe(0)
          Expect(outputText(result)).toContain('--testNamePattern runs')
          Expect(outputText(result)).toContain('Selected 1 of 1 Tao journey')
        })
      })
    })
  })

  Test('rejects a name pattern that is not a regular expression', async () => {
    await withTaoFixture({ ...reportFixture, 'jest-stub.mjs': argvEchoStubSource() }, async rootDir => {
      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(FS.resolvePath('runtime-root', rootDir), async () => {
          const result = await runTaoCliForTest(['test', rootDir, '--name', 'runs('])

          Expect(result.exitCode).toBe(1)
          Expect(outputText(result)).toContain('--name "runs(" is not a valid regular expression')
          Expect(outputText(result)).not.toContain('runner args: ')
        })
      })
    })
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
          const oneRoot = FS.resolvePath('One', rootDir)
          const twoRoot = FS.resolvePath('Two', rootDir)
          const result = await runTaoCliForTest([
            'test',
            oneRoot,
            twoRoot,
            // An overlapping explicit file must not compile or run the same declaration twice.
            FS.resolvePath('App.test.tao', oneRoot),
          ])

          Expect(result.exitCode).toBe(0)
          Expect(result.stdout).toContain('Found 2 Tao test files')
          Expect(result.stdout).toContain('Tao tests finished')
        })
      })
    })
  })
})
