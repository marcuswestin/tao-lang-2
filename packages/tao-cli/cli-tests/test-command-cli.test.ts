import { FS, Platform } from '@shared'
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

async function withEnv(name: string, value: string, run: () => Promise<void>): Promise<void> {
  const previous = Platform.runtimeProcess.env[name]
  Platform.runtimeProcess.env[name] = value
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
      await withJestStub(rootDir, async () => {
        const result = await runTaoCliForTest(['test', rootDir])

        Expect(result.exitCode).toBe(0)
        Expect(result.stdout).toContain('Found 2 Tao test files')
        Expect(result.stdout).toContain('Tao tests finished')
      })
    })
  })
})
