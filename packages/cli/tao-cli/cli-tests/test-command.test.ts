import { FS, Text } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { findTaoTestFiles } from '../cli-src/test-command'
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

        view MainView() { }
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

  Test('skips hidden future-source directories without reserving test directory names', async () => {
    await withTaoFixture({
      'Current.test.tao': 'test "Current" { }\n',
      'Apps/WordFlower/.tao-archive/Future.test.tao': 'test "Future" {',
      'Apps/WordFlower/1 - Current/Valid.test.tao': 'test "Valid current MVP" { }\n',
      'Roadmap/Feature/Syntax Sketches/Valid.test.tao': 'test "Valid syntax sketch" { }\n',
    }, async (rootDir) => {
      const found = await findTaoTestFiles(rootDir)

      Expect(found.map(path => FS.relativePath(rootDir, path))).toEqual([
        'Apps/WordFlower/1 - Current/Valid.test.tao',
        'Current.test.tao',
        'Roadmap/Feature/Syntax Sketches/Valid.test.tao',
      ])
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
})
