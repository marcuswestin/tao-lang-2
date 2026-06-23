import { FS, Text } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { runFix } from '../cli-src/fix-command'
import { statusByBasename, statusByFile, withCwd, withTaoFixture } from './test-cli-files'

Describe('tao fix', () => {
  Test('applies render moves, import organization, and formatting in place', async () => {
    await withTaoFixture({
      'app.tao': Text.stripIndent(`
        app   MyApp { view MainView }
        use Text,Button from @tao/ui
        view MainView {
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
           view MainView
        }

        view MainView {
           alias Greeting = "hi"
           render Text Greeting
        }
      `)
      }\n`)
    })
  })

  Test('leaves canonical files unchanged and reports broken files', async () => {
    await withTaoFixture({
      'canonical.tao': 'use Text from @tao/ui\n\nview MainView {\n   render Text "hi"\n}\n',
      'broken.tao': 'view Broken {',
    }, async (rootDir) => {
      const results = await runFix(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({
        'canonical.tao': 'unchanged',
        'broken.tao': 'error',
      })
      Expect(await FS.readText(FS.resolvePath('broken.tao', { cwd: rootDir }))).toBe('view Broken {')
    })
  })

  Test('uses package-aware workspace roots for explicit nested package files', async () => {
    await withTaoFixture({
      'Packages/@cards/screens/Main.tao': Text.stripIndent(`
        use LocalText, Missing from @cards/widgets

        view MainView { }
      `),
      'Packages/@cards/widgets/Widget.tao': 'publish view LocalText Value is text { }\n',
    }, async (rootDir) => {
      const path = FS.resolvePath('Packages/@cards/screens/Main.tao', { cwd: rootDir })
      const results = await runFix(path)

      Expect(statusByFile(results, rootDir)).toEqual({ 'Packages/@cards/screens/Main.tao': 'changed' })
      Expect(await FS.readText(path)).toBe(`${
        Text.stripIndent(`
        use Missing from @cards/widgets

        view MainView { }
      `)
      }\n`)
    })
  })

  Test('uses package-aware workspace roots for explicit nested package directories', async () => {
    await withTaoFixture({
      'Packages/@cards/screens/Main.tao': Text.stripIndent(`
        use LocalText, Missing from @cards/widgets

        view MainView { }
      `),
      'Packages/@cards/widgets/Widget.tao': 'publish view LocalText Value is text { }\n',
    }, async (rootDir) => {
      const directory = FS.resolvePath('Packages/@cards/screens', { cwd: rootDir })
      const path = FS.resolvePath('Packages/@cards/screens/Main.tao', { cwd: rootDir })
      const results = await runFix(directory)

      Expect(statusByFile(results, rootDir)).toEqual({ 'Packages/@cards/screens/Main.tao': 'changed' })
      Expect(await FS.readText(path)).toBe(`${
        Text.stripIndent(`
        use Missing from @cards/widgets

        view MainView { }
      `)
      }\n`)
    })
  })

  Test('uses package-aware workspace roots for relative paths inside nested package directories', async () => {
    const originalSource = Text.stripIndent(`
      use LocalText, Missing from @cards/widgets

      view MainView { }
    `)
    const fixedSource = `${
      Text.stripIndent(`
      use Missing from @cards/widgets

      view MainView { }
    `)
    }\n`
    await withTaoFixture({
      'Packages/@cards/screens/Main.tao': originalSource,
      'Packages/@cards/widgets/Widget.tao': 'publish view LocalText Value is text { }\n',
    }, async (rootDir) => {
      const cwd = FS.resolvePath('Packages/@cards/screens', { cwd: rootDir })
      const path = FS.resolvePath('Main.tao', { cwd })

      await withCwd(cwd, async () => {
        Expect(statusByBasename(await runFix('.'))).toEqual({ 'Main.tao': 'changed' })
      })
      Expect(await FS.readText(path)).toBe(fixedSource)

      await FS.writeText(path, originalSource)
      await withCwd(cwd, async () => {
        Expect(statusByBasename(await runFix('Main.tao'))).toEqual({ 'Main.tao': 'changed' })
      })
      Expect(await FS.readText(path)).toBe(fixedSource)
    })
  })
})
