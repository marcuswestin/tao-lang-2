import { FS, Platform } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { runTaoCliForTest, withTaoFixture } from './test-cli-files'
import { taoApp, taoTest, withJestStub, withRuntimeRoot } from './test-command-fixtures'

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
