import { Langium } from './langium-exports'
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
    const document = await services.shared.workspace.LangiumDocumentFactory.fromUri<AST.TaoFile>(Langium.URI.file(path))
    return await buildDocument(services, document)
  },

  /** parseCode parses Tao source code into a Langium AST document. */
  async parseCode(code: string, opts: ParseOptions = {}): Promise<ParseResult> {
    const services = createServices()
    const uri = opts.uri ?? Langium.URI.file('/__tao__/source.tao')
    const document = services.shared.workspace.LangiumDocumentFactory.fromString<AST.TaoFile>(code, uri)
    return await buildDocument(services, document)
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

async function buildDocument(services: Services, document: AST.Document): Promise<ParseResult> {
  services.shared.workspace.LangiumDocuments.addDocument(document)
  await services.shared.workspace.DocumentBuilder.build([document], {
    eagerLinking: true,
    validation: true,
  })

  return {
    ast: document.parseResult.value,
    diagnostics: document.diagnostics ?? [],
    document,
  }
}
