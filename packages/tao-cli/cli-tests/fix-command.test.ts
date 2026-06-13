import { FS, Text } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { runFix } from '../cli-src/fix-command'
import { statusByFile, withTaoFixture } from './test-cli-files'

Describe('tao fix', () => {
  Test('applies render moves, import organization, and formatting in place', async () => {
    await withTaoFixture({
      'app.tao': Text.stripIndent(`
        app   MyApp { ui MainView }
        use Text,Button from @tao/ui
        ui MainView {
           render Text Greeting
           alias Greeting = "hi"
        }
      `),
    }, async (rootDir) => {
      const path = FS.resolvePath('app.tao', { cwd: rootDir })
      const results = await runFix(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({ 'app.tao': 'changed' })
      Expect(await FS.readText(path)).toBe(`${
        Text.stripIndent(`
        use Text from @tao/ui

        app MyApp {
           ui MainView
        }

        ui MainView {
           alias Greeting = "hi"
           render Text Greeting
        }
      `)
      }\n`)
    })
  })

  Test('leaves canonical files unchanged and reports broken files', async () => {
    await withTaoFixture({
      'canonical.tao': 'use Text from @tao/ui\n\nui MainView {\n   render Text "hi"\n}\n',
      'broken.tao': 'ui Broken {',
    }, async (rootDir) => {
      const results = await runFix(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({
        'canonical.tao': 'unchanged',
        'broken.tao': 'error',
      })
      Expect(await FS.readText(FS.resolvePath('broken.tao', { cwd: rootDir }))).toBe('ui Broken {')
    })
  })

  Test('uses package-aware workspace roots for explicit nested package files', async () => {
    await withTaoFixture({
      'Packages/@cards/screens/Main.tao': Text.stripIndent(`
        use LocalText, Missing from @cards/widgets

        ui MainView { }
      `),
      'Packages/@cards/widgets/Widget.tao': 'publish ui LocalText Value text { }\n',
    }, async (rootDir) => {
      const path = FS.resolvePath('Packages/@cards/screens/Main.tao', { cwd: rootDir })
      const results = await runFix(path)

      Expect(statusByFile(results, rootDir)).toEqual({ 'Packages/@cards/screens/Main.tao': 'changed' })
      Expect(await FS.readText(path)).toBe(`${
        Text.stripIndent(`
        use Missing from @cards/widgets

        ui MainView { }
      `)
      }\n`)
    })
  })
})
