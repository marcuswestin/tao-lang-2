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

  Test('skips future Tao sketch directories during recursive package discovery', async () => {
    const root = await mkTestDir('tao-packages-sketches-')
    try {
      const packageRoot = FS.resolvePath('@cards', root)
      await FS.writeText(FS.resolvePath('Main.tao', root), '')
      await FS.writeText(FS.resolvePath('Main.tao', packageRoot), '')
      await FS.writeText(FS.resolvePath('Rows.tao', packageRoot), '')
      await FS.writeText(FS.resolvePath('MVP-triage/Future.tao', packageRoot), '')
      await FS.writeText(FS.resolvePath('Syntax Sketches/Future.tao', packageRoot), '')

      const context = await Packages.createContext(root)
      const resolution = Packages.resolve(context, {
        fromFilePath: FS.resolvePath('Main.tao', packageRoot),
      })
      const candidates = (await Packages.candidateFilePaths(resolution))
        .map(path => FS.relativePath(root, path))

      Expect(candidates).toEqual([
        '@cards/Main.tao',
        '@cards/Rows.tao',
      ])
    } finally {
      await FS.remove(root)
    }
  })
})
