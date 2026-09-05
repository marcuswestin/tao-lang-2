import { CLI, FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { runCheck } from '../cli-src/source-commands'
import {
  packageAwareCliFixture,
  packageAwareCliMainPath,
  packageAwareCliPathCases,
  statusByFile,
  withTaoFixture,
} from './test-cli-files'

Describe('tao check', () => {
  Test('reports canonical files as unchanged without writing', async () => {
    await withTaoFixture({
      'canonical.tao': 'view MainView() { }\n',
    }, async (rootDir) => {
      const results = await runCheck(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({ 'canonical.tao': 'unchanged' })
      Expect(await FS.readText(FS.resolvePath('canonical.tao', rootDir))).toBe('view MainView() { }\n')
    })
  })

  Test('reports shipping warnings for authored Placeholder renders but exempts Studio generated source', async () => {
    await withTaoFixture({
      '@/studio/View1.tao':
        'use Placeholder from @tao/ui\n\npublic\nview View1() {\n   render Placeholder("View1")\n}\n',
      'App.tao': 'use Placeholder from @tao/ui\n\nview Main() {\n   render Placeholder("Main")\n}\n',
      'Placeholder.test.tao':
        'use Placeholder from @tao/ui\n\nview TestDraft() {\n   render Placeholder("Test draft")\n}\n',
    }, async rootDir => {
      const results = await runCheck(rootDir)
      const authored = results.find(result => FS.basename(result.path) === 'App.tao')
      const generated = results.find(result => FS.basename(result.path) === 'View1.tao')
      const testSource = results.find(result => FS.basename(result.path) === 'Placeholder.test.tao')

      Expect(authored?.warnings).toHaveLength(1)
      Expect(authored?.warnings?.[0]).toContain('Placeholder ships as an empty box in release.')
      Expect(generated?.warnings).toBeUndefined()
      Expect(testSource?.warnings).toBeUndefined()
      Expect(statusByFile(results, rootDir)).toEqual({
        '@/studio/View1.tao': 'unchanged',
        'App.tao': 'unchanged',
        'Placeholder.test.tao': 'unchanged',
      })
    })
  })

  Test('validates nested Tao projects with their own generated-root ownership', async () => {
    await withTaoFixture({
      'Nested/Project.tao': 'project {\n   id "nested-check"\n   name "Nested check"\n}\n',
      'Nested/@/studio/View1.tao':
        'use Placeholder from @tao/ui\n\npublic\nview View1() {\n   render Placeholder("Generated")\n}\n',
      'Nested/Authored.tao': 'use Placeholder from @tao/ui\n\nview Main() {\n   render Placeholder("Authored")\n}\n',
    }, async rootDir => {
      const results = await runCheck(rootDir)
      const generated = results.find(result => result.path.endsWith('/@/studio/View1.tao'))
      const authored = results.find(result => result.path.endsWith('/Authored.tao'))

      Expect(generated?.warnings).toBeUndefined()
      Expect(authored?.warnings).toHaveLength(1)
      Expect(authored?.warnings?.[0]).toContain('Placeholder ships as an empty box in release.')
    })
  })

  Test('reports drift without writing', async () => {
    await withTaoFixture({
      'drift.tao': 'view   MainView() { }',
    }, async (rootDir) => {
      const path = FS.resolvePath('drift.tao', rootDir)
      const results = await runCheck(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({ 'drift.tao': 'changed' })
      Expect(await FS.readText(path)).toBe('view   MainView() { }')
    })
  })

  Test('reports syntax errors without writing', async () => {
    await withTaoFixture({
      'broken.tao': 'view Broken() {',
    }, async (rootDir) => {
      const path = FS.resolvePath('broken.tao', rootDir)
      const results = await runCheck(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({ 'broken.tao': 'error' })
      Expect(await FS.readText(path)).toBe('view Broken() {')
    })
  })

  Test('walks non-git fixture directories without applying loose gitignore files', async () => {
    await withTaoFixture({
      '.gitignore': 'node_modules\n.artifacts\n.custom-hidden\nAndroid\nIOS\nPods\npods\n',
      'canonical.tao': 'view MainView() { }\n',
      'node_modules/pkg/ignored.tao': 'view   Ignored() { }',
      '.artifacts/ignored.tao': 'view   Ignored() { }',
      '.custom-hidden/ignored.tao': 'view   Ignored() { }',
      'Android/ignored.tao': 'view   Ignored() { }',
      'IOS/ignored.tao': 'view   Ignored() { }',
      'Pods/ignored.tao': 'view   Ignored() { }',
      'pods/ignored.tao': 'view   Ignored() { }',
    }, async (rootDir) => {
      const results = await runCheck(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({ 'canonical.tao': 'unchanged' })
    })
  })

  Test('skips hidden future-source directories without reserving user directory names', async () => {
    await withTaoFixture({
      'canonical.tao': 'view MainView() { }\n',
      'Apps/WordFlower/.tao-archive/Future.tao': 'project app FutureMVP {',
      'Apps/WordFlower/1 - Current/Valid.tao': 'view ValidCurrentMVP() { }\n',
      'Roadmap/Feature/Syntax Sketches/Valid.tao': 'view ValidSyntaxSketch() { }\n',
    }, async (rootDir) => {
      const results = await runCheck(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({
        'Apps/WordFlower/1 - Current/Valid.tao': 'unchanged',
        'Roadmap/Feature/Syntax Sketches/Valid.tao': 'unchanged',
        'canonical.tao': 'unchanged',
      })
    })
  })

  Test('skips an explicitly named ignored directory', async () => {
    await withTaoFixture({
      '.gitignore': 'node_modules\n',
      'node_modules/pkg/ignored.tao': 'view   Ignored() { }',
    }, async (rootDir) => {
      await CLI.mustRun('git', { args: ['init', '--quiet'], cwd: rootDir })
      const directory = FS.resolvePath('node_modules', rootDir)

      Expect(await runCheck(directory)).toEqual([])
    })
  })

  for (const pathCase of packageAwareCliPathCases) {
    Test(`uses package-aware workspace roots for ${pathCase.name}`, async () => {
      await withTaoFixture(packageAwareCliFixture, async rootDir => {
        const target = pathCase.resolve(rootDir)
        const results = await runCheck(target.path, { cwd: target.cwd })
        const sourcePath = FS.resolvePath(packageAwareCliMainPath, rootDir)

        Expect(statusByFile(results, rootDir)).toEqual({ [packageAwareCliMainPath]: 'changed' })
        Expect(await FS.readText(sourcePath)).toContain('LocalText, Missing')
      })
    })
  }
})
