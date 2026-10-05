import { Workspace } from '@compiler/workspace'
import { Assert, FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { EmittedModuleCache } from '../compiler-src/compiler'

Describe('compiler: portable native bridge output', () => {
  Test('retains nominal native result types through copied sidecars and cached emission', async () => {
    await withTaoFiles('tao-native-output-', {
      'Main.tao': `
        use DirectoryUriGet, PathsCacheGet from @tao/device/files
        app Example { id "native-output" version "1.0.0" name "Example" view Main }
        action Read() {
          let Directory = do PathsCacheGet()
          let Uri = do DirectoryUriGet(Directory)
        }
        view Main() { render inject \`\`\`ts return null \`\`\` }
      `,
    }, async (paths, root) => {
      const cache = new EmittedModuleCache()
      const compile = async (cached: boolean) =>
        await (await Workspace.open(root)).compileFiles([paths['Main.tao']], {
          ...(cached ? { emittedModuleCache: cache } : {}),
        })
      const first = await compile(true)
      const main = first.files.find(file => file.sourcePath === paths['Main.tao'] && file.relativePath === 'App.tsx')
      Assert.defined(main, 'native caller module is emitted')
      const mapped = main.code.match(/TR\.DoResult<import\("([^"]+)"\)\.NativeTypes\["Directory"\]>/)
      Assert.defined(mapped, 'native result retains its nominal bridge type')
      const implementationPath = FS.resolvePath(`${mapped[1]}.ts`, FS.dirname(FS.resolvePath(main.relativePath)))
      const implementation = first.files.find(file => FS.resolvePath(file.relativePath) === implementationPath)
      Assert.defined(implementation, 'native type import resolves to a copied implementation')
      Expect(implementation.sourcePath).toContain('/.tao-ts/native-bindings/files/Bindings.ts')
      Expect(implementation.code).toContain('export type NativeTypes =')
      Expect(main.code).not.toContain(root)
      const cached = await compile(true)
      Expect(cached.emittedModuleCache?.hits).toBeGreaterThan(0)
      Expect(cached.files).toEqual(first.files)
      Expect((await compile(false)).files).toEqual(first.files)
    })
  })
})
