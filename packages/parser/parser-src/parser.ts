import { FS } from '@shared'
import { Langium } from './langium-exports'
import { loadEntryAndReachableDocuments } from './module-resolution'
import * as AST from './parserASTExport'
import { TaoValueScopeProvider } from './value-scope'

export { AST, Langium }

type Services = {
  shared: Langium.LangiumSharedCoreServices
  language: Langium.LangiumCoreServices
}

/** LexResult declares the raw Langium lexer result for Tao source text. */
export type LexResult = ReturnType<Services['language']['parser']['Lexer']['tokenize']>

/** ParseOptions declares optional source metadata for parsing code strings. */
export type ParseOptions = {
  uri?: Langium.URI
}

/** ParseResult declares the parsed AST, diagnostics, and underlying Langium document. */
export type ParseResult = {
  ast: AST.TaoFile
  diagnostics: readonly AST.ParseDiagnostic[]
  document: AST.Document
}

/** Parser exposes lexing and parsing functions for Tao source files and source strings. */
export const Parser = {
  /** lexCode lexes Tao source code and returns Langium tokens, hidden tokens, and lexer errors. */
  lexCode(code: string): LexResult {
    const services = createServices()
    return services.language.parser.Lexer.tokenize(code)
  },

  /** parseFile parses the Tao file at `path` into a Langium AST document. */
  async parseFile(path: string): Promise<ParseResult> {
    const services = createServices()
    const entryPath = FS.resolvePath(path)
    const documents = await loadEntryAndReachableDocuments(services, entryPath)
    const entryDocument = documents.find(document => document.uri.path === entryPath)
    if (!entryDocument) {
      throw new Error(`Expected entry Tao document for ${entryPath}`)
    }
    return await buildDocuments(services, entryDocument, documents)
  },

  /** parseCode parses Tao source code into a Langium AST document. */
  async parseCode(code: string, opts: ParseOptions = {}): Promise<ParseResult> {
    const services = createServices()
    const uri = opts.uri ?? Langium.URI.file('/__tao__/source.tao')
    const document = services.shared.workspace.LangiumDocumentFactory.fromString<AST.TaoFile>(code, uri)
    return await buildDocuments(services, document, [document])
  },
}

function createServices(context: Langium.DefaultSharedCoreModuleContext = Langium.NodeFileSystem): Services {
  const shared = Langium.inject(
    Langium.createDefaultSharedCoreModule(context),
    AST.GeneratedSharedModule,
  )
  const language = Langium.inject(
    Langium.createDefaultCoreModule({ shared }),
    AST.GeneratedModule,
    {
      references: {
        ScopeProvider: (services) => new TaoValueScopeProvider(services),
      },
    },
  )
  shared.ServiceRegistry.register(language)

  return { shared, language }
}

async function buildDocuments(
  services: Services,
  entryDocument: AST.Document,
  documents: AST.Document[],
): Promise<ParseResult> {
  for (const document of documents) {
    services.shared.workspace.LangiumDocuments.addDocument(document)
  }
  await services.shared.workspace.DocumentBuilder.build(documents, {
    eagerLinking: true,
    validation: true,
  })

  return {
    ast: entryDocument.parseResult.value,
    diagnostics: documents.flatMap(document => document.diagnostics ?? []),
    document: entryDocument,
  }
}
