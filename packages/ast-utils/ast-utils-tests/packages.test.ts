import { Packages } from '@ast-utils'
import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

Describe('Tao package discovery', () => {
  Test('walks package directories outside a git worktree without applying loose gitignore files', async () => {
    const root = await mkTestDir('tao-packages-')
    try {
      await FS.writeText(FS.resolvePath('.gitignore', root), '_gen_*\n')
      await FS.writeText(FS.resolvePath('@visible/file.tao', root), '')
      await FS.writeText(FS.resolvePath('_gen_tao-app/@generated/file.tao', root), '')

      const index = await Packages.createIndex(root)

      Expect(index.packages.has('@visible')).toBe(true)
      Expect(index.packages.has('@generated')).toBe(true)
    } finally {
      await FS.remove(root)
    }
  })

  Test('skips hidden future-source directories during recursive package discovery', async () => {
    const root = await mkTestDir('tao-packages-sketches-')
    try {
      const packageRoot = FS.resolvePath('@cards', root)
      await FS.writeText(FS.resolvePath('Main.tao', root), '')
      await FS.writeText(FS.resolvePath('Main.tao', packageRoot), '')
      await FS.writeText(FS.resolvePath('Rows.tao', packageRoot), '')
      await FS.writeText(FS.resolvePath('.hidden/Ignored.tao', packageRoot), '')
      await FS.writeText(FS.resolvePath('MVP-4/Valid.tao', packageRoot), '')
      await FS.writeText(FS.resolvePath('Syntax Sketches/Valid.tao', packageRoot), '')

      const context = await Packages.createContext(root)
      const resolution = Packages.resolve(context, {
        fromFilePath: FS.resolvePath('Main.tao', packageRoot),
      })
      const candidates = (await Packages.candidateFilePaths(resolution))
        .map(path => FS.relativePath(root, path))

      Expect(candidates).toEqual([
        '@cards/MVP-4/Valid.tao',
        '@cards/Main.tao',
        '@cards/Rows.tao',
        '@cards/Syntax Sketches/Valid.tao',
      ])
    } finally {
      await FS.remove(root)
    }
  })

  Test('resolves stdlib imports from the context-owned root', async () => {
    const root = await mkTestDir('tao-packages-stdlib-')
    try {
      const projectRoot = FS.resolvePath('project', root)
      const stdlibRoot = FS.resolvePath('stdlib', root)
      const viewsPath = FS.resolvePath('tao/ui/Views.tao', stdlibRoot)
      await FS.writeText(FS.resolvePath('Main.tao', projectRoot), '')
      await FS.writeText(viewsPath, '')

      const context = await Packages.createContext(projectRoot, { stdlibRoot })
      const resolution = Packages.resolve(context, {
        fromFilePath: FS.resolvePath('Main.tao', projectRoot),
        importPath: '@tao/ui',
      })

      Expect(resolution.targetPath).toBe(FS.resolvePath('tao/ui', stdlibRoot))
      Expect(await Packages.candidateFilePaths(resolution)).toEqual([viewsPath])
    } finally {
      await FS.remove(root)
    }
  })
})
