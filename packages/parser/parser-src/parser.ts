import { Assert, type Diagnostic, type DiagnosticRange, Diagnostics, FS } from '@shared'
import { Langium } from './langium-exports'
import { emptyPackageResolver, type PackageResolver } from './package-resolver'
import * as AST from './parserASTExport'
import { TaoTokenBuilder } from './tao-token-builder'
import { TaoValueConverter } from './tao-value-converter'
import { ValueScopeProvider } from './value-scope'

const URI = Langium.URI
const codeSourceUri = Langium.URI.file('/__tao__/source.tao')

export { AST, Langium, URI }
export type URI = Langium.URI
export type { PackageResolver } from './package-resolver'

/** ParserServices declares the Langium services used by the parser stage. */
export type ParserServices = {
  shared: Langium.LangiumSharedCoreServices
  language: Langium.LangiumDefaultCoreServices
}

/** ParserLspServices declares Langium services with LSP support. */
export type ParserLspServices = {
  shared: Langium.LangiumSharedServices
  language: Langium.LangiumServices
}

/** ParserContext declares parser invocation state. */
export type ParserContext<ServicesT extends ParserServices = ParserServices> = {
  packages: PackageResolver
  services: ServicesT
}

/** CreateParserContextOptions configures parser service creation. */
export type CreateParserContextOptions = {
  packages?: PackageResolver
  langiumContext?: Langium.DefaultSharedCoreModuleContext
}

/** CreateParserLspContextOptions configures parser LSP service creation. */
export type CreateParserLspContextOptions = ParserLspContributions & {
  packages?: PackageResolver
  langiumContext?: Langium.DefaultSharedModuleContext
}

/** ParserLspContributions declares optional LSP services supplied by parser hosts. */
export type ParserLspContributions = {
  lspFormatter?: () => Langium.Formatter
  lspCodeActionProvider?: () => Langium.CodeActionProvider
}

/** ParseOptions configures parser document loading and building. */
export type ParseOptions = {
  uri?: URI
  validation?: boolean
}

type LexReport = ReturnType<ParserServices['language']['parser']['Lexer']['tokenize']>

type LexerError = LexReport['errors'][number]
type ParserError = AST.Document['parseResult']['parserErrors'][number]

/** LexResult declares lexer output and diagnostics for Tao source text. */
export type LexResult = {
  diagnostics: readonly Diagnostic[]
  errors: readonly LexerError[]
  tokens: LexReport['tokens']
  hidden: LexReport['hidden']
}

/** ParsedFile declares a Tao source document and its parsed AST. */
export type ParsedFile = {
  path: string
  document: AST.Document
  ast: AST.TaoFile
}

/** ParseResult declares parser output, workspace ASTs, and diagnostics. */
export type ParseResult = {
  entry: ParsedFile
  files: readonly ParsedFile[]
  diagnostics: readonly Diagnostic[]
}

