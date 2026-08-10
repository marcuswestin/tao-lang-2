import { CLI, FS, Text } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { runCheck } from '../cli-src/source-commands'
import { statusByBasename, statusByFile, withTaoFixture } from './test-cli-files'

Describe('tao check', () => {
  Test('reports canonical files as unchanged without writing', async () => {
    await withTaoFixture({
      'canonical.tao': 'view MainView { }\n',
    }, async (rootDir) => {
      const results = await runCheck(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({ 'canonical.tao': 'unchanged' })
      Expect(await FS.readText(FS.resolvePath('canonical.tao', rootDir))).toBe('view MainView { }\n')
    })
  })

  Test('reports drift without writing', async () => {
    await withTaoFixture({
      'drift.tao': 'view   MainView { }',
    }, async (rootDir) => {
      const path = FS.resolvePath('drift.tao', rootDir)
      const results = await runCheck(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({ 'drift.tao': 'changed' })
      Expect(await FS.readText(path)).toBe('view   MainView { }')
    })
  })

  Test('reports syntax errors without writing', async () => {
    await withTaoFixture({
      'broken.tao': 'view Broken {',
    }, async (rootDir) => {
      const path = FS.resolvePath('broken.tao', rootDir)
      const results = await runCheck(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({ 'broken.tao': 'error' })
      Expect(await FS.readText(path)).toBe('view Broken {')
    })
  })

  Test('walks non-git fixture directories without applying loose gitignore files', async () => {
    await withTaoFixture({
      '.gitignore': 'node_modules\n.artifacts\n.custom-hidden\nAndroid\nIOS\nPods\npods\n',
      'canonical.tao': 'view MainView { }\n',
      'node_modules/pkg/ignored.tao': 'view   Ignored { }',
      '.artifacts/ignored.tao': 'view   Ignored { }',
      '.custom-hidden/ignored.tao': 'view   Ignored { }',
      'Android/ignored.tao': 'view   Ignored { }',
      'IOS/ignored.tao': 'view   Ignored { }',
      'Pods/ignored.tao': 'view   Ignored { }',
      'pods/ignored.tao': 'view   Ignored { }',
    }, async (rootDir) => {
      const results = await runCheck(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({ 'canonical.tao': 'unchanged' })
    })
  })

  Test('skips hidden future-source directories without reserving user directory names', async () => {
    await withTaoFixture({
      'canonical.tao': 'view MainView { }\n',
      'Apps/MVP/.tao-future/Future.tao': 'project app FutureMVP {',
      'Apps/MVP-4/Valid.tao': 'view ValidMVP4 { }\n',
      'Roadmap/Feature/Syntax Sketches/Valid.tao': 'view ValidSyntaxSketch { }\n',
    }, async (rootDir) => {
      const results = await runCheck(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({
        'Apps/MVP-4/Valid.tao': 'unchanged',
        'Roadmap/Feature/Syntax Sketches/Valid.tao': 'unchanged',
        'canonical.tao': 'unchanged',
      })
    })
  })

  Test('skips an explicitly named ignored directory', async () => {
    await withTaoFixture({
      '.gitignore': 'node_modules\n',
      'node_modules/pkg/ignored.tao': 'view   Ignored { }',
    }, async (rootDir) => {
      await CLI.mustRun('git', { args: ['init', '--quiet'], cwd: rootDir })
      const directory = FS.resolvePath('node_modules', rootDir)

      Expect(await runCheck(directory)).toEqual([])
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
      const path = FS.resolvePath('Packages/@cards/screens/Main.tao', rootDir)
      const results = await runCheck(path)

      Expect(statusByFile(results, rootDir)).toEqual({ 'Packages/@cards/screens/Main.tao': 'changed' })
      Expect(await FS.readText(path)).toContain('LocalText, Missing')
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
      const directory = FS.resolvePath('Packages/@cards/screens', rootDir)
      const path = FS.resolvePath('Packages/@cards/screens/Main.tao', rootDir)
      const results = await runCheck(directory)

      Expect(statusByFile(results, rootDir)).toEqual({ 'Packages/@cards/screens/Main.tao': 'changed' })
      Expect(await FS.readText(path)).toContain('LocalText, Missing')
    })
  })

  Test('uses package-aware workspace roots for relative paths inside nested package directories', async () => {
    await withTaoFixture({
      'Packages/@cards/screens/Main.tao': Text.stripIndent(`
        use LocalText, Missing from @cards/widgets

        view MainView { }
      `),
      'Packages/@cards/widgets/Widget.tao': 'publish view LocalText Value is text { }\n',
    }, async (rootDir) => {
      const cwd = FS.resolvePath('Packages/@cards/screens', rootDir)
      const path = FS.resolvePath('Main.tao', cwd)

      Expect(statusByBasename(await runCheck('.', { cwd }))).toEqual({ 'Main.tao': 'changed' })
      Expect(statusByBasename(await runCheck('Main.tao', { cwd }))).toEqual({ 'Main.tao': 'changed' })
      Expect(await FS.readText(path)).toContain('LocalText, Missing')
    })
  })
})
