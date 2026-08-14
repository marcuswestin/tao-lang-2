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
        view MainView {
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

        view MainView {
           let Greeting = "hi"
           render Text(Greeting)
        }
      `)
      }\n`)
    })
  })

  Test('leaves canonical files unchanged and reports broken files', async () => {
    await withTaoFixture({
      'canonical.tao': 'use Text from @tao/ui\n\nview MainView {\n   render Text("hi")\n}\n',
      'broken.tao': 'view Broken {',
    }, async (rootDir) => {
      const results = await runFix(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({
        'canonical.tao': 'unchanged',
        'broken.tao': 'error',
      })
      Expect(await FS.readText(FS.resolvePath('broken.tao', rootDir))).toBe('view Broken {')
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