/** Parser exposes lexing and parsing functions for Tao source files and source strings. */
export const Parser = {
  /** createContext creates parser stage services. */
  createContext(options: CreateParserContextOptions = {}): ParserContext {
    const packages = options.packages ?? emptyPackageResolver
    return createParserContext(packages, createServices({ ...options, packages }))
  },

  /** createLspContext creates parser stage services with Langium LSP support. */
  createLspContext(options: CreateParserLspContextOptions = {}): ParserContext<ParserLspServices> {
    const packages = options.packages ?? emptyPackageResolver
    return createParserContext(packages, createLspServices({ ...options, packages }))
  },

  /** createContextFromServices creates parser invocation state from existing parser services. */
  createContextFromServices<ServicesT extends ParserServices>(
    packages: PackageResolver,
    services: ServicesT,
  ): ParserContext<ServicesT> {
    return createParserContext(packages, services)
  },

  /** lexCode lexes Tao source code and returns Langium tokens, hidden tokens, and lexer errors. */
  lexCode(code: string): LexResult {
    return lexResultFromReport(Parser.createContext().services.language.parser.Lexer.tokenize(code))
  },

  /** parse parses one Tao file URI and all reachable Tao documents. */
  async parse(context: ParserContext, uri: URI, options: ParseOptions = {}): Promise<ParseResult> {
    const entryDocument = await context.services.shared.workspace.LangiumDocumentFactory.fromUri<AST.TaoFile>(
      uri,
    )
    const documents = await loadReachableDocuments(context, entryDocument)
    return await buildDocuments(context.services, entryDocument, documents, options)
  },

  /** parseCode parses Tao source code using a standalone parser context. */
  async parseCode(code: string, options: ParseOptions = {}): Promise<ParseResult> {
    return await Parser.parseSource(Parser.createContext(), code, options)
  },

  /** parseSource parses Tao source code using an existing parser context. */
  async parseSource(context: ParserContext, code: string, options: ParseOptions = {}): Promise<ParseResult> {
    const document = context.services.shared.workspace.LangiumDocumentFactory.fromString<AST.TaoFile>(
      code,
      options.uri ?? codeSourceUri,
    )
    const documents = await loadReachableDocuments(context, document)
    return await buildDocuments(context.services, document, documents, options)
  },
}

export namespace Parser {
  /** Context declares parser invocation state. */
  export type Context = ParserContext
}

function createParserContext<ServicesT extends ParserServices>(
  packages: PackageResolver,
  services: ServicesT,
): ParserContext<ServicesT> {
  return {
    packages,
    services,
  }
}

function createServices(options: CreateParserContextOptions & { packages: PackageResolver }): ParserServices {
  const shared = Langium.inject(
    Langium.createDefaultSharedCoreModule(options.langiumContext ?? Langium.NodeFileSystem),
    AST.GeneratedSharedModule,
  )
  const language = Langium.inject(
    Langium.createDefaultCoreModule({ shared }),
    AST.GeneratedModule,
    {
      parser: {
        // Tao deliberately resolves token-identical configured constructors and one-field
        // unlabeled item forms from their linked owner declarations.
        ParserConfig: () => ({ skipValidations: true }),
        TokenBuilder: () => new TaoTokenBuilder(),
        ValueConverter: () => new TaoValueConverter(),
      },
      references: {
        ScopeProvider: (services) => new ValueScopeProvider(services, options.packages),
      },
    },
  )
  shared.ServiceRegistry.register(language)

  return { shared, language }
}

type ParserLspModule = {
  lsp?: {
    Formatter?: () => Langium.Formatter
    CodeActionProvider?: () => Langium.CodeActionProvider
  }
}

function lspModule(options: ParserLspContributions): ParserLspModule {
  const lsp = {
    ...(options.lspFormatter ? { Formatter: options.lspFormatter } : {}),
    ...(options.lspCodeActionProvider ? { CodeActionProvider: options.lspCodeActionProvider } : {}),
  }
  return Object.keys(lsp).length > 0 ? { lsp } : {}
}

function createLspServices(options: CreateParserLspContextOptions & { packages: PackageResolver }): ParserLspServices {
  const shared = Langium.inject(
    Langium.createDefaultSharedModule(options.langiumContext ?? Langium.NodeFileSystem),
    AST.GeneratedSharedModule,
  )
  const language = Langium.inject(
    Langium.createDefaultModule({ shared }),
    AST.GeneratedModule,
    {
      parser: {
        ParserConfig: () => ({ skipValidations: true }),
        TokenBuilder: () => new TaoTokenBuilder(),
        ValueConverter: () => new TaoValueConverter(),
      },
      references: {
        ScopeProvider: (services) => new ValueScopeProvider(services, options.packages),
      },
      ...lspModule(options),
    },
  )
  shared.ServiceRegistry.register(language)

  return { shared, language }
}

