import { FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { projectNativeBindingInventory } from '../project-tooling-src/ProjectNativeBindingInventory'

Describe('maintained native generator inventory', () => {
  Test('discovers nested TypeScript additions and removals without scanning SDK or generated payloads', async () => {
    await withTaoFiles('tao-native-generator-inventory-', {
      'generator/generate.ts': 'export const generator = true',
      'generator/existing/empty/.gitkeep': '',
    }, async (_paths, fixture) => {
      const generator = FS.resolvePath('generator', fixture)
      const plan = { declarationRoots: [], outputRoots: [], shallowRoots: [], generatorRoots: [generator] }
      const original = await projectNativeBindingInventory(plan)
      const added = FS.resolvePath('existing/empty/new.ts', generator)
      await FS.writeText(added, 'export const added = true')
      const changed = await projectNativeBindingInventory(plan)
      Expect(changed).not.toBe(original)
      Expect(JSON.parse(changed)).toContain(added)
      await FS.remove(added)
      Expect(await projectNativeBindingInventory(plan)).toBe(original)
      for (
        const path of [
          'node_modules/native/unrelated.ts',
          '.tao-ts/unrelated.ts',
          '.artifacts/unrelated.ts',
          'generate.ts.tao-file-mutation.lock.owner-test/nested.ts',
          'existing/empty/unrelated.js',
        ]
      ) {
        await FS.writeText(FS.resolvePath(path, generator), 'unrelated payload')
      }
      Expect(await projectNativeBindingInventory(plan)).toBe(original)
    }, { verbatim: true })
  })
})
