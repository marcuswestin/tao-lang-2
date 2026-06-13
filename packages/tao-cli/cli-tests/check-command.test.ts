import { CLI, FS, Text } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { runCheck } from '../cli-src/check-command'
import { statusByBasename, statusByFile, withCwd, withTaoFixture } from './test-cli-files'

Describe('tao check', () => {
  Test('reports canonical files as unchanged without writing', async () => {
    await withTaoFixture({
      'canonical.tao': 'ui MainView { }\n',
    }, async (rootDir) => {
      const results = await runCheck(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({ 'canonical.tao': 'unchanged' })
      Expect(await FS.readText(FS.resolvePath('canonical.tao', { cwd: rootDir }))).toBe('ui MainView { }\n')
    })
  })

  Test('reports drift without writing', async () => {
    await withTaoFixture({
      'drift.tao': 'ui   MainView { }',
    }, async (rootDir) => {
      const path = FS.resolvePath('drift.tao', { cwd: rootDir })
      const results = await runCheck(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({ 'drift.tao': 'changed' })
      Expect(await FS.readText(path)).toBe('ui   MainView { }')
    })
  })

  Test('reports syntax errors without writing', async () => {
    await withTaoFixture({
      'broken.tao': 'ui Broken {',
    }, async (rootDir) => {
      const path = FS.resolvePath('broken.tao', { cwd: rootDir })
      const results = await runCheck(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({ 'broken.tao': 'error' })
      Expect(await FS.readText(path)).toBe('ui Broken {')
    })
  })

  Test('uses the shared maximal walker exclusions', async () => {
    await withTaoFixture({
      'canonical.tao': 'ui MainView { }\n',
      'node_modules/pkg/ignored.tao': 'ui   Ignored { }',
      '_gen_tao-app/ignored.tao': 'ui   Ignored { }',
      'packages/old-fixtures/ignored.tao': 'ui   Ignored { }',
    }, async (rootDir) => {
      const results = await runCheck(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({ 'canonical.tao': 'unchanged' })
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
      const results = await runCheck(path)

      Expect(statusByFile(results, rootDir)).toEqual({ 'Packages/@cards/screens/Main.tao': 'changed' })
      Expect(await FS.readText(path)).toContain('LocalText, Missing')
    })
  })

  Test('uses package-aware workspace roots for explicit nested package directories', async () => {
    await withTaoFixture({
      'Packages/@cards/screens/Main.tao': Text.stripIndent(`
        use LocalText, Missing from @cards/widgets

        ui MainView { }
      `),
      'Packages/@cards/widgets/Widget.tao': 'publish ui LocalText Value text { }\n',
    }, async (rootDir) => {
      const directory = FS.resolvePath('Packages/@cards/screens', { cwd: rootDir })
      const path = FS.resolvePath('Packages/@cards/screens/Main.tao', { cwd: rootDir })
      const results = await runCheck(directory)

      Expect(statusByFile(results, rootDir)).toEqual({ 'Packages/@cards/screens/Main.tao': 'changed' })
      Expect(await FS.readText(path)).toContain('LocalText, Missing')
    })
  })

  Test('uses package-aware workspace roots for relative paths inside nested package directories', async () => {
    await withTaoFixture({
      'Packages/@cards/screens/Main.tao': Text.stripIndent(`
        use LocalText, Missing from @cards/widgets

        ui MainView { }
      `),
      'Packages/@cards/widgets/Widget.tao': 'publish ui LocalText Value text { }\n',
    }, async (rootDir) => {
      const cwd = FS.resolvePath('Packages/@cards/screens', { cwd: rootDir })
      const path = FS.resolvePath('Main.tao', { cwd })

      await withCwd(cwd, async () => {
        Expect(statusByBasename(await runCheck('.'))).toEqual({ 'Main.tao': 'changed' })
        Expect(statusByBasename(await runCheck('Main.tao'))).toEqual({ 'Main.tao': 'changed' })
      })
      Expect(await FS.readText(path)).toContain('LocalText, Missing')
    })
  })

  Test('CLI exits zero when files are canonical', async () => {
    await withTaoFixture({
      'canonical.tao': 'ui MainView { }\n',
    }, async (rootDir) => {
      const result = await CLI.run(FS.repoPath('tao'), { args: ['check', rootDir] })

      Expect(result.exitCode).toBe(0)
      Expect(result.stdout).toContain('0 noncanonical, 1 unchanged')
    })
  })

  Test('CLI exits nonzero on drift without writing', async () => {
    await withTaoFixture({
      'drift.tao': 'ui   MainView { }',
    }, async (rootDir) => {
      const path = FS.resolvePath('drift.tao', { cwd: rootDir })
      const result = await CLI.run(FS.repoPath('tao'), { args: ['check', rootDir] })

      Expect(result.exitCode).toBe(1)
      Expect(result.stderr).toContain('Needs fixes')
      Expect(result.stderr).toContain('1 noncanonical, 0 unchanged')
      Expect(await FS.readText(path)).toBe('ui   MainView { }')
    })
  })

  Test('CLI exits nonzero on check errors', async () => {
    await withTaoFixture({
      'broken.tao': 'ui Broken {',
    }, async (rootDir) => {
      const result = await CLI.run(FS.repoPath('tao'), { args: ['check', rootDir] })

      Expect(result.exitCode).toBe(1)
      Expect(result.stderr).toContain('Failed to check')
      Expect(result.stderr).toContain('1 failed')
    })
  })

  Test('CLI accepts source produced by tao fix as canonical', async () => {
    await withTaoFixture({
      'app.tao':
        'app MyApp { ui MainView }\nuse Text, Button from @tao/ui\nui MainView { render Text Greeting alias Greeting = "hi" }\n',
    }, async (rootDir) => {
      const fix = await CLI.run(FS.repoPath('tao'), { args: ['fix', rootDir] })
      const check = await CLI.run(FS.repoPath('tao'), { args: ['check', rootDir] })

      Expect(fix.exitCode).toBe(0)
      Expect(check.exitCode).toBe(0)
      Expect(check.stdout).toContain('0 noncanonical, 1 unchanged')
    })
  })
})
