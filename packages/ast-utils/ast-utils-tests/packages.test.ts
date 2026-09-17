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

  Test('does not index package directories above the project root', async () => {
    const root = await mkTestDir('tao-packages-ancestor-eligibility-')
    try {
      const projectRoot = FS.resolvePath('project', root)
      await FS.writeText(FS.resolvePath('Main.tao', projectRoot), '')
      await FS.writeText(FS.resolvePath('@current/nested/View.tao', root), '')
      await FS.writeText(FS.resolvePath('@future/nested/View.tao-next', root), '')

      const index = await Packages.createIndex(projectRoot)
      const context = await Packages.createContext(projectRoot)

      Expect(index.packages.has('@current')).toBe(false)
      Expect(index.packages.has('@future')).toBe(false)
      Expect(Packages.resolve(context, {
        fromFilePath: FS.resolvePath('Main.tao', projectRoot),
        importPath: '../Outside',
      })).toMatchObject({ invalidReason: 'project-boundary', relation: 'invalid' })
    } finally {
      await FS.remove(root)
    }
  })

  Test('resolves the same package name independently in sibling projects', async () => {
    const root = await mkTestDir('tao-packages-project-local-')
    try {
      const firstRoot = FS.resolvePath('First', root)
      const secondRoot = FS.resolvePath('Second', root)
      await FS.writeText(FS.resolvePath('Main.tao', firstRoot), 'project { id "first" name "First" }')
      await FS.writeText(FS.resolvePath('@data/Data.tao', firstRoot), '')
      await FS.writeText(FS.resolvePath('Main.tao', secondRoot), 'project { id "second" name "Second" }')
      await FS.writeText(FS.resolvePath('@data/Data.tao', secondRoot), '')
      const context = await Packages.createContext(root)

      Expect(Packages.resolve(context, {
        fromFilePath: FS.resolvePath('Main.tao', firstRoot),
        importPath: '@data',
      })).toMatchObject({
        relation: 'same-project-package',
        targetPath: FS.resolvePath('@data', firstRoot),
      })
      Expect(Packages.resolve(context, {
        fromFilePath: FS.resolvePath('Main.tao', secondRoot),
        importPath: '@data',
      })).toMatchObject({
        relation: 'same-project-package',
        targetPath: FS.resolvePath('@data', secondRoot),
      })
      Expect(Packages.resolve(context, {
        fromFilePath: FS.resolvePath('Main.tao', firstRoot),
        importPath: '@data/../../Outside',
      })).toMatchObject({
        invalidReason: 'package-path-escape',
        packageName: '@data',
        relation: 'invalid',
      })
    } finally {
      await FS.remove(root)
    }
  })

  Test('does not assign external documents to the first indexed project', async () => {
    const root = await mkTestDir('tao-packages-external-')
    try {
      const firstRoot = FS.resolvePath('First', root)
      const externalFile = FS.resolvePath('External.tao', root)
      await FS.writeText(FS.resolvePath('Project.tao', firstRoot), 'project { id "first" name "First" }')
      await FS.writeText(FS.resolvePath('@data/Data.tao', firstRoot), '')
      await FS.writeText(externalFile, '')
      const context = await Packages.createContext(firstRoot)

      Expect(Packages.projectRootForPath(context.index, externalFile)).toBeUndefined()
      Expect(Packages.resolve(context, { fromFilePath: externalFile, importPath: '@data' })).toMatchObject({
        invalidReason: 'project-boundary',
        relation: 'invalid',
      })
      Expect(Packages.resolve(context, { fromFilePath: externalFile, importPath: './First' })).toMatchObject({
        invalidReason: 'project-boundary',
        relation: 'invalid',
      })
    } finally {
      await FS.remove(root)
    }
  })

  Test('rejects package candidates whose symlink target escapes the physical package root', async () => {
    const root = await mkTestDir('tao-packages-symlink-')
    try {
      const projectRoot = FS.resolvePath('Project', root)
      const outside = FS.resolvePath('Outside', root)
      const packageRoot = FS.resolvePath('@data', projectRoot)
      await FS.writeText(FS.resolvePath('Project.tao', projectRoot), 'project { id "project" name "Project" }')
      await FS.writeText(FS.resolvePath('Seed.tao', packageRoot), '')
      await FS.writeText(FS.resolvePath('Secret.tao', outside), 'public let Secret = "outside"')
      await FS.symlink(outside, FS.resolvePath('escaped', packageRoot))
      const context = await Packages.createContext(projectRoot)
      const resolution = Packages.resolve(context, {
        fromFilePath: FS.resolvePath('Main.tao', projectRoot),
        importPath: '@data/escaped',
      })

      Expect(resolution).toMatchObject({
        relation: 'same-project-package',
        targetPath: FS.resolvePath('escaped', packageRoot),
      })
      Expect(await Packages.candidateFilePaths(resolution)).toEqual([])
      const escapedFile = FS.resolvePath('escaped/Secret.tao', packageRoot)
      Expect(Packages.targetMatches(resolution, {
        filePath: escapedFile,
        workspaceFilePaths: new Set([escapedFile]),
      })).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('keeps a project opened through a symlink in its lexical workspace namespace', async () => {
    const root = await mkTestDir('tao-packages-project-symlink-')
    try {
      const physicalRoot = FS.resolvePath('Physical', root)
      const linkedRoot = FS.resolvePath('Linked', root)
      await FS.writeText(FS.resolvePath('Project.tao', physicalRoot), 'project { id "linked" name "Linked" }')
      await FS.writeText(FS.resolvePath('@data/Data.tao', physicalRoot), '')
      await FS.symlink(physicalRoot, linkedRoot)
      const context = await Packages.createContext(linkedRoot)
      const resolution = Packages.resolve(context, {
        fromFilePath: FS.resolvePath('Main.tao', linkedRoot),
        importPath: '@data',
      })

      Expect(context.index.projectRoot).toBe(linkedRoot)
      Expect(resolution).toMatchObject({
        relation: 'same-project-package',
        targetPath: FS.resolvePath('@data', linkedRoot),
      })
      Expect(await Packages.candidateFilePaths(resolution)).toEqual([FS.resolvePath('@data/Data.tao', linkedRoot)])
    } finally {
      await FS.remove(root)
    }
  })

  Test('does not enter a nested project through a package subpath or bare package import', async () => {
    const root = await mkTestDir('tao-packages-nested-project-boundary-')
    try {
      const packageMain = FS.resolvePath('@outer/Main.tao', root)
      const nestedRoot = FS.resolvePath('@outer/Child', root)
      const nestedFile = FS.resolvePath('Hidden.tao', nestedRoot)
      await FS.writeText(FS.resolvePath('Project.tao', root), 'project { id "outer" name "Outer" }')
      await FS.writeText(packageMain, '')
      await FS.writeText(FS.resolvePath('Project.tao', nestedRoot), 'project { id "child" name "Child" }')
      await FS.writeText(nestedFile, '')
      const context = await Packages.createContext(root)

      Expect(Packages.resolve(context, {
        fromFilePath: FS.resolvePath('Main.tao', root),
        importPath: '@outer/Child',
      })).toMatchObject({ invalidReason: 'project-boundary', relation: 'invalid' })
      const bareResolution = Packages.resolve(context, { fromFilePath: packageMain })
      Expect(await Packages.candidateFilePaths(bareResolution)).toEqual([packageMain])
      Expect(Packages.targetMatches(bareResolution, {
        filePath: nestedFile,
        workspaceFilePaths: new Set([packageMain, nestedFile]),
      })).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('reserves a separate generated package for each declared project', async () => {
    const root = await mkTestDir('tao-packages-project-generated-roots-')
    try {
      for (const project of ['First', 'Second']) {
        await FS.writeText(
          FS.resolvePath(`${project}/Main.tao`, root),
          `project { id "${project.toLowerCase()}" name "${project}" }`,
        )
        await FS.writeText(FS.resolvePath(`${project}/@/studio/.gitkeep`, root), '')
      }
      const context = await Packages.createContext(root)

      Expect(context.index.packages.get('@')).toEqual([
        FS.resolvePath('First/@', root),
        FS.resolvePath('Second/@', root),
      ])
      for (const project of ['First', 'Second']) {
        Expect(Packages.resolve(context, {
          fromFilePath: FS.resolvePath(`${project}/Main.tao`, root),
          importPath: '@/studio',
        })).toMatchObject({
          relation: 'same-project-package',
          targetPath: FS.resolvePath(`${project}/@/studio`, root),
        })
      }
    } finally {
      await FS.remove(root)
    }
  })

  Test('roots a nested entry context at its containing project', async () => {
    const root = await mkTestDir('tao-packages-containing-project-')
    try {
      const nestedRoot = FS.resolvePath('screens', root)
      await FS.writeText(FS.resolvePath('Main.tao', root), 'project { id "root" name "Root" }')
      await FS.writeText(FS.resolvePath('Main.tao', nestedRoot), '')
      await FS.writeText(FS.resolvePath('@data/Data.tao', root), '')
      const context = await Packages.createContext(nestedRoot)

      Expect(context.index.projectRoot).toBe(root)
      Expect(Packages.resolve(context, {
        fromFilePath: FS.resolvePath('Main.tao', nestedRoot),
        importPath: '@data',
      })).toMatchObject({
        relation: 'same-project-package',
        targetPath: FS.resolvePath('@data', root),
      })
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

  Test('reserves only the project-root bare @ directory as a package boundary', async () => {
    const root = await mkTestDir('tao-packages-generated-boundary-')
    try {
      const mainPath = FS.resolvePath('@cards/Main.tao', root)
      await FS.writeText(mainPath, '')
      await FS.writeText(FS.resolvePath('@/studio/Generated.tao', root), '')
      await FS.writeText(FS.resolvePath('@cards/Apps/Foo/@/Nested.tao', root), '')
      const context = await Packages.createContext(root)
      const resolution = Packages.resolve(context, { fromFilePath: mainPath })

      Expect((await Packages.candidateFilePaths(resolution)).map(path => FS.relativePath(root, path))).toEqual([
        '@cards/Apps/Foo/@/Nested.tao',
        '@cards/Main.tao',
      ])
      Expect(Packages.targetMatches(resolution, {
        filePath: FS.resolvePath('@cards/Apps/Foo/@/Nested.tao', root),
        workspaceFilePaths: new Set([
          mainPath,
          FS.resolvePath('@/studio/Generated.tao', root),
          FS.resolvePath('@cards/Apps/Foo/@/Nested.tao', root),
        ]),
      })).toBe(true)
      Expect(Packages.targetMatches(resolution, {
        filePath: FS.resolvePath('@/studio/Generated.tao', root),
        workspaceFilePaths: new Set(),
      })).toBe(false)
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
      const escaped = Packages.resolve(context, {
        fromFilePath: FS.resolvePath('Main.tao', projectRoot),
        importPath: '@tao/../../../Outside',
      })
      Expect(escaped).toMatchObject({
        invalidReason: 'package-path-escape',
        packageName: '@tao',
        relation: 'invalid',
      })
      Expect(await Packages.candidateFilePaths(escaped)).toEqual([])
    } finally {
      await FS.remove(root)
    }
  })
})
