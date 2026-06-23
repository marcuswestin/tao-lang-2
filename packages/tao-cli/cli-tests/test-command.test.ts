import { CLI, FS, Text } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { findTaoTestFiles, validateTaoTestFiles } from '../cli-src/test-command'
import { withTaoFixture } from './test-cli-files'

const tsFence = '```ts'
const fence = '```'

Describe('tao test', () => {
  Test('finds .tao files with Tao test declarations below a directory', async () => {
    await withTaoFixture({
      '.gitignore': Text.stripIndent(`
        node_modules
        _gen_*
        old-fixtures
      `),
      'Alpha.test.tao': 'test "Alpha" { }\n',
      'Inline.tao': Text.stripIndent(`
        app InlineApp {
           view MainView
        }

        test "Inline" { }

        view MainView { }
      `),
      'nested/Beta.test.tao': 'test "Beta" { }\n',
      'nested/Beta.tao': '',
      'NotATaoTest.test.tao': '// test "Comment only" { }\n',
      '_gen_tao-app/Ignored.test.tao': 'test "Ignored" { }\n',
      'node_modules/pkg/Ignored.test.tao': 'test "Ignored" { }\n',
      'old-fixtures/Ignored.test.tao': 'test "Ignored" { }\n',
    }, async (rootDir) => {
      const found = await findTaoTestFiles(rootDir)

      Expect(found.map(path => FS.relativePath(rootDir, path))).toEqual([
        'Alpha.test.tao',
        'Inline.tao',
        'nested/Beta.test.tao',
      ])
    })
  })

  Test('reports preflight validation errors at their source file path', async () => {
    await withTaoFixture({
      'Main.test.tao': Text.stripIndent(`
        use BrokenApp from ./

        test "Smoke" {
           check "renders" {
              run BrokenApp
              expect text "Hello"
           }
        }
      `),
      'Broken.tao': 'app BrokenApp { }\n',
    }, async (rootDir) => {
      const testPath = FS.resolvePath('Main.test.tao', { cwd: rootDir })
      const brokenPath = FS.resolvePath('Broken.tao', { cwd: rootDir })
      const validationErrors = await validateTaoTestFiles([testPath])

      Expect(validationErrors).toEqual([
        {
          path: brokenPath,
          messages: ['App BrokenApp must declare exactly one root view, found 0.'],
        },
      ])
    })
  })

  Test('runs discovered sidecar and inline Tao tests in one Jest harness', async () => {
    await withTaoFixture(batchedTestAppFiles(), async (rootDir) => {
      const result = await CLI.run(FS.repoPath('tao'), { args: ['test', rootDir] })
      const output = `${result.stdout}${result.stderr}`

      Expect(result.exitCode).toBe(0)
      Expect(output).toContain('Finding Tao tests under')
      Expect(output).toContain('Found 2 Tao test files')
      Expect(output).toContain('Validating Tao test files')
      Expect(output).toContain('Compiling apps and running Tao tests')
      Expect(output).toContain('PASS')
      Expect(output).toContain('Inline.tao')
      Expect(output).toContain('Main.test.tao')
      Expect(output).toContain('runtime-tests/tao-test-command.jest.tsx')
      Expect(output).toContain('Test Suites:')
      Expect(output).toContain('Tao tests finished')
      Expect(output).not.toContain('\u001b[31mPASS')
      Expect(output).not.toContain('\u001b[31mTest Suites:')
    })
  }, 20_000)

  Test('CLI reports no discovered tests without failing', async () => {
    await withTaoFixture({ 'Main.tao': '' }, async (rootDir) => {
      const result = await CLI.run(FS.repoPath('tao'), { args: ['test', rootDir] })

      Expect(result.exitCode).toBe(0)
      Expect(result.stdout).toContain('No Tao tests found under')
    })
  })

  Test('CLI rejects empty Tao test suites', async () => {
    await withTaoFixture({ 'Empty.test.tao': 'test "Empty" { }\n' }, async (rootDir) => {
      const result = await CLI.run(FS.repoPath('tao'), { args: ['test', rootDir] })
      const output = `${result.stdout}${result.stderr}`

      Expect(result.exitCode).not.toBe(0)
      Expect(output).toContain("Test 'Empty' must declare at least one check.")
      Expect(output).toContain('Empty.test.tao')
      Expect(output).toContain('Validating Tao test files')
      Expect(output).not.toContain('Compiling apps and running Tao tests')
      Expect(output).not.toContain('runtime-tests/tao-test-command.jest.tsx')
      Expect(output).not.toContain('Test Suites:')
    })
  })

  Test('CLI reports Tao check context for failed expectations', async () => {
    await withTaoFixture(failingCheckAppFiles(), async (rootDir) => {
      const result = await CLI.run(FS.repoPath('tao'), { args: ['test', rootDir] })
      const output = `${result.stdout}${result.stderr}`

      Expect(result.exitCode).not.toBe(0)
      Expect(output).toContain('Tao check failed: Smoke > fails second')
      Expect(output).toContain('expect text "Missing"')
      Expect(output).toContain('Main.test.tao:')
    })
  }, 20_000)
})

function batchedTestAppFiles(): Record<string, string> {
  return {
    'Main.test.tao': Text.stripIndent(`
      use MyApp from ./

      test "Smoke" {
         check "renders text" {
            run MyApp
            expect text "Hello from sidecar tao test"
            expect missing text "Loading"
         }
      }
    `),
    'Main.tao': Text.stripIndent(`
      app MyApp {
         view MainView
      }

      view MainView {
         render Text "Hello from sidecar tao test"
      }

      view Text Value text {
         render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
         ${fence}
      }
    `),
    'Inline.tao': Text.stripIndent(`
      app InlineApp {
         view MainView
      }

      test "Inline smoke" {
         check "renders text" {
            run InlineApp
            expect text "Hello from inline tao test"
            expect missing text "Loading"
         }
      }

      view MainView {
         render Text "Hello from inline tao test"
      }

      view Text Value text {
         render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
         ${fence}
      }
    `),
  }
}

function failingCheckAppFiles(): Record<string, string> {
  return {
    'Main.test.tao': Text.stripIndent(`
      use MyApp from ./

      test "Smoke" {
         check "passes first" {
            run MyApp
            expect text "Present"
         }

         check "fails second" {
            run MyApp
            expect text "Missing"
         }
      }
    `),
    'Main.tao': Text.stripIndent(`
      app MyApp {
         view MainView
      }

      view MainView {
         render Text "Present"
      }

      view Text Value text {
         render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
         ${fence}
      }
    `),
  }
}
