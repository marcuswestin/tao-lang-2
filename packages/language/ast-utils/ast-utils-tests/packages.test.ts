import { Packages } from '@ast-utils'
import { Parser, URI } from '@parser'
import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

Describe('Tao package discovery', () => {
  Test('walks package directories outside a git worktree without applying loose gitignore files', async () => {
    const root = await mkTestDir('tao-packages-', { location: 'host' })
    try {
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', root), '')
      await FS.writeText(FS.resolvePath('.gitignore', root), '_gen_*\n')
      await FS.writeText(FS.resolvePath('@visible/file.tao', root), '')
      await FS.writeText(FS.resolvePath('_gen_tao-app/@generated/file.tao', root), '')

      const index = await Packages.createIndex(root)

      Expect(index.packages.has('@visible')).toBe(true)
      Expect(index.packages.has('@generated')).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('indexes only package directories containing Tao sources', async () => {
    const root = await mkTestDir('tao-packages-source-eligibility-')
    try {
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', root), '')
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

  Test('does not index a root-level file or an excluded directory named by source paths as a package', async () => {
    const root = await mkTestDir('tao-packages-source-paths-')
    try {
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', root), '')
      const mainPath = FS.resolvePath('Main.tao', root)
      const rootFilePath = FS.resolvePath('@x.tao', root)
      const generatedPath = FS.resolvePath('@generated/_gen_tao-app/View.tao', root)
      const modulePath = FS.resolvePath('@real/View.tao', root)

      const index = await Packages.createIndex(root, [mainPath, rootFilePath, generatedPath, modulePath])

      Expect(index.packages.has('@x.tao')).toBe(false)
      Expect(index.packages.has('@generated')).toBe(false)
      Expect([...index.packages.keys()]).toEqual(['@real'])
    } finally {
      await FS.remove(root)
    }
  })

  Test('reserves the project-root generated package before it contains Tao source', async () => {
    const root = await mkTestDir('tao-packages-generated-root-')
    try {
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', root), '')
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
        await FS.writeText(FS.resolvePath('.tao/.gitkeep', root), '')
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
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', projectRoot), '')
      await FS.writeText(FS.resolvePath('Main.tao', projectRoot), '')
      await FS.writeText(FS.resolvePath('@current/nested/View.tao', root), '')

      const index = await Packages.createIndex(projectRoot)
      const context = await Packages.createContext(projectRoot)

      Expect(index.packages.has('@current')).toBe(false)
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
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', root), '')
      const firstRoot = FS.resolvePath('First', root)
      const secondRoot = FS.resolvePath('Second', root)
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', firstRoot), '')
      await FS.writeText(FS.resolvePath('Main.tao', firstRoot), '')
      await FS.writeText(FS.resolvePath('@data/Data.tao', firstRoot), '')
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', secondRoot), '')
      await FS.writeText(FS.resolvePath('Main.tao', secondRoot), '')
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
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', firstRoot), '')
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
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', projectRoot), '')
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
      Expect(Packages.targetMatches(context, resolution, {
        filePath: escapedFile,
        workspaceFilePaths: new Set([escapedFile]),
      })).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('rechecks a cached package candidate after a workspace build', async () => {
    const root = await mkTestDir('tao-packages-retargeted-symlink-')
    try {
      const projectRoot = FS.resolvePath('Project', root)
      const packageRoot = FS.resolvePath('@data', projectRoot)
      const inside = FS.resolvePath('Inside', packageRoot)
      const outside = FS.resolvePath('Outside', root)
      const linked = FS.resolvePath('linked', packageRoot)
      const linkedFile = FS.resolvePath('Value.tao', linked)
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', projectRoot), '')
      await FS.writeText(FS.resolvePath('Value.tao', inside), 'public let Value = "inside"')
      await FS.writeText(FS.resolvePath('Value.tao', outside), 'public let Value = "outside"')
      await FS.symlink(inside, linked)
      const context = await Packages.createContext(projectRoot)
      const resolution = Packages.resolve(context, {
        fromFilePath: FS.resolvePath('Main.tao', projectRoot),
        importPath: '@data/linked',
      })
      const workspaceFilePaths = new Set([linkedFile])

      Expect(Packages.targetMatches(context, resolution, {
        filePath: linkedFile,
        workspaceFilePaths,
      })).toBe(true)

      await FS.remove(linked)
      await FS.symlink(outside, linked)
      const parser = Parser.createContext({ packages: Packages.createResolver(context) })
      // Instantiate the scope provider before the build phase it observes.
      void parser.services.language.references.ScopeProvider
      const document = parser.services.shared.workspace.LangiumDocumentFactory.fromString(
        '',
        URI.file(FS.resolvePath('Main.tao', projectRoot)),
      )
      parser.services.shared.workspace.LangiumDocuments.addDocument(document)
      await parser.services.shared.workspace.DocumentBuilder.build([document], { eagerLinking: true })

      Expect(Packages.targetMatches(context, resolution, {
        filePath: linkedFile,
        workspaceFilePaths,
      })).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('rejects unrelated candidates and recognizes a file written after a miss', async () => {
    const root = await mkTestDir('tao-packages-physical-paths-')
    try {
      const projectRoot = FS.resolvePath('Project', root)
      const packageRoot = FS.resolvePath('@data', projectRoot)
      const seed = FS.resolvePath('Seed.tao', packageRoot)
      const later = FS.resolvePath('Later.tao', packageRoot)
      const elsewhere = FS.resolvePath('Elsewhere.tao', projectRoot)
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', projectRoot), '')
      await FS.writeText(seed, '')
      await FS.writeText(elsewhere, '')
      const context = await Packages.createContext(projectRoot)
      const resolution = Packages.resolve(context, {
        fromFilePath: FS.resolvePath('Main.tao', projectRoot),
        importPath: '@data',
      })
      const workspaceFilePaths = new Set([seed, later, elsewhere])

      // A file outside the named package is not a candidate.
      Expect(Packages.targetMatches(context, resolution, { filePath: elsewhere, workspaceFilePaths })).toBe(false)

      Expect(Packages.targetMatches(context, resolution, { filePath: seed, workspaceFilePaths })).toBe(true)

      // An unsaved editor buffer has no physical path yet; it must match once it is written.
      Expect(Packages.targetMatches(context, resolution, { filePath: later, workspaceFilePaths })).toBe(false)
      await FS.writeText(later, '')
      Expect(Packages.targetMatches(context, resolution, { filePath: later, workspaceFilePaths })).toBe(true)
    } finally {
      await FS.remove(root)
    }
  })

  Test('keeps a project opened through a symlink in its lexical workspace namespace', async () => {
    const root = await mkTestDir('tao-packages-project-symlink-')
    try {
      const physicalRoot = FS.resolvePath('Physical', root)
      const linkedRoot = FS.resolvePath('Linked', root)
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', physicalRoot), '')
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
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', root), '')
      await FS.writeText(packageMain, '')
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', nestedRoot), '')
      await FS.writeText(nestedFile, '')
      const context = await Packages.createContext(root)

      Expect(Packages.resolve(context, {
        fromFilePath: FS.resolvePath('Main.tao', root),
        importPath: '@outer/Child',
      })).toMatchObject({ invalidReason: 'project-boundary', relation: 'invalid' })
      const bareResolution = Packages.resolve(context, { fromFilePath: packageMain })
      Expect(await Packages.candidateFilePaths(bareResolution)).toEqual([packageMain])
      Expect(Packages.targetMatches(context, bareResolution, {
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
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', root), '')
      for (const project of ['First', 'Second']) {
        await FS.writeText(FS.resolvePath(`${project}/.tao/.gitkeep`, root), '')
        await FS.writeText(FS.resolvePath(`${project}/Main.tao`, root), '')
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
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', root), '')
      await FS.writeText(FS.resolvePath('Main.tao', root), '')
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

  Test('never climbs past the temp-directory boundary to a project declared there', async () => {
    const boundary = await mkTestDir('tao-packages-temp-boundary-')
    try {
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', boundary), '')
      const fixture = FS.resolvePath('fixture', boundary)
      await FS.writeText(FS.resolvePath('Main.tao', fixture), '')

      const found = await Packages.containingProjectRoot(fixture, undefined, { temporaryRoot: boundary })

      Expect(found).toBeUndefined()
    } finally {
      await FS.remove(boundary)
    }
  })

  Test('still finds a project declared in a subdirectory of the temp-directory boundary', async () => {
    const boundary = await mkTestDir('tao-packages-temp-boundary-nested-')
    try {
      const projectRoot = FS.resolvePath('project', boundary)
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', projectRoot), '')
      const nested = FS.resolvePath('screens', projectRoot)
      await FS.writeText(FS.resolvePath('Main.tao', nested), '')

      const found = await Packages.containingProjectRoot(nested, undefined, { temporaryRoot: boundary })

      Expect(found).toBe(projectRoot)
    } finally {
      await FS.remove(boundary)
    }
  })

  Test('skips hidden directories while retaining ordinary named source folders', async () => {
    const root = await mkTestDir('tao-packages-sketches-')
    try {
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', root), '')
      const packageRoot = FS.resolvePath('@cards', root)
      await FS.writeText(FS.resolvePath('Main.tao', root), '')
      await FS.writeText(FS.resolvePath('Main.tao', packageRoot), '')
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
        '@cards/Syntax Sketches/Valid.tao',
      ])
    } finally {
      await FS.remove(root)
    }
  })

  Test('reserves only the project-root bare @ directory as a package boundary', async () => {
    const root = await mkTestDir('tao-packages-generated-boundary-')
    try {
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', root), '')
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
      Expect(Packages.targetMatches(context, resolution, {
        filePath: FS.resolvePath('@cards/Apps/Foo/@/Nested.tao', root),
        workspaceFilePaths: new Set([
          mainPath,
          FS.resolvePath('@/studio/Generated.tao', root),
          FS.resolvePath('@cards/Apps/Foo/@/Nested.tao', root),
        ]),
      })).toBe(true)
      Expect(Packages.targetMatches(context, resolution, {
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
