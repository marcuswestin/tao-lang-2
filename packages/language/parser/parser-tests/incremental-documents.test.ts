import { Packages } from '@ast-utils'
import { AST, Langium, Parser } from '@parser'
import { Assert, FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'

Describe('parser document reuse', () => {
  Test('matches a cold parse when an imported dependency changes through an equivalent path', async () => {
    await withTaoFiles('tao-parser-reuse-changed-dependency-', {
      'Main.tao': 'use Shared from ./library/Shared\nlet Result = Shared',
      'library/Shared.tao': 'public let Shared = "before"',
    }, async (paths, root) => {
      const reads = new Map<string, number>()
      const context = await createParserContext(root, reads)
      const uri = Langium.URI.file(paths['Main.tao'])
      const before = await Parser.parseEntries(context, [uri], { validation: false })
      Expect(before[0]?.diagnostics).toEqual([])

      await FS.writeText(paths['library/Shared.tao'], 'public let Shared = "after"')
      reads.clear()
      const equivalentChangedPath = `${root}/library/../library/Shared.tao`
      const [after] = await Parser.parseEntries(context, [uri], {
        validation: false,
        experimentalChangedPaths: [equivalentChangedPath],
      })
      Assert.defined(after, 'The retained parse returns its entry.')
      Expect(reads.get(paths['Main.tao'])).toBeUndefined()
      await expectColdParity(after, root, [uri])
      Expect(reads.get(paths['library/Shared.tao'])).toBe(1)
      const shared = after.files.find(file => file.path === paths['library/Shared.tao'])
      Assert.defined(shared, 'The changed imported source remains in the parse result.')
      Expect(shared.document.textDocument.getText()).toBe('public let Shared = "after"')
      const result = after.entry.ast.statements.find(AST.isAliasDeclaration)
      Expect.Is(result, AST.isAliasDeclaration)
      Expect.Is(result.value, AST.isValueReference)
      Expect.Is(result.value.target.ref, AST.isAliasDeclaration)
      Expect(result.value.target.ref.name).toBe('Shared')
    })
  })

  Test('matches a cold parse when imports are added and removed', async () => {
    await withTaoFiles('tao-parser-reuse-import-edges-', {
      'Main.tao': 'let Result = "before"',
      'library/Added.tao': 'public let Added = "present"',
    }, async (paths, root) => {
      const context = await createParserContext(root)
      const uri = Langium.URI.file(paths['Main.tao'])
      await Parser.parseEntries(context, [uri], { validation: false })

      await FS.writeText(paths['Main.tao'], 'use Added from ./library/Added\nlet Result = Added')
      const [added] = await Parser.parseEntries(context, [uri], {
        validation: false,
        experimentalChangedPaths: [paths['Main.tao']],
      })
      Assert.defined(added, 'The parse returns its entry after adding an import.')
      await expectColdParity(added, root, [uri])
      Expect(added.files.map(file => file.path)).toContain(paths['library/Added.tao'])
      const result = added.entry.ast.statements.find(AST.isAliasDeclaration)
      Expect.Is(result, AST.isAliasDeclaration)
      Expect.Is(result.value, AST.isValueReference)
      Expect.Is(result.value.target.ref, AST.isAliasDeclaration)
      Expect(result.value.target.ref.name).toBe('Added')

      await FS.writeText(paths['Main.tao'], 'let Result = "removed"')
      const [removed] = await Parser.parseEntries(context, [uri], {
        validation: false,
        experimentalChangedPaths: [paths['Main.tao']],
      })
      Assert.defined(removed, 'The parse returns its entry after removing an import.')
      await expectColdParity(removed, root, [uri])
      Expect(removed.files.map(file => file.path)).not.toContain(paths['library/Added.tao'])
    })
  })

  Test('matches a cold parse through an edit and revert of a retained source', async () => {
    await withTaoFiles('tao-parser-reuse-edit-revert-', {
      'Main.tao': 'public let Value = "before"',
    }, async (paths, root) => {
      const context = await createParserContext(root)
      const uri = Langium.URI.file(paths['Main.tao'])
      await Parser.parseEntries(context, [uri], { validation: false })

      for (const source of ['public let Value = "after"', 'public let Value = "before"']) {
        await FS.writeText(paths['Main.tao'], source)
        const [result] = await Parser.parseEntries(context, [uri], {
          validation: false,
          experimentalChangedPaths: [paths['Main.tao']],
        })
        Assert.defined(result, 'The parse returns its entry for each source edit.')
        await expectColdParity(result, root, [uri])
        Expect(result.entry.document.textDocument.getText()).toBe(source)
      }
    })
  })

  Test('preserves source overrides while reusing retained documents', async () => {
    await withTaoFiles('tao-parser-reuse-source-override-', {
      'Main.tao': 'use Shared from ./library/Shared\nlet Result = Shared',
      'library/Shared.tao': 'public let Shared = "disk"',
    }, async (paths, root) => {
      const context = await createParserContext(root)
      context.services.sourceOverrides = { [paths['library/Shared.tao']]: 'public let Shared = "override one"' }
      const uri = Langium.URI.file(paths['Main.tao'])
      await Parser.parseEntries(context, [uri], { validation: false })

      context.services.sourceOverrides = { [paths['library/Shared.tao']]: 'public let Shared = "override two"' }
      const [result] = await Parser.parseEntries(context, [uri], {
        validation: false,
        experimentalChangedPaths: [paths['Main.tao']],
      })
      Assert.defined(result, 'The parse returns its entry after updating a source override.')
      await expectColdParity(result, root, [uri], context.services.sourceOverrides)
      const shared = result.files.find(file => file.path === paths['library/Shared.tao'])
      Assert.defined(shared, 'The imported source remains in the parse result.')
      Expect(shared.document.textDocument.getText()).toBe('public let Shared = "override two"')
    })
  })

  Test('reads newly imported documents even when the changed path set names only the importer', async () => {
    await withTaoFiles('tao-parser-reuse-new-document-', {
      'Main.tao': 'let Result = "before"',
      'library/Added.tao': 'public let Added = "new"',
    }, async (paths, root) => {
      const reads = new Map<string, number>()
      const context = await createParserContext(root, reads)
      const uri = Langium.URI.file(paths['Main.tao'])
      const addedPath = FS.resolvePath('library/Added.tao', root)
      await Parser.parseEntries(context, [uri], { validation: false })

      await FS.remove(addedPath)
      await FS.writeText(addedPath, 'public let Added = "new"')
      await FS.writeText(paths['Main.tao'], 'use Added from ./library/Added\nlet Result = Added')
      reads.clear()
      const [result] = await Parser.parseEntries(context, [uri], {
        validation: false,
        experimentalChangedPaths: [paths['Main.tao']],
      })
      Assert.defined(result, 'The parse returns its entry after adding a new file.')
      Expect(reads.get(addedPath)).toBe(1)
      await expectColdParity(result, root, [uri])
      Expect(result.files.map(file => file.path)).toContain(addedPath)
    })
  })

  Test('falls back to source reads when relinking retained documents', async () => {
    await withTaoFiles('tao-parser-reuse-relink-', {
      'Main.tao': 'use Shared from ./library/Shared\nlet Result = Shared',
      'library/Shared.tao': 'public let Shared = "same"',
    }, async (paths, root) => {
      const reads = new Map<string, number>()
      const context = await createParserContext(root, reads)
      const uri = Langium.URI.file(paths['Main.tao'])
      await Parser.parseEntries(context, [uri], { validation: false })
      reads.clear()

      const [result] = await Parser.parseEntries(context, [uri], {
        validation: false,
        relink: true,
        experimentalChangedPaths: [paths['Main.tao']],
      })
      Assert.defined(result, 'The parse returns its entry after relinking.')
      await expectColdParity(result, root, [uri])
      Expect(reads.get(paths['library/Shared.tao'])).toBe(1)
    })
  })

  Test('reads each source once and reparses only an edited imported file', async () => {
    await withTaoFiles('tao-parser-reuse-', {
      'Main.tao': 'use Shared from ./library/Shared\nlet Result = Shared',
      'library/Shared.tao': 'public let Shared = "before"',
    }, async (paths, root) => {
      const reads = new Map<string, number>()
      const context = await createParserContext(root, reads)
      const parser = context.services.language.parser.LangiumParser
      const parse = parser.parse.bind(parser)
      let parses = 0
      parser.parse = (source, options) => {
        parses++
        return parse(source, options)
      }
      const asyncParser = context.services.language.parser.AsyncParser
      const parseAsync = asyncParser.parse.bind(asyncParser)
      let updateParses = 0
      asyncParser.parse = (source, cancelToken) => {
        updateParses++
        return parseAsync(source, cancelToken)
      }
      const uri = Langium.URI.file(paths['Main.tao'])
      const before = await Parser.parse(context, uri, { validation: false })
      Expect(before.diagnostics).toEqual([])
      Expect(parses).toBeGreaterThan(1)
      Expect(updateParses).toBe(0)
      const sharedBefore = before.files.find(file => file.path === paths['library/Shared.tao'])!
      Expect(sharedBefore !== undefined).toBe(true)
      parses = 0
      reads.clear()

      const unchanged = await Parser.parse(context, uri, { validation: false })
      Expect(parses).toBe(0)
      Expect(unchanged.entry.document === before.entry.document).toBe(true)
      Expect(reads.get(paths['Main.tao'])).toBe(1)
      Expect(reads.get(paths['library/Shared.tao'])).toBe(1)

      await FS.writeText(paths['library/Shared.tao'], 'public let Shared = "after"')
      reads.clear()
      const after = await Parser.parse(context, uri, { validation: false })
      Expect(parses).toBe(1)
      Expect(updateParses).toBe(0)
      Expect(reads.get(paths['library/Shared.tao'])).toBe(1)
      Expect(after.entry.document === before.entry.document).toBe(true)
      Expect(after.diagnostics).toEqual([])
      const sharedAfter = after.files.find(file => file.path === paths['library/Shared.tao'])!
      const result = after.entry.ast.statements.find(AST.isAliasDeclaration)
      Expect.Is(result, AST.isAliasDeclaration)
      Expect.Is(result.value, AST.isValueReference)
      Expect(result.value.target.ref === sharedAfter.ast.statements.find(AST.isAliasDeclaration)).toBe(true)
      Expect(result.value.target.ref === sharedBefore.ast.statements.find(AST.isAliasDeclaration)).toBe(false)
      for (const file of after.files) {
        Expect(context.services.shared.workspace.LangiumDocuments.getDocument(file.document.uri) === file.document)
          .toBe(true)
      }
    })
  })

  Test('recovers an unclosed call and returns current diagnostics across same-source reverts', async () => {
    const context = Parser.createContext()
    const complete = 'function Echo(Value text) returns text { return Value }\nlet Result = Echo("ready")'
    const before = await Parser.parseSource(context, complete)
    Expect(before.diagnostics).toEqual([])
    const incomplete = complete.slice(0, -1)
    const broken = await Parser.parseSource(context, incomplete)
    const coldBroken = await Parser.parseCode(incomplete)
    Expect(broken.diagnostics).toEqual(coldBroken.diagnostics)
    Expect(broken.diagnostics.length).toBeGreaterThan(0)
    const recovered = await Parser.parseSource(context, complete)
    Expect(recovered.diagnostics).toEqual([])
    const unchanged = await Parser.parseSource(context, complete)
    Expect(unchanged.entry.document === recovered.entry.document).toBe(true)
    Expect(unchanged.entry.ast === recovered.entry.ast).toBe(true)
  })

  Test('runs validation again on retained documents when requested', async () => {
    const context = Parser.createContext()
    let validations = 0
    context.services.language.validation.ValidationRegistry.register<AST.TaoLangAstType>({
      TaoFile: () => {
        validations++
      },
    })
    await Parser.parseSource(context, 'let Value = "same"', { validation: false })
    Expect(validations).toBe(0)
    const validated = await Parser.parseSource(context, 'let Value = "same"')
    Expect(validations).toBe(1)
    const repeated = await Parser.parseSource(context, 'let Value = "same"')
    Expect(validations).toBe(2)
    Expect(repeated.entry.document === validated.entry.document).toBe(true)
  })

  Test('refreshes host-invalidated scopes without reparsing identical source', async () => {
    const context = Parser.createContext()
    const before = await Parser.parseSource(context, 'let Value = "same"', { validation: false })
    let parsedUpdates = 0
    context.services.shared.workspace.DocumentBuilder.onBuildPhase(Langium.DocumentState.Parsed, documents => {
      parsedUpdates += documents.length
    })
    const parser = context.services.language.parser.LangiumParser
    const parse = parser.parse.bind(parser)
    let parses = 0
    parser.parse = (source, options) => {
      parses++
      return parse(source, options)
    }
    const after = await Parser.parseSource(context, 'let Value = "same"', { validation: false, relink: true })
    Expect(parses).toBe(0)
    Expect(parsedUpdates).toBe(1)
    Expect(after.entry.document === before.entry.document).toBe(true)
    Expect(after.diagnostics).toEqual([])
  })

  Test('does not use a retained document after its file disappears', async () => {
    await withTaoFiles('tao-parser-reuse-missing-', { 'Main.tao': 'let Value = "disk"' }, async paths => {
      const context = Parser.createContext()
      const uri = Langium.URI.file(paths['Main.tao'])
      Expect((await Parser.parse(context, uri)).diagnostics).toEqual([])
      await FS.remove(paths['Main.tao'])
      await Expect(Parser.parse(context, uri)).rejects.toThrow('ENOENT')
    })
  })

  Test('forgets implicit visibility when only a folder sibling is deleted', async () => {
    await withTaoFiles('tao-parser-reuse-folder-delete-', {
      'Main.tao': 'let Result = Shared',
      'Sibling.tao': 'folder let Shared = "sibling"',
    }, async paths => {
      const context = Parser.createContext()
      const uri = Langium.URI.file(paths['Main.tao'])
      const before = await Parser.parse(context, uri, { validation: false })
      Expect(before.diagnostics).toEqual([])
      Expect(AST.visibleValueDeclarations(before.entry.ast, AST.isDeclaration).map(declaration => declaration.name))
        .toContain('Shared')
      await FS.remove(paths['Sibling.tao'])
      const deleted = await Parser.parse(context, uri, { validation: false })
      const cold = await Parser.parse(Parser.createContext(), uri, { validation: false })
      Expect(deleted.diagnostics).toEqual(cold.diagnostics)
      Expect(deleted.diagnostics.map(diagnostic => diagnostic.message).join('\n')).toContain('Shared')
      Expect(AST.visibleValueDeclarations(deleted.entry.ast, AST.isDeclaration).map(declaration => declaration.name))
        .not.toContain('Shared')
      Expect(deleted.entry.document === before.entry.document).toBe(true)
    })
  })
})

async function createParserContext(root: string, reads?: Map<string, number>) {
  const context = Parser.createContext({
    packages: Packages.createResolver(await Packages.createContext(root)),
    ...(reads === undefined ? {} : {
      langiumContext: {
        fileSystemProvider: () => {
          const provider = new Langium.NodeFileSystemProvider()
          const read = provider.readFile.bind(provider)
          provider.readFile = uri => {
            reads.set(uri.path, (reads.get(uri.path) ?? 0) + 1)
            return read(uri)
          }
          return provider
        },
      },
    }),
  })
  return context
}

async function expectColdParity(
  retained: Awaited<ReturnType<typeof Parser.parseEntries>>[number],
  root: string,
  uris: readonly Langium.URI[],
  sourceOverrides?: Readonly<Record<string, string>>,
): Promise<void> {
  const coldContext = await createParserContext(root)
  coldContext.services.sourceOverrides = sourceOverrides
  const [cold] = await Parser.parseEntries(coldContext, uris, { validation: false })
  Assert.defined(cold, 'A cold parse returns its entry.')
  Expect(retained.diagnostics).toEqual(cold.diagnostics)
  Expect(retained.files.map(file => FS.relativePath(root, file.path))).toEqual(
    cold.files.map(file => FS.relativePath(root, file.path)),
  )
  Expect(retained.files.map(file => file.document.textDocument.getText())).toEqual(
    cold.files.map(file => file.document.textDocument.getText()),
  )
}
