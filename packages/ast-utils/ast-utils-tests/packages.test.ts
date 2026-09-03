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

  Test('indexes only package directories containing Tao sources', async () => {
    const root = await mkTestDir('tao-packages-source-eligibility-')
    try {
      await FS.writeText(FS.resolvePath('@current/nested/View.tao', root), '')
      await FS.writeText(FS.resolvePath('@future/nested/View.tao-next', root), '')
      await FS.writeText(FS.resolvePath('@notes/README.md', root), '')

      const index = await Packages.createIndex(root)

      Expect(index.packages.has('@current')).toBe(true)
      Expect(index.packages.has('@future')).toBe(false)
      Expect(index.packages.has('@notes')).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('reserves the project-root generated package before it contains Tao source', async () => {
    const root = await mkTestDir('tao-packages-generated-root-')
    try {
      await FS.writeText(FS.resolvePath('@/studio/.gitkeep', root), '')

      const context = await Packages.createContext(root)
      const rootResolution = Packages.resolve(context, {
        fromFilePath: FS.resolvePath('Main.tao', root),
        importPath: '@',
      })
      const nestedResolution = Packages.resolve(context, {
        fromFilePath: FS.resolvePath('Main.tao', root),
        importPath: '@/studio',
      })

      Expect(context.index.packages.get('@')).toEqual([FS.resolvePath('@', root)])
      Expect(rootResolution).toMatchObject({
        packageName: '@',
        relation: 'same-project-package',
        targetPath: FS.resolvePath('@', root),
      })
      Expect(nestedResolution).toMatchObject({
        packageName: '@',
        relation: 'same-project-package',
        targetPath: FS.resolvePath('@/studio', root),
      })
    } finally {
      await FS.remove(root)
    }
  })

  Test(
    'allows generated source to import ordinary project files without opening other package boundaries',
    async () => {
      const root = await mkTestDir('tao-packages-generated-relative-')
      try {
        const generatedView = FS.resolvePath('@/studio/View.tao', root)
        await FS.writeText(generatedView, '')
        await FS.writeText(FS.resolvePath('Data.tao', root), '')
        await FS.writeText(FS.resolvePath('@other/Data.tao', root), '')
        const context = await Packages.createContext(root)

        Expect(Packages.resolve(context, {
          fromFilePath: generatedView,
          importPath: '../../Data',
        })).toMatchObject({
          packageName: '@',
          relation: 'same-project-package',
          targetPath: FS.resolvePath('Data', root),
        })
        Expect(Packages.resolve(context, {
          fromFilePath: generatedView,
          importPath: '../../@other',
        })).toMatchObject({ invalidReason: 'package-boundary', relation: 'invalid' })
        Expect(Packages.resolve(context, {
          fromFilePath: FS.resolvePath('Main.tao', root),
          importPath: './@/studio',
        })).toMatchObject({ invalidReason: 'package-boundary', relation: 'invalid' })
      } finally {
        await FS.remove(root)
      }
    },
  )

  Test('indexes only eligible package directories beside ancestor roots', async () => {
    const root = await mkTestDir('tao-packages-ancestor-eligibility-')
    try {
      const projectRoot = FS.resolvePath('project', root)
      await FS.writeText(FS.resolvePath('Main.tao', projectRoot), '')
      await FS.writeText(FS.resolvePath('@current/nested/View.tao', root), '')
      await FS.writeText(FS.resolvePath('@future/nested/View.tao-next', root), '')

      const index = await Packages.createIndex(projectRoot)

      Expect(index.packages.has('@current')).toBe(true)
      Expect(index.packages.has('@future')).toBe(false)
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
      const viewsPath = FS.resolvePath('@tao/ui/Views.tao', stdlibRoot)
      await FS.writeText(FS.resolvePath('Main.tao', projectRoot), '')
      await FS.writeText(viewsPath, '')

      const context = await Packages.createContext(projectRoot, { stdlibRoot })
      const resolution = Packages.resolve(context, {
        fromFilePath: FS.resolvePath('Main.tao', projectRoot),
        importPath: '@tao/ui',
      })

      Expect(resolution.targetPath).toBe(FS.resolvePath('@tao/ui', stdlibRoot))
      Expect(await Packages.candidateFilePaths(resolution)).toEqual([viewsPath])
    } finally {
      await FS.remove(root)
    }
  })
})