async function buildDocuments(
  services: ParserServices,
  entryDocument: AST.Document,
  documents: readonly AST.Document[],
  options: ParseOptions,
): Promise<ParseResult> {
  for (const document of documents) {
    const langiumDocuments = services.shared.workspace.LangiumDocuments
    if (langiumDocuments.hasDocument(document.uri)) {
      langiumDocuments.deleteDocument(document.uri)
    }
    langiumDocuments.addDocument(document)
  }
  await services.shared.workspace.DocumentBuilder.build([...documents], {
    eagerLinking: true,
    validation: options.validation ?? true,
  })

  const files = documents.map(parsedFileFromDocument).filter(isParsedFile)
  const entry = files.find(file => file.path === entryDocument.uri.path)
  Assert.defined(entry, 'entry Tao document exists in parsed files', { entryPath: entryDocument.uri.path })

  return {
    entry,
    files,
    diagnostics: diagnosticsForDocuments(documents),
  }
}

function lexResultFromReport(report: LexReport): LexResult {
  return {
    diagnostics: report.errors.map(error => lexerDiagnostic(error)),
    errors: report.errors,
    tokens: report.tokens,
    hidden: report.hidden,
  }
}

function parsedFileFromDocument(document: AST.Document): ParsedFile | undefined {
  if (document.parseResult.value === undefined) {
    return undefined
  }
  return {
    path: document.uri.path,
    document,
    ast: document.parseResult.value,
  }
}

function diagnosticsForDocuments(documents: readonly AST.Document[]): Diagnostic[] {
  return Diagnostics.unique(documents.flatMap(document => [
    ...document.parseResult.lexerErrors.map(error => lexerDiagnostic(error, document)),
    ...document.parseResult.parserErrors.map(error => parserDiagnostic(error, document)),
    ...document.references
      .filter(reference => reference.error !== undefined)
      .filter(reference => !bridgesToATypeScriptExport(reference))
      .map(reference => referenceDiagnostic(reference, document)),
  ]))
}

function lexerDiagnostic(error: LexerError, document?: AST.Document): Diagnostic {
  return {
    filePath: document?.uri.path,
    message: error.message,
    range: rangeFromLexerError(error),
    severity: 'error',
    source: 'lexer',
  }
}

function parserDiagnostic(error: ParserError, document?: AST.Document): Diagnostic {
  return {
    filePath: document?.uri.path,
    message: error.message,
    range: rangeFromParserError(error),
    severity: 'error',
    source: 'parser',
  }
}

/**
 * The head name of a bridged expression names a TypeScript export (Decisions §15), so it is not
 * expected to resolve in Tao scope and an unresolved reference there is not a linking error. Its
 * arguments are ordinary Tao values and still have to resolve, so only the head is exempt.
 */
function bridgesToATypeScriptExport(reference: AST.Document['references'][number]): boolean {
  const info = reference.error?.info
  const container = info?.container
  if (!container || !AST.isFromExpression(container.$container)) {
    return false
  }
  const bridged = container.$container.expression
  if (AST.isFunctionCallExpression(container)) {
    return container === bridged && info.property === 'function'
  }
  return AST.isValueReference(container) && container === bridged && info.property === 'target'
}

function referenceDiagnostic(reference: AST.Document['references'][number], document: AST.Document): Diagnostic {
  return {
    filePath: document.uri.path,
    message: reference.error!.message,
    severity: 'error',
    source: 'linker',
    range: reference.$refNode?.range,
  }
}

function rangeFromLexerError(error: LexerError): DiagnosticRange | undefined {
  if (error.line === undefined || error.column === undefined) {
    return undefined
  }
  const line = error.line - 1
  const character = error.column - 1
  return {
    start: RangeLocation(line, character),
    end: RangeLocation(line, character + Math.max(error.length, 1)),
  }
}

function rangeFromParserError(error: ParserError): DiagnosticRange | undefined {
  const token = error.token
  if (token.startLine === undefined || token.startColumn === undefined) {
    return undefined
  }
  const endLine = token.endLine ?? token.startLine
  const endColumn = token.endColumn ?? token.startColumn
  return {
    start: RangeLocation(token.startLine - 1, token.startColumn - 1),
    end: RangeLocation(endLine - 1, Math.max(endColumn, token.startColumn)),
  }
}

