import { Packages } from '@ast-utils'
import { AST, Langium, Parser } from '@parser'
import { FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'

Describe('parser document reuse', () => {
  Test('reads each source once and reparses only an edited imported file', async () => {
    await withTaoFiles('tao-parser-reuse-', {
      'Main.tao': 'use Shared from ./library/Shared\nlet Result = Shared',
      'library/Shared.tao': 'public let Shared = "before"',
    }, async (paths, root) => {
      const reads = new Map<string, number>()
      const context = Parser.createContext({
        packages: Packages.createResolver(await Packages.createContext(root)),
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
      })
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
    const complete = 'func Echo(Value text) -> text { return Value }\nlet Result = Echo("ready")'
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
