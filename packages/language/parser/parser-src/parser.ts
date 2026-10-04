import { Assert, type Diagnostic, type DiagnosticRange, Diagnostics, FS, type ReleaseProfile, TaoFiles } from '@shared'
import { Langium } from './langium-exports'
import { bridgesToATypeScriptExport, unresolvedReferenceMessage } from './linker-diagnostics'
import { emptyPackageResolver, type PackageResolver } from './package-resolver'
import * as AST from './parserASTExport'
import { createQuotedRenderParser, quotedTextImport } from './quoted-render'
import { ReleaseCompletionProvider } from './release-completion-provider'
import { TaoLexerErrorMessageProvider, TaoParserErrorMessageProvider } from './syntax-diagnostics'
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
export { releaseCapabilityOf } from './release-capability'
export { TaoReferences } from './tao-references'
export type URI = Langium.URI
export type {
  ModuleOrigin,
  PackageResolver,
  ProjectAppRequirements,
  ProjectGraph,
  ProjectModuleBinding,
  ProjectPublication,
  ProjectRequirement,
} from './package-resolver'

/** ParserServices declares the Langium services used by the parser stage. */
export type ParserServices = {
  sourceOverrides?: Readonly<Record<string, string>>
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
  releaseProfile?: ReleaseProfile
  releaseStdlibRoot?: string
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
    const factory = context.services.shared.workspace.LangiumDocumentFactory
    const source = context.services.sourceOverrides?.[uri.path]
    const entryDocument = source === undefined
      ? await factory.fromUri<AST.TaoFile>(uri)
      : factory.fromString<AST.TaoFile>(source, uri)
    const documents = await loadReachableDocuments(context, entryDocument)
    return await buildDocuments(context.services, entryDocument, documents, options)
  },

  /**
   * parseEntries parses several entry files of one workspace with a single build. Every file is read,
   * parsed, and linked once however many entries reach it, and each entry's result still holds only
   * the documents that entry reaches, in the order `parse` would have loaded them.
   *
   * Linking on the union is sound because nothing a reference resolves to depends on which entry
   * loaded the file: imports resolve by path, and a file's `folder` siblings are loaded with it
   * under every entry that reaches it. Test sidecars are the one kind of file an app file's graph
   * never holds, which is why the scope provider keeps them out of folder scope itself.
   */
  async parseEntries(context: ParserContext, uris: readonly URI[], options: ParseOptions = {}): Promise<ParseResult[]> {
    const loaded: LoadedDocuments = new Map()
    const graphs: { entryDocument: AST.Document; documents: AST.Document[] }[] = []
    for (const uri of uris) {
      const entryDocument = await documentFromFilePath(context, uri.path, loaded)
      graphs.push({ entryDocument, documents: await loadReachableDocuments(context, entryDocument, loaded) })
    }
    await linkDocuments(context.services, [...new Set(graphs.flatMap(graph => graph.documents))], options)
    return graphs.map(graph => parseResultFromDocuments(graph.entryDocument, graph.documents))
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
    taoSharedModule(),
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
    taoSharedModule(),
    taoLspSharedModule(),
  )
  const language = Langium.inject(
    Langium.createDefaultModule({ shared }),
    AST.GeneratedModule,
    taoLanguageModule(options.packages),
    lspModule(options),
  )
  return registerLanguage(shared, language)
}

/** Relink color reads when an app edit changes which design supplies them. */
class TaoDocumentBuilder extends Langium.DefaultDocumentBuilder {
  constructor(services: Langium.LangiumSharedCoreServices) {
    super(services)
    // A `folder` name is not a Langium reference — a type name is a plain identifier — so folder
    // visibility reads the workspace set recorded on each syntax tree. The checker records that set
    // before it builds. The editor builds through this class, and records every loaded Tao file once
    // the batch has finished parsing, before any document in it is linked or validated.
    this.onBuildPhase(Langium.DocumentState.Parsed, () => {
      AST.rememberVisibleWorkspaceFiles(
        Array.from(this.langiumDocuments.all)
          .map(document => document.parseResult.value)
          .filter(AST.isTaoFile),
      )
    })
  }

