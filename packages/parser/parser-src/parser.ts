import { Assert, type Diagnostic, type DiagnosticRange, Diagnostics, FS } from '@shared'
import { Langium } from './langium-exports'
import { bridgesToATypeScriptExport } from './linker-diagnostics'
import { emptyPackageResolver, type PackageResolver } from './package-resolver'
import * as AST from './parserASTExport'
import { TaoDocumentValidator } from './tao-document-validator'
import { TaoReferences } from './tao-references'
import { TaoTokenBuilder } from './tao-token-builder'
import { TaoValueConverter } from './tao-value-converter'
import { ValueScopeProvider } from './value-scope'

const URI = Langium.URI
/**
 * codeProjectRoot is the synthetic project root every Tao source parsed from a string lives under.
 * A path below it names no file on disk, so consumers use it to tell a string-backed document from
 * a workspace file.
 */
export const codeProjectRoot = '/__tao__'
const codeSourceUri = Langium.URI.file(`${codeProjectRoot}/source.tao`)

export { AST, Langium, URI }
export { TaoReferences } from './tao-references'
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

/** SyntaxParse declares a parse without linking: the AST, its comments, and how many errors the parse recovered from. */
export type SyntaxParse = {
  ast: AST.TaoFile
  comments: readonly AST.SyntaxRange[]
  errors: number
}

let syntaxContext: ParserContext | undefined

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

  /** parseSyntax parses Tao source text into an AST without loading imports or linking references. */
  parseSyntax(code: string, context?: ParserContext): SyntaxParse {
    syntaxContext ??= Parser.createContext()
    const result = (context ?? syntaxContext).services.language.parser.LangiumParser.parse<AST.TaoFile>(code)
    return {
      ast: result.value,
      comments: AST.commentRanges(result.value),
      errors: result.lexerErrors.length + result.parserErrors.length,
    }
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

/*
 * Both service flavors are Langium's defaults, the generated grammar module, and then Tao's own
 * language module; the LSP flavor adds the host's LSP services after it. A Tao service belongs in
 * `taoLanguageModule` and nowhere else: from there it reaches the core parser, the language server,
 * and every workspace or session built on either.
 */

function createServices(options: CreateParserContextOptions & { packages: PackageResolver }): ParserServices {
  const shared = Langium.inject(
    Langium.createDefaultSharedCoreModule(options.langiumContext ?? Langium.NodeFileSystem),
    AST.GeneratedSharedModule,
  )
  const language = Langium.inject(
    Langium.createDefaultCoreModule({ shared }),
    AST.GeneratedModule,
    taoLanguageModule(options.packages),
  )
  return registerLanguage(shared, language)
}

function createLspServices(options: CreateParserLspContextOptions & { packages: PackageResolver }): ParserLspServices {
  const shared = Langium.inject(
    Langium.createDefaultSharedModule(options.langiumContext ?? Langium.NodeFileSystem),
    AST.GeneratedSharedModule,
  )
  const language = Langium.inject(
    Langium.createDefaultModule({ shared }),
    AST.GeneratedModule,
    taoLanguageModule(options.packages),
    lspModule(options),
  )
  return registerLanguage(shared, language)
}

/** taoLanguageModule declares the services Tao overrides or adds on a Langium language container. */
function taoLanguageModule(packages: PackageResolver) {
  return {
    parser: {
      // Tao deliberately resolves token-identical configured constructors and one-field
      // unlabeled item forms from their linked owner declarations.
      ParserConfig: () => ({ skipValidations: true }),
      TokenBuilder: () => new TaoTokenBuilder(),
      ValueConverter: () => new TaoValueConverter(),
    },
    references: {
      References: (services: Langium.LangiumCoreServices) => new TaoReferences(services, packages),
      ScopeProvider: (services: Langium.LangiumCoreServices) => new ValueScopeProvider(services, packages),
    },
    validation: {
      DocumentValidator: (services: Langium.LangiumCoreServices) => new TaoDocumentValidator(services),
    },
  }
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

/** registerLanguage makes an assembled language container reachable through its shared services. */
function registerLanguage<
  SharedT extends Langium.LangiumSharedCoreServices,
  LanguageT extends Langium.LangiumCoreServices,
>(
  shared: SharedT,
  language: LanguageT,
): { shared: SharedT; language: LanguageT } {
  shared.ServiceRegistry.register(language)
  return { shared, language }
}

async function buildDocuments(
  services: ParserServices,
  entryDocument: AST.Document,
  documents: readonly AST.Document[],
  options: ParseOptions,
): Promise<ParseResult> {
  const langiumDocuments = services.shared.workspace.LangiumDocuments
  const currentUris = new Set(documents.map(document => document.uri.toString()))
  for (const retained of Array.from(langiumDocuments.all)) {
    if (!currentUris.has(retained.uri.toString())) {
      langiumDocuments.deleteDocument(retained.uri)
    }
  }
  AST.rememberVisibleWorkspaceFiles(
    documents.map(document => document.parseResult.value).filter(AST.isTaoFile),
  )
  for (const document of documents) {
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
