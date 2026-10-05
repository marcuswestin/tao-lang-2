import { Packages } from '@ast-utils'
import { Workspace } from '@compiler/workspace'
import { AST, createValidationBoundaryObservations, Parser, URI, type ValidationBoundaryObservations } from '@parser'
import { FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'

Describe('parser validation dependency snapshots', () => {
  Test('shares owner, module, and marker filesystem work only within one publication', async () => {
    await withTaoFiles('tao-validation-observations-', {
      '.tao/.gitkeep': '',
      '@ui/One.tao': 'public let One = "one"',
      '@ui/Two.tao': 'public let Two = "two"',
      '@ui/Three.tao': 'public let Three = "three"',
    }, async (paths, root) => {
      const resolver = Packages.createResolver(
        await Packages.createContext(root, {
          stdlibRoot: FS.resolvePath('absent-stdlib', root),
        }),
      )
      const sourcePaths = (['@ui/One.tao', '@ui/Two.tao', '@ui/Three.tao'] as const).map(name => paths[name]!)
      const marker = FS.resolvePath('.tao', root)
      const moduleRoot = FS.resolvePath('@ui', root)
      const reads = new Map<string, number>()
      let failMarker = false
      const operations: ValidationBoundaryObservations = {
        async realPath(path) {
          const key = `realpath:${path}`
          reads.set(key, (reads.get(key) ?? 0) + 1)
          return FS.realPath(failMarker && path === marker ? FS.resolvePath('missing-marker', root) : path)
        },
        async isDirectory(path) {
          const key = `directory:${path}`
          reads.set(key, (reads.get(key) ?? 0) + 1)
          return FS.isDirectory(path)
        },
      }
      const publish = async () => {
        reads.clear()
        const observations = createValidationBoundaryObservations(operations)
        return Promise.all(sourcePaths.map(path => resolver.validationBoundary(path, observations)))
      }
      const first = await publish()
      Expect(first.every(value => value !== undefined)).toBe(true)
      Expect(new Set(first).size).toBe(3)
      Expect(reads.get(`realpath:${root}`)).toBe(1)
      Expect(reads.get(`realpath:${moduleRoot}`)).toBe(1)
      Expect(reads.get(`directory:${marker}`)).toBe(1)
      Expect(reads.get(`realpath:${marker}`)).toBe(1)
      Expect([...reads.values()].reduce((sum, count) => sum + count, 0)).toBe(7)
      const uncached = await Promise.all(sourcePaths.map(path => resolver.validationBoundary(path)))
      Expect(first).toEqual(uncached)
      const second = await publish()
      Expect(second).toEqual(first)
      Expect(reads.get(`realpath:${root}`)).toBe(1)
      Expect(reads.get(`realpath:${moduleRoot}`)).toBe(1)
      Expect(reads.get(`realpath:${marker}`)).toBe(1)
      await FS.remove(marker)
      const unavailable = await publish()
      Expect(unavailable.every(value => value === undefined)).toBe(true)
      Expect(reads.get(`directory:${marker}`)).toBe(1)
      Expect(reads.has(`realpath:${marker}`)).toBe(false)
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', root), '')
      failMarker = true
      const failed = await publish()
      Expect(failed.every(value => value === undefined)).toBe(true)
      Expect(reads.get(`directory:${marker}`)).toBe(1)
      Expect(reads.get(`realpath:${marker}`)).toBe(1)
      failMarker = false
      const recovered = await publish()
      Expect(recovered).toEqual(first)
      Expect(reads.get(`realpath:${marker}`)).toBe(1)
    })
  })

  Test('passes one observation scope to every document and replaces it on the next completed build', async () => {
    await withTaoFiles('tao-validation-publication-scope-', {
      '.tao/.gitkeep': '',
      'Main.tao': 'use Value from ./Library\nlet Selected = Value',
      'Library.tao': 'public let Value = "one"',
    }, async (paths, root) => {
      const resolver = Packages.createResolver(
        await Packages.createContext(root, {
          stdlibRoot: FS.resolvePath('absent-stdlib', root),
        }),
      )
      const scopes: (ValidationBoundaryObservations | undefined)[] = []
      const context = Parser.createContext({
        packages: {
          ...resolver,
          validationBoundary(path, observations) {
            scopes.push(observations)
            return resolver.validationBoundary(path, observations)
          },
        },
      })
      const first = await Parser.parse(context, URI.file(paths['Main.tao']!))
      Expect(first.diagnostics).toEqual([])
      Expect(scopes).toHaveLength(2)
      Expect(scopes[0]).toBeDefined()
      Expect(scopes[0] === scopes[1]).toBe(true)
      const before = Parser.validationDependencies(first.entry.ast)!
      const warm = await Parser.parse(context, URI.file(paths['Main.tao']!))
      Expect(scopes).toHaveLength(4)
      Expect(scopes[2] === scopes[3]).toBe(true)
      Expect(scopes[2] === scopes[0]).toBe(false)
      const after = Parser.validationDependencies(warm.entry.ast)!
      expectIdentities(after.files, before.files)
      expectIdentities(after.targets, before.targets)
      Expect(after.signature).toBe(before.signature)
      await FS.remove(FS.resolvePath('.tao', root))
      const removed = await Parser.parse(context, URI.file(paths['Main.tao']!))
      Expect(Parser.validationDependencies(removed.entry.ast)).toBeUndefined()
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', root), '')
      const restored = await Parser.parse(context, URI.file(paths['Main.tao']!))
      const cold = await Parser.parse(await fixtureContext(root), URI.file(paths['Main.tao']!))
      Expect(restored.diagnostics).toEqual(cold.diagnostics)
      Expect(Parser.validationDependencies(restored.entry.ast)!.signature).toBe(before.signature)
    })
  })

  Test('captures exact immutable vectors and reuses canonical ASTs on an unchanged build', async () => {
    await withTaoFiles('tao-validation-inputs-', {
      'Main.tao': 'use Value from ./Library\nlet Selected = Value',
      'Library.tao': 'public let Value = "one"',
    }, async (paths, root) => {
      const context = await fixtureContext(root)
      const first = await Parser.parse(context, URI.file(paths['Main.tao']))
      const main = first.entry.ast
      const library = first.files.find(file => file.path === paths['Library.tao'])!.ast
      const value = library.statements.find(AST.isAliasDeclaration)!
      const before = Parser.validationDependencies(main)!
      Expect(before).toBeDefined()
      expectIdentities(before.files, [library, main])
      expectIdentities(before.targets, [value])
      Expect(Object.isFrozen(before)).toBe(true)
      Expect(Object.isFrozen(before.files)).toBe(true)
      Expect(Object.isFrozen(before.targets)).toBe(true)
      const after = await Parser.parse(context, URI.file(paths['Main.tao']))
      const next = Parser.validationDependencies(after.entry.ast)!
      Expect(after.entry.ast).toBe(main)
      Expect(next.files.every((file, index) => file === before.files[index])).toBe(true)
      Expect(next.targets.every((target, index) => target === before.targets[index])).toBe(true)
      Expect(next.signature).toBe(before.signature)
    })
  })

  Test('records transitive imports before already-loaded suppression and replaces edited AST inputs', async () => {
    await withTaoFiles('tao-validation-transitive-', {
      'Main.tao': 'use Value from ./Library\nuse Deep from ./Deep\nlet Selected = Value',
      'Library.tao': 'use Deep from ./Deep\npublic let Value = Deep',
      'Deep.tao': 'public let Deep = "one"',
      'Other.tao': 'public let Other = "other"',
    }, async (paths, root) => {
      const context = await fixtureContext(root)
      const first = await Parser.parse(context, URI.file(paths['Main.tao']))
      const library = first.files.find(file => file.path === paths['Library.tao'])!.ast
      const before = Parser.validationDependencies(library)!
      Expect(before.files.map(file => FS.basename(AST.getDocument(file).uri.path))).toEqual([
        'Deep.tao',
        'Library.tao',
        'Main.tao',
        'Other.tao',
      ])
      const deep = first.files.find(file => file.path === paths['Deep.tao'])!.ast
      await FS.writeText(paths['Deep.tao'], 'public let Deep = "two"')
      const edited = await Parser.parse(context, URI.file(paths['Main.tao']))
      const next = Parser.validationDependencies(library)!
      Expect(edited.files.find(file => file.path === paths['Library.tao'])!.ast).toBe(library)
      Expect(next.files.includes(deep)).toBe(false)
      Expect(next.targets.some(target => AST.findRoot(target) === deep)).toBe(false)
      Expect(next.signature).toBe(before.signature)
      await FS.writeText(paths['Library.tao'], 'use Other from ./Other\npublic let Value = Other')
      const redirected = await Parser.parse(context, URI.file(paths['Main.tao']))
      const redirectedLibrary = redirected.files.find(file => file.path === paths['Library.tao'])!.ast
      const redirectedInputs = Parser.validationDependencies(redirectedLibrary)!
      Expect(redirectedInputs.files.map(file => FS.basename(AST.getDocument(file).uri.path))).toContain('Other.tao')
      Expect(redirectedInputs.signature).not.toBe(next.signature)
    })
  })

  Test('captures folder addition, shadowing, deletion, and unresolved recovery', async () => {
    await withTaoFiles('tao-validation-folder-', {
      'Main.tao': 'let Value = "local"\nlet Selected = Value',
    }, async (paths, root) => {
      const context = await fixtureContext(root)
      const first = await Parser.parse(context, URI.file(paths['Main.tao']))
      const main = first.entry.ast
      const before = Parser.validationDependencies(main)!
      const local = main.statements.find(AST.isAliasDeclaration)!
      expectIdentities(before.files, [main])
      expectIdentities(before.targets, [local])
      const siblingPath = FS.resolvePath('Sibling.tao', root)
      await FS.writeText(siblingPath, 'folder let Value = "folder"')
      const added = await Parser.parse(context, URI.file(paths['Main.tao']))
      const sibling = added.files.find(file => file.path === siblingPath)!.ast
      const shadowed = Parser.validationDependencies(main)!
      Expect(added.entry.ast).toBe(main)
      expectIdentities(shadowed.files, [main, sibling])
      expectIdentities(shadowed.targets, [sibling.statements.find(AST.isAliasDeclaration)!])
      Expect(shadowed.signature).not.toBe(before.signature)
      await FS.remove(siblingPath)
      await Parser.parse(context, URI.file(paths['Main.tao']))
      const recovered = Parser.validationDependencies(main)!
      expectIdentities(recovered.files, [main])
      expectIdentities(recovered.targets, [local])
      Expect(recovered.signature).toBe(before.signature)
      await FS.writeText(paths['Main.tao'], 'let Selected = Missing')
      const unresolved = await Parser.parse(context, URI.file(paths['Main.tao']))
      Expect(Parser.validationDependencies(unresolved.entry.ast)).toBeUndefined()
      await FS.writeText(siblingPath, 'folder let Missing = "recovered"')
      const resolved = await Parser.parse(context, URI.file(paths['Main.tao']))
      Expect(Parser.validationDependencies(resolved.entry.ast)).toBeDefined()
    })
  })

  Test('records empty wildcard membership, additions, exports, removals, and recovery', async () => {
    await withTaoFiles('tao-validation-wildcard-', {
      'Main.tao': 'use all from ./Library\nview Main() { }',
      'Library/Empty.tao': '// no declarations',
    }, async (paths, root) => {
      const context = await fixtureContext(root)
      const first = await Parser.parse(context, URI.file(paths['Main.tao']))
      const main = first.entry.ast
      const before = Parser.validationDependencies(main)!
      Expect(before).toBeDefined()
      const extraPath = FS.resolvePath('Library/Extra.tao', root)
      await FS.writeText(extraPath, 'let Private = "one"')
      await Parser.parse(context, URI.file(paths['Main.tao']))
      const privateInputs = Parser.validationDependencies(main)!
      Expect(privateInputs.files.map(file => FS.basename(AST.getDocument(file).uri.path))).toEqual([
        'Empty.tao',
        'Extra.tao',
        'Main.tao',
      ])
      Expect(privateInputs.signature).not.toBe(before.signature)
      await FS.writeText(extraPath, 'public let Exported = "one"')
      await Parser.parse(context, URI.file(paths['Main.tao']))
      const exported = Parser.validationDependencies(main)!
      Expect(exported.signature).not.toBe(privateInputs.signature)
      await FS.remove(extraPath)
      await Parser.parse(context, URI.file(paths['Main.tao']))
      Expect(Parser.validationDependencies(main)!.signature).toBe(before.signature)
      await FS.remove(paths['Library/Empty.tao'])
      await Parser.parse(context, URI.file(paths['Main.tao']))
      const empty = Parser.validationDependencies(main)!
      expectIdentities(empty.files, [main])
      Expect(empty.signature).not.toBe(before.signature)
      await FS.writeText(paths['Library/Empty.tao'], '// no declarations')
      await Parser.parse(context, URI.file(paths['Main.tao']))
      Expect(Parser.validationDependencies(main)!.signature).toBe(before.signature)
    })
  })

  Test('keeps unchanged standard-library inputs independent of a user literal edit', async () => {
    await withTaoFiles('tao-validation-stdlib-', {
      'app/Main.tao': 'use Card from @tao/ui\nview Main() { render Card() }',
      'app/HNDesign.tao': 'public let Padding = 4',
      'stdlib/@tao/ui/Views.tao': 'public view Card() { }',
      'stdlib/@tao/Prelude.tao': 'primitive text',
    }, async (paths, root) => {
      const appRoot = FS.resolvePath('app', root)
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', appRoot), '')
      const context = await fixtureContext(appRoot, FS.resolvePath('stdlib', root))
      const first = await Parser.parse(context, URI.file(paths['app/Main.tao']))
      const library = first.files.find(file => file.path === paths['stdlib/@tao/ui/Views.tao'])!.ast
      const before = Parser.validationDependencies(library)!
      Expect(before.files.map(file => FS.basename(AST.getDocument(file).uri.path))).toEqual([
        'Prelude.tao',
        'Views.tao',
      ])
      await FS.writeText(paths['app/HNDesign.tao'], 'public let Padding = 8')
      const after = await Parser.parse(context, URI.file(paths['app/Main.tao']))
      const next = Parser.validationDependencies(library)!
      Expect(after.files.find(file => file.path === paths['stdlib/@tao/ui/Views.tao'])!.ast).toBe(library)
      Expect(next.files.every((file, index) => file === before.files[index])).toBe(true)
      expectIdentities(next.targets, before.targets)
      Expect(next.signature).toBe(before.signature)
      await FS.writeText(paths['app/HNDesign.tao'], 'primitive text')
      await Parser.parse(context, URI.file(paths['app/Main.tao']))
      const primitive = Parser.validationDependencies(library)!
      Expect(primitive.files.map(file => FS.basename(AST.getDocument(file).uri.path))).toContain('HNDesign.tao')
      Expect(primitive.signature).not.toBe(before.signature)
    })
  })

  Test(
    'withholds external requirement inputs when its ownership marker disappears and recovers on restore',
    async () => {
      await withTaoFiles('tao-validation-external-marker-', externalRequirementFiles(), async (_paths, root) => {
        const consumerRoot = FS.resolvePath('Consumer', root)
        const consumerMain = FS.resolvePath('Main.tao', consumerRoot)
        const context = await fixtureContext(consumerRoot)
        const first = await Parser.parse(context, URI.file(consumerMain))
        Expect(first.diagnostics).toEqual([])
        const main = first.entry.ast
        const before = Parser.validationDependencies(main)!
        Expect(before).toBeDefined()
        Expect(before.files.map(file => FS.relativePath(root, AST.getDocument(file).uri.path))).toEqual([
          'Consumer/Main.tao',
          'Library/@ui/Labels.tao',
          'Library/Package.tao',
        ])
        const marker = FS.resolvePath('Library/.tao', root)
        await FS.remove(marker)
        const absent = await Parser.parse(context, URI.file(consumerMain))
        Expect(absent.entry.ast === main).toBe(true)
        Expect(Parser.validationDependencies(main)).toBeUndefined()
        await FS.writeText(FS.resolvePath('.gitkeep', marker), '')
        const restored = await Parser.parse(context, URI.file(consumerMain))
        Expect(restored.entry.ast === main).toBe(true)
        Expect(restored.diagnostics).toEqual([])
        const recovered = Parser.validationDependencies(main)!
        Expect(recovered).toBeDefined()
        Expect(recovered.signature).toBe(before.signature)
        Expect(recovered.files.map(file => FS.relativePath(root, AST.getDocument(file).uri.path)))
          .toEqual(['Consumer/Main.tao', 'Library/@ui/Labels.tao', 'Library/Package.tao'])
      })
    },
  )

  Test(
    'changes an external ownership signature when its marker retargets with identical AST and target vectors',
    async () => {
      await withTaoFiles('tao-validation-external-physical-', {
        ...externalRequirementFiles(),
        'Markers/First/.gitkeep': '',
        'Markers/Second/.gitkeep': '',
      }, async (_paths, root) => {
        const marker = FS.resolvePath('Library/.tao', root)
        await FS.remove(marker)
        await FS.symlink(FS.resolvePath('Markers/First', root), marker)
        const consumerRoot = FS.resolvePath('Consumer', root)
        const consumerMain = FS.resolvePath('Main.tao', consumerRoot)
        const context = await fixtureContext(consumerRoot)
        const first = await Parser.parse(context, URI.file(consumerMain))
        Expect(first.diagnostics).toEqual([])
        const main = first.entry.ast
        const before = Parser.validationDependencies(main)!
        Expect(before).toBeDefined()
        await FS.remove(marker)
        await FS.symlink(FS.resolvePath('Markers/Second', root), marker)
        const retargeted = await Parser.parse(context, URI.file(consumerMain))
        Expect(retargeted.entry.ast === main).toBe(true)
        Expect(retargeted.diagnostics).toEqual([])
        const changed = Parser.validationDependencies(main)!
        expectIdentities(changed.files, before.files)
        expectIdentities(changed.targets, before.targets)
        Expect(changed.signature).not.toBe(before.signature)
        await FS.remove(marker)
        await FS.symlink(FS.resolvePath('Markers/First', root), marker)
        await Parser.parse(context, URI.file(consumerMain))
        const restored = Parser.validationDependencies(main)!
        expectIdentities(restored.files, before.files)
        expectIdentities(restored.targets, before.targets)
        Expect(restored.signature).toBe(before.signature)
      })
    },
  )

  Test('refreshes exact mounted color targets and matches cold targets after source overlay recovery', async () => {
    await withTaoFiles('tao-validation-mounted-color-', {
      'Main.tao': `use StackNav from @tao/nav
        use Home from @ui
        app Demo { id "com.tao.incremental" version "1.0.0" name "Demo"
          Navigator StackNav { Initial Home } Design Theme }
        design Theme { colors { paper #fff } }`,
      '@ui/Home.tao': `public view Home() { render Badge(Tint: paper) }
        view Badge(Tint color) { render inject \`\`\`ts return null \`\`\` }`,
    }, async (paths, root) => {
      const workspace = await Workspace.open(root)
      const first = await workspace.validate(paths['Main.tao'])
      const coldFirst = await (await Workspace.open(root)).validate(paths['Main.tao'])
      Expect(first.diagnostics).toEqual([])
      Expect(coldFirst.diagnostics).toEqual([])
      const referenceTarget = (files: typeof first.files): AST.Node | undefined => {
        const reference = AST.streamAllContents(files.find(file => file.path === paths['@ui/Home.tao'])!.ast)
          .filter(AST.isValueReference).find(value => value.target.$refText === 'paper')
        return reference?.target.ref
      }
      const firstTarget = referenceTarget(first.files)
      Expect(firstTarget?.$type).toBe('DesignColorEntry')
      Expect.Is(firstTarget, AST.isDesignColorEntry)
      Expect.Is(firstTarget.value, AST.isDesignColorAtom)
      Expect(firstTarget.value.literal).toBe('#fff')
      const coldFirstTarget = referenceTarget(coldFirst.files)
      Expect(coldFirstTarget?.$type).toBe('DesignColorEntry')
      Expect.Is(coldFirstTarget, AST.isDesignColorEntry)
      Expect.Is(coldFirstTarget.value, AST.isDesignColorAtom)
      Expect(coldFirstTarget.value.literal).toBe('#fff')
      const consumer = first.files.find(file => file.path === paths['@ui/Home.tao'])!.ast
      const before = Parser.validationDependencies(consumer)!
      Expect(before).toBeDefined()
      Expect(before.targets.includes(firstTarget)).toBe(true)
      const replacement = (await FS.readText(paths['Main.tao'])).replace('paper #fff', 'other #000')
      await workspace.setSourceOverrides({ [paths['Main.tao']]: replacement })
      const missing = await workspace.validate(paths['Main.tao'])
      Expect(referenceTarget(missing.files)).toBeUndefined()
      Expect(Parser.validationDependencies(consumer)).toBeUndefined()
      await workspace.setSourceOverrides({})
      const restored = await workspace.validate(paths['Main.tao'])
      const coldRestored = await (await Workspace.open(root)).validate(paths['Main.tao'])
      Expect(restored.diagnostics).toEqual(coldRestored.diagnostics)
      Expect(restored.diagnostics).toEqual([])
      const restoredTarget = referenceTarget(restored.files)
      Expect(restoredTarget?.$type).toBe('DesignColorEntry')
      Expect.Is(restoredTarget, AST.isDesignColorEntry)
      Expect.Is(restoredTarget.value, AST.isDesignColorAtom)
      Expect(restoredTarget.value.literal).toBe('#fff')
      const coldRestoredTarget = referenceTarget(coldRestored.files)
      Expect(coldRestoredTarget?.$type).toBe('DesignColorEntry')
      Expect.Is(coldRestoredTarget, AST.isDesignColorEntry)
      Expect.Is(coldRestoredTarget.value, AST.isDesignColorAtom)
      Expect(coldRestoredTarget.value.literal).toBe('#fff')
      Expect(restored.files.find(file => file.path === paths['@ui/Home.tao'])!.ast === consumer).toBe(true)
      const design = restored.entry.ast.statements.find(AST.isDesignDeclaration)!
      const color = AST.designColorsOf(design).find(candidate => candidate.name === 'paper')!
      Expect(referenceTarget(restored.files) === color).toBe(true)
      const recovered = Parser.validationDependencies(consumer)!
      Expect(recovered.targets.includes(color)).toBe(true)
      Expect(recovered.targets.includes(firstTarget)).toBe(false)
    })
  })

  Test('records external root candidates without loading unrelated library sources', async () => {
    await withTaoFiles('tao-validation-root-reachability-', {
      'Consumer/.tao/.gitkeep': '',
      'Consumer/Main.tao': 'use Shared from @tao/module\nlet Selected = Shared',
      'Library/.tao/.gitkeep': '',
      'Library/@tao/module/Shared.tao': 'public let Shared = "library"',
      'Library/rootBad.tao': 'let Bad = Missing',
    }, async (paths, root) => {
      const context = await fixtureContext(FS.resolvePath('Consumer', root), FS.resolvePath('Library', root))
      const first = await Parser.parse(context, URI.file(paths['Consumer/Main.tao']!))
      Expect(first.diagnostics).toEqual([])
      Expect(first.files.map(file => FS.relativePath(root, file.path)))
        .toEqual(['Consumer/Main.tao', 'Library/@tao/module/Shared.tao'])
      const shared = first.files.find(file => file.path === paths['Library/@tao/module/Shared.tao'])!.ast
      // Root paths are observed without making their unloaded ASTs eligible for local reports.
      const before = Parser.validationDependencies(first.entry.ast)!
      Expect(before).toBeDefined()
      expectIdentities(before.files, [first.entry.ast, shared])
      Expect(Parser.validationDependencies(shared)).toBeDefined()
      const warm = await Parser.parse(context, URI.file(paths['Consumer/Main.tao']!))
      Expect(warm.diagnostics).toEqual([])
      Expect(warm.files.map(file => FS.relativePath(root, file.path)))
        .toEqual(['Consumer/Main.tao', 'Library/@tao/module/Shared.tao'])
      Expect(warm.entry.ast === first.entry.ast).toBe(true)
      Expect(warm.files.find(file => file.path === paths['Library/@tao/module/Shared.tao'])!.ast === shared).toBe(true)
      const warmed = Parser.validationDependencies(warm.entry.ast)!
      Expect(warmed.signature).toBe(before.signature)
      await FS.writeText(FS.resolvePath('Library/AnotherBad.tao', root), 'let Other = StillMissing')
      const membershipChanged = await Parser.parse(context, URI.file(paths['Consumer/Main.tao']!))
      Expect(membershipChanged.diagnostics).toEqual([])
      Expect(membershipChanged.files.map(file => FS.relativePath(root, file.path)))
        .toEqual(['Consumer/Main.tao', 'Library/@tao/module/Shared.tao'])
      const changed = Parser.validationDependencies(membershipChanged.entry.ast)!
      expectIdentities(changed.files, before.files)
      expectIdentities(changed.targets, before.targets)
      Expect(changed.signature).not.toBe(before.signature)
    })
  })

  Test('withholds snapshots after direct editor builds, syntax errors, and failed dependencies', async () => {
    const context = Parser.createContext()
    const parsed = await Parser.parseSource(context, 'view Main() { }')
    Expect(Parser.validationDependencies(parsed.entry.ast)).toBeDefined()
    await context.services.shared.workspace.DocumentBuilder.build([parsed.entry.document], { eagerLinking: true })
    Expect(Parser.validationDependencies(parsed.entry.ast)).toBeUndefined()
    const syntax = await Parser.parseSource(context, 'view Main() {')
    Expect(Parser.validationDependencies(syntax.entry.ast)).toBeUndefined()
    const syntaxOnly = Parser.parseSyntax('view Main() { }')
    Expect(Parser.validationDependencies(syntaxOnly.ast)).toBeUndefined()
    await withTaoFiles('tao-validation-incomplete-', {
      'Main.tao': 'use Value from ./Library\nlet Selected = Value',
      'Library.tao': 'public let Value = Missing',
    }, async (paths, root) => {
      const parser = await fixtureContext(root)
      const failed = await Parser.parse(parser, URI.file(paths['Main.tao']))
      Expect(Parser.validationDependencies(failed.entry.ast)).toBeUndefined()
      await FS.writeText(paths['Library.tao'], 'public let Value = "recovered"')
      const recovered = await Parser.parse(parser, URI.file(paths['Main.tao']))
      Expect(Parser.validationDependencies(recovered.entry.ast)).toBeDefined()
    })
  })
})

async function fixtureContext(
  root: string,
  stdlibRoot = FS.resolvePath('absent-stdlib', root),
): Promise<Parser.Context> {
  return Parser.createContext({ packages: Packages.createResolver(await Packages.createContext(root, { stdlibRoot })) })
}

function expectIdentities(actual: readonly AST.Node[], expected: readonly AST.Node[]): void {
  Expect(actual).toHaveLength(expected.length)
  actual.forEach((node, index) => Expect(node === expected[index]).toBe(true))
}

function externalRequirementFiles(): Record<string, string> {
  return {
    'Consumer/.tao/.gitkeep': '',
    'Consumer/Main.tao': `package {
      version 1.0.0
      includes @app
      requires "Library" from ../Library version ^1.0.0 { @ui as @widgets }
    }
    use Label from @widgets
    let Selected = Label`,
    'Library/.tao/.gitkeep': '',
    'Library/Package.tao': 'package { name "Library" version 1.0.0 includes @ui }',
    'Library/@ui/Labels.tao': 'public let Label = "library"',
  }
}
