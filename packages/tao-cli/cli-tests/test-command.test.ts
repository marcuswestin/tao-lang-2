import { FS, Text } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { findTaoTestFiles, validateTaoTestFiles } from '../cli-src/test-command'
import { withTaoFixture } from './test-cli-files'

Describe('tao test', () => {
  Test('finds .tao files with Tao test declarations below a directory', async () => {
    await withTaoFixture({
      '.gitignore': '.artifacts\nnode_modules\nPods\npods\n',
      'Alpha.test.tao': 'test "Alpha" { }\n',
      'Inline.tao': Text.stripIndent(`
        app InlineApp {
           view MainView
        }

        test "Inline" { }

        view MainView { }
      `),
      'Commented.tao': 'test /* hidden comment */ "Commented" { }\n',
      'nested/Beta.test.tao': 'test "Beta" { }\n',
      'nested/Beta.tao': '',
      'NotATaoTest.test.tao': '// test "Comment only" { }\n',
      '.artifacts/Ignored.test.tao': 'test "Ignored" { }\n',
      'node_modules/pkg/Ignored.test.tao': 'test "Ignored" { }\n',
      'Pods/Ignored.test.tao': 'test "Ignored" { }\n',
      'pods/Ignored.test.tao': 'test "Ignored" { }\n',
    }, async (rootDir) => {
      const found = await findTaoTestFiles(rootDir)

      Expect(found.map(path => FS.relativePath(rootDir, path))).toEqual([
        'Alpha.test.tao',
        'Commented.tao',
        'Inline.tao',
        'nested/Beta.test.tao',
      ])
    })
  })

  Test('skips future Tao MVP and syntax sketch test files during root discovery', async () => {
    await withTaoFixture({
      'Current.test.tao': 'test "Current" { }\n',
      'Apps/MVP-1/MVP.test.tao': 'test "Future" {',
      'Apps/MVP-2/MVP.test.tao': 'test "Future" {',
      'Apps/MVP-3/MVP.test.tao': 'test "Future" {',
      'Apps/MVP-triage/MVP.test.tao': 'test "Future" {',
      'Roadmap/Feature/Syntax Sketches/Future.test.tao': 'test "Future" {',
    }, async (rootDir) => {
      const found = await findTaoTestFiles(rootDir)

      Expect(found.map(path => FS.relativePath(rootDir, path))).toEqual(['Current.test.tao'])
    })
  })

  Test('finds an explicitly named Tao test file', async () => {
    await withTaoFixture({
      'Main.test.tao': 'test "Main" { }\n',
      'Other.test.tao': 'test "Other" { }\n',
    }, async (rootDir) => {
      const explicitPath = FS.resolvePath('Main.test.tao', rootDir)

      const found = await findTaoTestFiles(explicitPath)

      Expect(found).toEqual([explicitPath])
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
      const testPath = FS.resolvePath('Main.test.tao', rootDir)
      const brokenPath = FS.resolvePath('Broken.tao', rootDir)
      const validationErrors = await validateTaoTestFiles([testPath])

      Expect(validationErrors).toEqual([
        {
          path: brokenPath,
          messages: ['App BrokenApp must declare exactly one root view, found 0.'],
        },
      ])
    })
  })
})
