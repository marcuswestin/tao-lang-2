import { FS, Text } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { runFix } from '../cli-src/source-commands'
import {
  packageAwareCliFixedSource,
  packageAwareCliFixture,
  packageAwareCliMainPath,
  packageAwareCliPathCases,
  statusByFile,
  withTaoFixture,
} from './test-cli-files'

Describe('tao fix', () => {
  Test('applies render moves, import organization, and formatting in place', async () => {
    await withTaoFixture({
      'app.tao': Text.stripIndent(`
        app   MyApp { view MainView }
        use Text,Button from @tao/ui
        view MainView() {
           render Text(Greeting)
           let Greeting = "hi"
        }
      `),
    }, async (rootDir) => {
      const path = FS.resolvePath('app.tao', rootDir)
      const results = await runFix(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({ 'app.tao': 'changed' })
      Expect(await FS.readText(path)).toBe(`${
        Text.stripIndent(`
        use Text from @tao/ui

        app MyApp {
           view MainView
        }

        view MainView() {
           let Greeting = "hi"
           render Text(Greeting)
        }
      `)
      }\n`)
    })
  })

  Test('leaves canonical files unchanged and reports broken files', async () => {
    await withTaoFixture({
      'canonical.tao': 'use Text from @tao/ui\n\nview MainView() {\n   render Text("hi")\n}\n',
      'broken.tao': 'view Broken() {',
    }, async (rootDir) => {
      const results = await runFix(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({
        'canonical.tao': 'unchanged',
        'broken.tao': 'error',
      })
      Expect(await FS.readText(FS.resolvePath('broken.tao', rootDir))).toBe('view Broken() {')
    })
  })

  Test('checks generated root-package source without rewriting it', async () => {
    const generated = 'view   Generated() { }'
    await withTaoFixture({
      '@/studio/Generated.tao': generated,
      'App.tao': 'view   AppView() { }',
      'Apps/Foo/@/Nested.tao': 'view   Nested() { }',
      'Packages/@cards/Card.tao': 'view   Card() { }',
    }, async rootDir => {
      const results = await runFix(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({
        '@/studio/Generated.tao': 'error',
        'App.tao': 'changed',
        'Apps/Foo/@/Nested.tao': 'changed',
        'Packages/@cards/Card.tao': 'changed',
      })
      Expect(await FS.readText(FS.resolvePath('@/studio/Generated.tao', rootDir))).toBe(generated)
      Expect(await FS.readText(FS.resolvePath('App.tao', rootDir))).toBe('view AppView() { }\n')
      Expect(await FS.readText(FS.resolvePath('Apps/Foo/@/Nested.tao', rootDir))).toBe('view Nested() { }\n')
      Expect(await FS.readText(FS.resolvePath('Packages/@cards/Card.tao', rootDir))).toBe('view Card() { }\n')
      Expect(results[0]?.error).toContain('regenerate it instead of rewriting it')
    })
  })

  Test('checks an explicitly named generated root-package file without rewriting it', async () => {
    const generated = 'view   Generated() { }'
    await withTaoFixture({
      'Project.tao': 'project { id "generated-fix" name "Generated fix" }\n',
      '@/studio/Generated.tao': generated,
    }, async rootDir => {
      const path = FS.resolvePath('@/studio/Generated.tao', rootDir)
      const results = await runFix(path)

      Expect(results).toEqual([{
        error: 'Generated source under @/ is not canonical; regenerate it instead of rewriting it.',
        path,
        status: 'error',
      }])
      Expect(await FS.readText(path)).toBe(generated)
    })
  })

  for (const pathCase of packageAwareCliPathCases) {
    Test(`uses package-aware workspace roots for ${pathCase.name}`, async () => {
      await withTaoFixture(packageAwareCliFixture, async rootDir => {
        const target = pathCase.resolve(rootDir)
        const results = await runFix(target.path, { cwd: target.cwd })
        const sourcePath = FS.resolvePath(packageAwareCliMainPath, rootDir)

        Expect(statusByFile(results, rootDir)).toEqual({ [packageAwareCliMainPath]: 'changed' })
        Expect(await FS.readText(sourcePath)).toBe(packageAwareCliFixedSource)
      })
    })
  }
})