  protected override shouldRelink(document: Langium.LangiumDocument, changedUris: Set<string>): boolean {
    if (super.shouldRelink(document, changedUris)) {
      return true
    }
    if (changedUris.size === 0 || !AST.isTaoFile(document.parseResult.value)) {
      return false
    }
    return AST.streamAllContents(document.parseResult.value).some(node =>
      (AST.isValueReference(node) || AST.isMemberAccessExpression(node))
      && AST.isDesignColorPosition(node)
      && AST.isDesignColor(node.target.ref)
    )
  }

  // A watch event can name a file that is gone by the time the build reads it. Langium does not
  // catch that rejection, and Node treats the unhandled rejection as a process crash.
  override async update(
    changed: URI[],
    deleted: URI[],
    cancelToken = Langium.CancellationToken.None,
  ): Promise<void> {
    try {
      await super.update(changed, deleted, cancelToken)
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error
      }
      this.forgetMissingDocuments(changed, error.path)
      const remaining = changed.filter(uri => this.fileSystemProvider.existsSync(uri))
      try {
        await super.update(remaining, [], cancelToken)
      } catch (retryError) {
        if (!isMissingFileError(retryError)) {
          throw retryError
        }
        this.forgetMissingDocuments(remaining, retryError.path)
      }
    }
  }

  private forgetMissingDocuments(changed: readonly URI[], missingPath: unknown): void {
    const uris = [...changed]
    if (typeof missingPath === 'string') {
      uris.push(URI.file(missingPath))
    }
    for (const uri of uris) {
      if (this.fileSystemProvider.existsSync(uri)) {
        continue
      }
      for (const document of this.langiumDocuments.deleteDocuments(uri)) {
        this.cleanUpDeleted(document)
      }
    }
  }
}

class TaoWorkspaceManager extends Langium.DefaultWorkspaceManager {
  override shouldIncludeEntry(entry: Langium.FileSystemNode): boolean {
    if (!workspaceUriIsIndexed(entry.uri, this.workspaceFolders)) {
      return false
    }
    return super.shouldIncludeEntry(entry)
  }
}

class TaoDocumentUpdateHandler extends Langium.DefaultDocumentUpdateHandler {
  override didChangeWatchedFiles(params: Langium.DidChangeWatchedFilesParams): void {
    const changes = params.changes.filter(change =>
      workspaceUriIsIndexed(URI.parse(change.uri), this.workspaceManager.workspaceFolders)
    )
    if (changes.length === 0) {
      return
    }
    super.didChangeWatchedFiles({ ...params, changes })
  }
}

function workspaceUriIsIndexed(
  uri: URI,
  folders: readonly { readonly uri: string }[] | undefined,
): boolean {
  const relative = relativeWorkspacePath(uri, folders)
  if (folders !== undefined && folders.length > 0 && relative === undefined) {
    return false
  }
  return !skippedWorkspacePath(relative ?? uri.path)
}

function relativeWorkspacePath(
  uri: URI,
  folders: readonly { readonly uri: string }[] | undefined,
): string | undefined {
  if (folders === undefined || folders.length === 0) {
    return undefined
  }
  const path = uri.path
  for (const folder of folders) {
    const root = URI.parse(folder.uri).path.replace(/\/$/, '')
    if (path === root) {
      return ''
    }
    const prefix = `${root}/`
    if (path.startsWith(prefix)) {
      return path.slice(prefix.length)
    }
  }
  return undefined
}

function skippedWorkspacePath(path: string): boolean {
  return path.split('/').some(segment => segment.startsWith('.') || isGeneratedWorkspaceDirectory(segment))
}

function isGeneratedWorkspaceDirectory(segment: string): boolean {
  const name = segment.toLowerCase()
  // `out` matches Langium's own directory skip so a file event inside it is not indexed either.
  return name === 'out' || TaoFiles.discoveryExcludeDirectoryNames.some(excluded => excluded.toLowerCase() === name)
}

function isMissingFileError(error: unknown): error is { path?: unknown } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function taoSharedModule() {
  return {
    workspace: {
      DocumentBuilder: (services: Langium.LangiumSharedCoreServices) => new TaoDocumentBuilder(services),
      WorkspaceManager: (services: Langium.LangiumSharedCoreServices) => new TaoWorkspaceManager(services),
    },
  }
}

function taoLspSharedModule() {
  return {
    lsp: {
      DocumentUpdateHandler: (services: Langium.LangiumSharedServices) => new TaoDocumentUpdateHandler(services),
    },
  }
}

