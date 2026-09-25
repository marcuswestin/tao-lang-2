import { FS, Text } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import type { InPlace } from '../cli-src/in-place-files'
import { runCheck, runFix } from '../cli-src/source-commands'
import {
  checkedProjectFile,
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

  Test('keeps package imports from a project declared in an ordinary source file', async () => {
    await withTaoFixture({
      'First/Main.tao': 'project { id "first-inline" name "First inline" }\n',
      'First/@data/Data.tao': 'workspace data Labels / Label {\n   Value text\n}\n',
      'First/@ui/View.tao': 'use Labels from @data\n\nworkspace scene Greeting() {\n   query Labels { }\n}\n',
      'Second/Main.tao': 'project { id "second-inline" name "Second inline" }\n',
      'Second/@data/Data.tao': 'workspace data Labels / Label {\n   Value text\n}\n',
      'Second/@ui/View.tao': 'use Labels from @data\n\nworkspace scene Greeting() {\n   query Labels { }\n}\n',
    }, async rootDir => {
      const firstPath = FS.resolvePath('First/@ui/View.tao', rootDir)
      const secondPath = FS.resolvePath('Second/@ui/View.tao', rootDir)
      const results = await runFix(rootDir)

      Expect(statusByFile(results, rootDir)['First/@ui/View.tao']).toBe('changed')
      Expect(statusByFile(results, rootDir)['Second/@ui/View.tao']).toBe('changed')
      Expect(await FS.readText(firstPath)).toContain('use Labels from @data')
      Expect(await FS.readText(secondPath)).toContain('use Labels from @data')
    })
  })

  Test('protects only the project-root @ package and treats nested @ directories as authored', async () => {
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

  Test('protects generated roots owned by nested Tao projects during a repository-wide fix', async () => {
    const generated = 'view   Generated() { }'
    await withTaoFixture({
      'Nested/Project.tao': 'project {\n   id "nested-fix"\n   name "Nested fix"\n}\n',
      'Nested/@/studio/Generated.tao': generated,
      'Nested/Authored.tao': 'view   Authored() { }',
      'Outer.tao': 'view   Outer() { }',
    }, async rootDir => {
      const results = await runFix(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({
        'Nested/@/studio/Generated.tao': 'error',
        'Nested/Authored.tao': 'changed',
        'Nested/Project.tao': 'unchanged',
        'Outer.tao': 'changed',
      })
      Expect(await FS.readText(FS.resolvePath('Nested/@/studio/Generated.tao', rootDir))).toBe(generated)
      Expect(await FS.readText(FS.resolvePath('Nested/Authored.tao', rootDir))).toBe('view Authored() { }\n')
    })
  })

  Test('does not mistake an undeclared nested @ directory for the ancestor project root package', async () => {
    const generated = 'view   Generated() { }'
    await withTaoFixture({
      'Project.tao': 'project {\n   id "outer-fix"\n   name "Outer fix"\n}\n',
      'Apps/Created/@/studio/Generated.tao': generated,
      'Apps/Created/Authored.tao': 'view   Authored() { }',
    }, async rootDir => {
      const results = await runFix(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({
        'Apps/Created/@/studio/Generated.tao': 'changed',
        'Apps/Created/Authored.tao': 'changed',
        'Project.tao': 'unchanged',
      })
      Expect(await FS.readText(FS.resolvePath('Apps/Created/@/studio/Generated.tao', rootDir))).toBe(
        'view Generated() { }\n',
      )
      Expect(await FS.readText(FS.resolvePath('Apps/Created/Authored.tao', rootDir))).toBe('view Authored() { }\n')
    })
  })

  Test('formats an explicitly named nested @ file that is not the project-root package', async () => {
    const generated = 'view   Generated() { }'
    await withTaoFixture({
      'Project.tao': 'project {\n   id "outer-fix-file"\n   name "Outer fix file"\n}\n',
      'Apps/Created/@/studio/Generated.tao': generated,
    }, async rootDir => {
      const path = FS.resolvePath('Apps/Created/@/studio/Generated.tao', rootDir)
      const results = await runFix(path)

      Expect(results).toEqual([{ path, status: 'changed' }])
      Expect(await FS.readText(path)).toBe('view Generated() { }\n')
    })
  })

  Test('migrates legacy design source so check then reports it canonical without legacy warnings', async () => {
    const legacyDesignCodes = ['design-check-flat-catalog', 'design-check-legacy-visual-head']
    await withTaoFixture({
      ...checkedProjectFile,
      'App.tao': Text.stripIndent(`
        use Text from @tao/ui

        app MyApp {
           Design AppDesign
           view MainView
        }

        design AppDesign {
           // The palette stays quiet.
           paper #fffdf8
           inkColor #172019
           card [gap 8, fg inkColor]
        }

        view MainView() [bg paper] {
           render Text("hi") [card, bg paper]
        }
      `),
    }, async rootDir => {
      const path = FS.resolvePath('App.tao', rootDir)
      const legacyCodes = (results: readonly InPlace.Result[]) =>
        results.flatMap(result => result.diagnostics ?? []).map(diagnostic => diagnostic.code)
          .filter(code => code !== undefined && legacyDesignCodes.includes(code))

      const before = await runCheck(rootDir)
      Expect(statusByFile(before, rootDir)).toEqual({ 'App.tao': 'changed', 'Project.tao': 'unchanged' })
      Expect(new Set(legacyCodes(before))).toEqual(new Set(legacyDesignCodes))

      Expect(statusByFile(await runFix(rootDir), rootDir)).toEqual({ 'App.tao': 'changed', 'Project.tao': 'unchanged' })
      Expect(await FS.readText(path)).toBe(`${
        Text.stripIndent(`
        use Text from @tao/ui

        app MyApp {
           Design AppDesign
           view MainView
        }

        design AppDesign {
           colors {
              // The palette stays quiet.
              paper #fffdf8
              inkColor #172019
           }
           styles {
              card [gap 8, ink inkColor]
           }
        }

        view MainView() [background paper] {
           render Text("hi") [card, background paper]
        }
      `)
      }\n`)

      const after = await runCheck(rootDir)
      Expect(statusByFile(after, rootDir)).toEqual({ 'App.tao': 'unchanged', 'Project.tao': 'unchanged' })
      Expect(after.flatMap(result => result.diagnostics ?? [])).toEqual([])
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