function RangeLocation(line: number, character: number) {
  return { line, character }
}

function isParsedFile(file: ParsedFile | undefined): file is ParsedFile {
  return file !== undefined
}

async function loadReachableDocuments(context: ParserContext, entryDocument: AST.Document): Promise<AST.Document[]> {
  const documents = new Map<string, AST.Document>()
  // Sibling scans are memoized per directory for this load only; files may change between runs.
  const siblingScans: SiblingScanCache = new Map()
  const intrinsicDocuments = await Promise.all(
    (await context.packages.intrinsicFilePaths()).map(path => documentFromFilePath(context, path)),
  )
  const queue: AST.Document[] = [entryDocument, ...intrinsicDocuments]

  while (queue.length > 0) {
    const document = queue.shift()!
    const currentPath = document.uri.path
    if (documents.has(currentPath)) {
      continue
    }
    documents.set(currentPath, document)
    queue.push(...await loadReferencedDocuments(context, document, documents, siblingScans))
  }

  return [...documents.values()]
}

async function loadReferencedDocuments(
  context: ParserContext,
  document: AST.Document,
  loadedDocuments: ReadonlyMap<string, AST.Document>,
  siblingScans: SiblingScanCache,
): Promise<AST.Document[]> {
  const ast = document.parseResult.value
  if (ast === undefined) {
    return []
  }
  const referencedDocuments: AST.Document[] = []
  // A sibling may carry `folder` declarations this file reaches without naming them in a `use`,
  // so the whole folder is loaded rather than only what the imports point at.
  for (const siblingPath of await siblingTaoFilePaths(document.uri.path, siblingScans)) {
    if (!loadedDocuments.has(siblingPath)) {
      referencedDocuments.push(await documentFromFilePath(context, siblingPath))
    }
  }
  const importingStatements = ast.statements.filter(statement =>
    AST.isUseStatement(statement) || AST.isUsePackageStatement(statement)
  )
  for (const useStatement of importingStatements) {
    const candidatePaths = await context.packages.candidateFilePaths(useStatement, {
      fromFilePath: document.uri.path,
    })
    for (const candidatePath of candidatePaths) {
      if (!loadedDocuments.has(candidatePath)) {
        referencedDocuments.push(await documentFromFilePath(context, candidatePath))
      }
    }
  }
  return referencedDocuments
}

// Only a sibling that actually declares something `folder`-visible is pulled in, so a project that
// does not use the marker keeps exactly the document set its `use` statements describe.
const folderDeclarationPattern = /^[ \t]*folder[ \t\r\n]/m

/** SiblingScanCache memoizes one load's per-directory folder-sibling scans. */
type SiblingScanCache = Map<string, Promise<string[]>>

async function siblingTaoFilePaths(filePath: string, siblingScans: SiblingScanCache): Promise<string[]> {
  const directory = FS.dirname(filePath)
  let scan = siblingScans.get(directory)
  if (!scan) {
    scan = folderSiblingPathsIn(directory)
    siblingScans.set(directory, scan)
  }
  return (await scan).filter(path => path !== filePath)
}

async function folderSiblingPathsIn(directory: string): Promise<string[]> {
  if (!await FS.isDirectory(directory)) {
    return []
  }
  const candidates = (await FS.listDir(directory))
    .filter(name => FS.extname(name) === '.tao' && !name.endsWith('.test.tao'))
    .map(name => FS.resolvePath(name, directory))
  const paths: string[] = []
  for (const path of candidates) {
    if (folderDeclarationPattern.test(await FS.readText(path))) {
      paths.push(path)
    }
  }
  return paths
}

async function documentFromFilePath(context: ParserContext, filePath: string): Promise<AST.Document> {
  return await context.services.shared.workspace.LangiumDocumentFactory.fromUri<AST.TaoFile>(
    Langium.URI.file(filePath),
  )
}