/** taoLanguageModule declares the services Tao overrides or adds on a Langium language container. */
function taoLanguageModule(packages: PackageResolver) {
  return {
    parser: {
      // Production metadata owns runtime lookahead policy; grammar generation still validates
      // separately. Reserved payload/fill alternatives must not print into worker JSON streams.
      LangiumParser: (services: Langium.LangiumCoreServices) => createQuotedRenderParser(services),
      LexerErrorMessageProvider: () => new TaoLexerErrorMessageProvider(),
      ParserErrorMessageProvider: () => new TaoParserErrorMessageProvider(),
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
    CompletionProvider: (services: Langium.LangiumServices) =>
      new ReleaseCompletionProvider(services, options.releaseProfile, options.releaseStdlibRoot),
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
  await linkDocuments(services, documents, options)
  return parseResultFromDocuments(entryDocument, documents)
}

/** linkDocuments makes `documents` the whole of what the services hold, then builds them once. */
async function linkDocuments(
  services: ParserServices,
  documents: readonly AST.Document[],
  options: ParseOptions,
): Promise<void> {
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
}

function parseResultFromDocuments(entryDocument: AST.Document, documents: readonly AST.Document[]): ParseResult {
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
    range: rangeFromParserError(error, document),
    severity: 'error',
    source: 'parser',
  }
}

function referenceDiagnostic(reference: AST.Document['references'][number], document: AST.Document): Diagnostic {
  return {
    filePath: document.uri.path,
    message: unresolvedReferenceMessage(reference) ?? reference.error!.message,
    severity: 'error',
    source: 'linker',
    range: reference.$refNode?.range,
  }
}

function rangeFromLexerError(error: LexerError): DiagnosticRange | undefined {
  if (!isPlaced(error.line) || !isPlaced(error.column)) {
    return undefined
  }
  const line = error.line - 1
  const character = error.column - 1
  return {
    start: RangeLocation(line, character),
    end: RangeLocation(line, character + Math.max(error.length, 1)),
  }
}

function rangeFromParserError(error: ParserError, document?: AST.Document): DiagnosticRange | undefined {
  const token = error.token
  if (!isPlaced(token.startLine) || !isPlaced(token.startColumn)) {
    // Chevrotain's end-of-file token carries NaN rather than nothing, so an error reported against
    // it has no position of its own. The place the author has to look is the end of what they
    // wrote, which is where the missing `}` or `)` belongs.
    return endOfSourceRange(document)
  }
  const endLine = isPlaced(token.endLine) ? token.endLine : token.startLine
  const endColumn = isPlaced(token.endColumn) ? token.endColumn : token.startColumn
  return {
    start: RangeLocation(token.startLine - 1, token.startColumn - 1),
    end: RangeLocation(endLine - 1, Math.max(endColumn, token.startColumn)),
  }
}

/** isPlaced says whether a lexer or parser position is a real one, which `NaN` is not. */
function isPlaced(position: number | undefined): position is number {
  return position !== undefined && Number.isFinite(position)
}

/** endOfSourceRange points at the last character the author wrote, skipping a trailing newline. */
function endOfSourceRange(document?: AST.Document): DiagnosticRange | undefined {
  const text = document?.textDocument.getText()
  if (text === undefined) {
    return undefined
  }
  const lines = text.split('\n')
  // A file ending in a newline has an empty last line, and underlining nothing there tells nobody
  // anything; the last line with content on it is what the author recognizes.
  const line = lines.at(-1) === '' && lines.length > 1 ? lines.length - 2 : lines.length - 1
  const character = lines[line]?.length ?? 0
  return {
    start: RangeLocation(Math.max(line, 0), Math.max(character - 1, 0)),
    end: RangeLocation(Math.max(line, 0), character),
  }
}

function RangeLocation(line: number, character: number) {
  return { line, character }
}

function isParsedFile(file: ParsedFile | undefined): file is ParsedFile {
  return file !== undefined
}

/**
 * LoadedDocuments holds the documents one batch of entries has read so far, by path, so a file
 * several entries reach is read and parsed once and every entry's graph names the same document.
 */
type LoadedDocuments = Map<string, AST.Document>

async function loadReachableDocuments(
  context: ParserContext,
  entryDocument: AST.Document,
  loaded?: LoadedDocuments,
): Promise<AST.Document[]> {
  const documents = new Map<string, AST.Document>()
  // Sibling scans are memoized per directory for this load only; files may change between runs.
  const siblingScans: SiblingScanCache = new Map()
  const intrinsicDocuments = await Promise.all(
    (await context.packages.intrinsicFilePaths()).map(path => documentFromFilePath(context, path, loaded)),
  )
  const rootDocuments = await Promise.all(
    (await context.packages.projectRootFilePaths(entryDocument.uri.path))
      .map(path => documentFromFilePath(context, path, loaded)),
  )
  const queue: AST.Document[] = [entryDocument, ...intrinsicDocuments, ...rootDocuments]

  while (queue.length > 0) {
    const document = queue.shift()!
    const currentPath = document.uri.path
    if (documents.has(currentPath)) {
      continue
    }
    documents.set(currentPath, document)
    queue.push(...await loadReferencedDocuments(context, document, documents, siblingScans, loaded))
  }

  return [...documents.values()]
}

async function loadReferencedDocuments(
  context: ParserContext,
  document: AST.Document,
  loadedDocuments: ReadonlyMap<string, AST.Document>,
  siblingScans: SiblingScanCache,
  loaded?: LoadedDocuments,
): Promise<AST.Document[]> {
  const ast = document.parseResult.value
  if (ast === undefined) {
    return []
  }
  const referencedDocuments: AST.Document[] = []
  if (AST.streamAllContents(ast).some(AST.isQuotedRender)) {
    for (
      const path of await context.packages.candidateFilePaths(quotedTextImport(), { fromFilePath: document.uri.path })
    ) {
      if (!loadedDocuments.has(path)) {
        referencedDocuments.push(await documentFromFilePath(context, path, loaded))
      }
    }
  }
  // A sibling may carry `folder` declarations this file reaches without naming them in a `use`,
  // so the whole folder is loaded rather than only what the imports point at.
  for (const siblingPath of await siblingTaoFilePaths(context, document.uri.path, siblingScans)) {
    if (!loadedDocuments.has(siblingPath)) {
      referencedDocuments.push(await documentFromFilePath(context, siblingPath, loaded))
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
        referencedDocuments.push(await documentFromFilePath(context, candidatePath, loaded))
      }
    }
  }
  for (const requirement of AST.streamAllContents(ast).filter(AST.isPackageRequires)) {
    for (const candidatePath of await context.packages.requirementFilePaths(requirement, document.uri.path)) {
      if (!loadedDocuments.has(candidatePath)) {
        referencedDocuments.push(await documentFromFilePath(context, candidatePath, loaded))
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

async function siblingTaoFilePaths(
  context: ParserContext,
  filePath: string,
  siblingScans: SiblingScanCache,
): Promise<string[]> {
  const directory = FS.dirname(filePath)
  let scan = siblingScans.get(directory)
  if (!scan) {
    scan = folderSiblingPathsIn(context, directory)
    siblingScans.set(directory, scan)
  }
  return (await scan).filter(path => path !== filePath)
}

async function folderSiblingPathsIn(context: ParserContext, directory: string): Promise<string[]> {
  const overrides = context.services.sourceOverrides ?? {}
  const diskPaths = await FS.isDirectory(directory)
    ? (await FS.listDir(directory)).map(name => FS.resolvePath(name, directory))
    : []
  const candidates = [
    ...new Set([...diskPaths, ...Object.keys(overrides).filter(path => FS.dirname(path) === directory)]),
  ]
    .filter(path => FS.extname(path) === '.tao' && !AST.isTestSidecarPath(path))
  const paths: string[] = []
  for (const path of candidates) {
    const source = overrides[path] ?? await FS.readText(path)
    if (folderDeclarationPattern.test(source)) {
      paths.push(path)
    }
  }
  return paths
}

async function documentFromFilePath(
  context: ParserContext,
  filePath: string,
  loaded?: LoadedDocuments,
): Promise<AST.Document> {
  const held = loaded?.get(filePath)
  if (held !== undefined) {
    return held
  }
  const factory = context.services.shared.workspace.LangiumDocumentFactory
  const source = context.services.sourceOverrides?.[filePath]
  const document = source === undefined
    ? await factory.fromUri<AST.TaoFile>(Langium.URI.file(filePath))
    : factory.fromString<AST.TaoFile>(source, Langium.URI.file(filePath))
  loaded?.set(filePath, document)
  return document
}
