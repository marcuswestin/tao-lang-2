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
  /** A host refreshed package ownership or physical boundaries without necessarily changing source. */
  relink?: boolean
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
  diagnostics: readonly Diagnostic[]
  errors: number
}

let syntaxContext: ParserContext | undefined
const sourceBatches = new WeakMap<Langium.LangiumSharedCoreServices, Map<string, string>>()

type ValidationDependencies = {
  readonly files: readonly AST.TaoFile[]
  readonly targets: readonly AST.Node[]
  readonly signature: string
}

type DependencyEdge = readonly [kind: string, paths: readonly string[]]
type DependencyInputs = { edges: DependencyEdge[]; complete: boolean }
type DependencyPublication = Map<AST.TaoFile, ValidationDependencies>
const dependencyPublications = new WeakMap<Langium.LangiumSharedCoreServices, DependencyPublication>()
const dependencyOwners = new WeakMap<AST.TaoFile, DependencyPublication>()
const discoveredDependencies = new WeakMap<LoadedDocuments, Map<string, DependencyInputs>>()

/** Parser exposes lexing and parsing functions for Tao source files and source strings. */
export const Parser = {
  /** Exact inputs of the last complete core build; syntax-only and editor-only builds are unknown. */
  validationDependencies(file: AST.TaoFile): ValidationDependencies | undefined {
    return dependencyOwners.get(file)?.get(file)
  },
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
    const loaded = new Map<string, AST.Document>()
    const entryDocument = await documentFromFilePath(context, uri.path, loaded)
    const documents = await loadReachableDocuments(context, entryDocument, loaded)
    return await buildDocuments(context, entryDocument, documents, options, loaded)
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
    await linkDocuments(context, [...new Set(graphs.flatMap(graph => graph.documents))], options, loaded)
    return graphs.map(graph =>
      parseResultFromDocuments(
        graph.entryDocument,
        canonicalDocuments(context.services, graph.documents),
      )
    )
  },

  /** parseSyntax parses Tao source text into an AST without loading imports or linking references. */
  parseSyntax(code: string, context?: ParserContext): SyntaxParse {
    syntaxContext ??= Parser.createContext()
    const result = (context ?? syntaxContext).services.language.parser.LangiumParser.parse<AST.TaoFile>(code)
    return {
      ast: result.value,
      comments: AST.commentRanges(result.value),
      diagnostics: [
        ...result.lexerErrors.map(error => lexerDiagnostic(error)),
        ...result.parserErrors.map(error => parserDiagnostic(error)),
      ],
      errors: result.lexerErrors.length + result.parserErrors.length,
    }
  },

  /** parseCode parses Tao source code using a standalone parser context. */
  async parseCode(code: string, options: ParseOptions = {}): Promise<ParseResult> {
    return await Parser.parseSource(Parser.createContext(), code, options)
  },

  /** parseSource parses Tao source code using an existing parser context. */
  async parseSource(context: ParserContext, code: string, options: ParseOptions = {}): Promise<ParseResult> {
    const uri = options.uri ?? codeSourceUri
    const document = documentFromSource(context.services, code, uri)
    const loaded = new Map<string, AST.Document>([[uri.path, document]])
    const documents = await loadReachableDocuments(context, document, loaded)
    return await buildDocuments(context, document, documents, options, loaded)
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
  const batch = sourceBatchContext(options.langiumContext ?? Langium.NodeFileSystem)
  const shared = Langium.inject(
    Langium.createDefaultSharedCoreModule(batch.context),
    AST.GeneratedSharedModule,
    taoSharedModule(),
  )
  sourceBatches.set(shared, batch.sources)
  const language = Langium.inject(
    Langium.createDefaultCoreModule({ shared }),
    AST.GeneratedModule,
    taoLanguageModule(options.packages),
  )
  return registerLanguage(shared, language)
}

function createLspServices(options: CreateParserLspContextOptions & { packages: PackageResolver }): ParserLspServices {
  const batch = sourceBatchContext(options.langiumContext ?? Langium.NodeFileSystem)
  const shared = Langium.inject(
    Langium.createDefaultSharedModule(batch.context),
    AST.GeneratedSharedModule,
    taoSharedModule(),
    taoLspSharedModule(),
  )
  sourceBatches.set(shared, batch.sources)
  const language = Langium.inject(
    Langium.createDefaultModule({ shared }),
    AST.GeneratedModule,
    taoLanguageModule(options.packages),
    lspModule(options),
  )
  return registerLanguage(shared, language)
}

/** Keep discovery and the subsequent update on the same captured source, including virtual files. */
function sourceBatchContext<ContextT extends Langium.DefaultSharedCoreModuleContext>(context: ContextT) {
  const sources = new Map<string, string>()
  return {
    sources,
    context: {
      ...context,
      fileSystemProvider: (services: Langium.LangiumSharedCoreServices) => {
        const provider = context.fileSystemProvider(services)
        return Object.assign(Object.create(provider) as typeof provider, {
          readFile: (uri: URI) =>
            sources.has(uri.path)
              ? Promise.resolve(sources.get(uri.path)!)
              : provider.readFile(uri),
          readFileSync: (uri: URI) => sources.get(uri.path) ?? provider.readFileSync(uri),
          exists: (uri: URI) => sources.has(uri.path) ? Promise.resolve(true) : provider.exists(uri),
          existsSync: (uri: URI) => sources.has(uri.path) || provider.existsSync(uri),
        })
      },
    },
  }
}

/** Relink implicit dependencies that have no authored Langium reference. */
class TaoDocumentBuilder extends Langium.DefaultDocumentBuilder {
  constructor(private readonly sharedServices: Langium.LangiumSharedCoreServices) {
    super(sharedServices)
    this.onUpdate((changed, deleted) => {
      if (changed.length > 0 || deleted.length > 0) {
        for (const document of this.langiumDocuments.all) {
          // A deletion-only update otherwise never enters Parsed, leaving implicit workspace
          // visibility and unused wildcard target sets attached to the preceding graph.
          this.resetToState(document, Langium.DocumentState.Parsed)
        }
      }
    })
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

  override async build(
    ...args: Parameters<InstanceType<typeof Langium.DefaultDocumentBuilder>['build']>
  ): Promise<void> {
    dependencyPublications.get(this.sharedServices)?.clear()
    await super.build(...args)
  }

  protected override shouldRelink(document: Langium.LangiumDocument, changedUris: Set<string>): boolean {
    // Plain type names, folder visibility, implicit mounts and unused wildcards have no indexed
    // reference edge. Reuse their syntax trees, but refresh every retained Tao document's links.
    if (changedUris.size > 0 && AST.isTaoFile(document.parseResult.value)) {
      return true
    }
    return super.shouldRelink(document, changedUris)
  }

  // A watch event can name a file that is gone by the time the build reads it. Langium does not
  // catch that rejection, and Node treats the unhandled rejection as a process crash.
  override async update(
    changed: URI[],
    deleted: URI[],
    cancelToken = Langium.CancellationToken.None,
  ): Promise<void> {
    dependencyPublications.get(this.sharedServices)?.clear()
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
  context: ParserContext,
  entryDocument: AST.Document,
  documents: readonly AST.Document[],
  options: ParseOptions,
  loaded: LoadedDocuments,
): Promise<ParseResult> {
  await linkDocuments(context, documents, options, loaded)
  return parseResultFromDocuments(entryDocument, canonicalDocuments(context.services, documents))
}

/** linkDocuments updates the complete reachable set while retaining unchanged syntax trees. */
async function linkDocuments(
  context: ParserContext,
  documents: readonly AST.Document[],
  options: ParseOptions,
  loaded: LoadedDocuments,
): Promise<void> {
  const services = context.services
  const langiumDocuments = services.shared.workspace.LangiumDocuments
  const currentUris = new Set(documents.map(document => document.uri.toString()))
  const deleted = Array.from(langiumDocuments.all)
    .filter(document => !currentUris.has(document.uri.toString()))
    .map(document => document.uri)
  const changed: URI[] = []
  const sources = sourceBatches.get(services.shared)
  for (const document of documents) {
    if (langiumDocuments.getDocument(document.uri) !== document) {
      // Discovery has already parsed the changed source. Updating this same CST lets Langium
      // skip its second parse, while update still clears the URI's indexes and reference state.
      langiumDocuments.deleteDocument(document.uri)
      langiumDocuments.addDocument(document)
      changed.push(document.uri)
    } else if (options.relink) {
      changed.push(document.uri)
    }
    sources?.set(document.uri.path, document.textDocument.getText())
  }
  const builder = services.shared.workspace.DocumentBuilder
  const previousOptions = builder.updateBuildOptions
  builder.updateBuildOptions = { eagerLinking: true, validation: false }
  try {
    await builder.update(changed, deleted)
    // Validation is deliberately repeated even when no text changed: Tao checks can depend on
    // mutable workspace/package state beyond Langium's indexed references.
    if (options.validation ?? true) {
      await builder.build(canonicalDocuments(services, documents), { eagerLinking: true, validation: true })
    }
  } finally {
    builder.updateBuildOptions = previousOptions
    sources?.clear()
  }
  await publishValidationDependencies(context, canonicalDocuments(services, documents), loaded)
}

/** Publish only canonical, fully linked inputs captured by this invocation's discovery. */
async function publishValidationDependencies(
  context: ParserContext,
  documents: readonly AST.Document[],
  loaded: LoadedDocuments,
): Promise<void> {
  const discovered = discoveredDependencies.get(loaded)
  if (!discovered) {
    return
  }
  const publication: DependencyPublication = new Map()
  dependencyPublications.set(context.services.shared, publication)
  const byPath = new Map(documents.map(document => [document.uri.path, document]))
  const allFiles = documents.map(document => document.parseResult.value)
  const locator = context.services.language.workspace.AstNodeLocator
  const inputs = new Map<string, DependencyInputs>()
  const targetsByPath = new Map<string, AST.Node[]>()
  const selectionsByPath = new Map<string, unknown[]>()
  const boundariesByPath = new Map<string, string>()
  const nodeKey = (node: AST.Node): readonly string[] => [
    AST.getDocument(node).uri.path,
    locator.getAstNodePath(node),
    node.$type,
  ]
  const primitivePaths = allFiles.filter(file => file.statements.some(AST.isPrimitiveDeclaration))
    .map(file => AST.getDocument(file).uri.path)
  const readContextPaths = [...byPath.keys()].filter(path => path.endsWith('/@tao/data/ReadContext.tao'))
  for (const document of documents) {
    const path = document.uri.path
    const captured = discovered.get(path)
    if (!captured) {
      continue
    }
    const boundary = await context.packages.validationBoundary(path)
    if (boundary !== undefined) {
      boundariesByPath.set(path, boundary)
    }
    const edges: DependencyEdge[] = [...captured.edges]
    const input: DependencyInputs = {
      edges,
      complete: captured.complete
        && boundary !== undefined
        && document.state >= Langium.DocumentState.Linked
        && document.parseResult.lexerErrors.length === 0
        && document.parseResult.parserErrors.length === 0,
    }
    inputs.set(path, input)
    // Mounted designs and project data membership are plain structural lookups, not references.
    edges.push([
      'project-visibility',
      context.packages.projectSourceFiles({
        fromFilePath: path,
        workspaceFiles: allFiles,
      }).map(file => AST.getDocument(file).uri.path),
    ])
    edges.push(['primitive-contracts', primitivePaths], ['read-context', readContextPaths])
    const selections: unknown[] = []
    selectionsByPath.set(path, selections)
    const useStatements = document.parseResult.value.statements.filter(statement =>
      AST.isUseStatement(statement) || AST.isUsePackageStatement(statement)
    )
    for (const [index, statement] of useStatements.entries()) {
      // A root publication discovered later may establish an alias this earlier import uses.
      // Re-read its candidate membership after all requirements have registered their bindings.
      const candidates = await context.packages.candidateFilePaths(statement, { fromFilePath: path })
      const kind = `import:${index}:${statement.importPath ?? ''}`
      const edgeIndex = edges.findIndex(([edgeKind]) => edgeKind === kind)
      if (edgeIndex === -1) {
        input.complete = false
      } else {
        edges[edgeIndex] = [kind, [...candidates]]
      }
      if (!statement.importPath || (!AST.isUseStatement(statement) || !statement.all) && candidates.length === 0) {
        input.complete = false
      }
      const declarations = context.packages.collectTargetDeclarations(statement, {
        fromFilePath: path,
        workspaceFiles: allFiles,
      })
      // Observe every selected declaration, including an unused wildcard, without changing
      // the import bindings owned by linking.
      edges.push([`import-targets:${index}`, declarations.map(declaration => AST.getDocument(declaration).uri.path)])
      selections.push([index, declarations.map(nodeKey)])
    }
    const targets: AST.Node[] = []
    targetsByPath.set(path, targets)
    for (const reference of document.references) {
      const target = 'ref' in reference ? reference.ref : undefined
      if (!target) {
        // These heads name TypeScript exports, not Tao declarations. Their complete authored
        // input remains in this document's AST; foreign implementation checks run separately.
        if (!bridgesToATypeScriptExport(reference)) {
          input.complete = false
        }
        continue
      }
      const targetPath = AST.getDocument(target).uri.path
      if (byPath.get(targetPath)?.parseResult.value !== AST.findRoot(target)) {
        input.complete = false
      }
      targets.push(target)
      edges.push(['reference', [targetPath]])
    }
  }
  for (const document of documents) {
    const reached = new Set<string>()
    const queue = [document.uri.path]
    let complete = true
    while (queue.length > 0) {
      const path = queue.shift()!
      if (reached.has(path)) {
        continue
      }
      reached.add(path)
      const input = inputs.get(path)
      if (!input?.complete || !byPath.has(path)) {
        complete = false
        break
      }
      queue.push(...input.edges.flatMap(([kind, paths]) =>
        // Extra root membership is observational: only roots already loaded by normal discovery
        // can supply AST inputs to local handlers. All authored/reachable candidate edges remain strict.
        kind === 'project-root' ? paths.filter(candidate => byPath.has(candidate)) : paths
      ))
    }
    if (!complete) {
      continue
    }
    const paths = [...reached].sort()
    const files = Object.freeze(paths.map(path => byPath.get(path)!.parseResult.value))
    const targets = Object.freeze([...new Set(paths.flatMap(path => targetsByPath.get(path) ?? []))])
    const signature = JSON.stringify(paths.map(path => [
      path,
      inputs.get(path)!.edges,
      boundariesByPath.get(path),
      selectionsByPath.get(path),
      (targetsByPath.get(path) ?? []).map(nodeKey),
    ]))
    const file = document.parseResult.value
    publication.set(file, Object.freeze({ files, targets, signature }))
    dependencyOwners.set(file, publication)
  }
}

function canonicalDocuments(services: ParserServices, documents: readonly AST.Document[]): AST.Document[] {
  return documents.map(document => {
    const canonical = services.shared.workspace.LangiumDocuments.getDocument(document.uri)
    Assert.defined(canonical, 'built Tao document remains in the workspace', { path: document.uri.path })
    return canonical as AST.Document
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
const loadedSources = new WeakMap<LoadedDocuments, Map<string, Promise<string>>>()

async function loadReachableDocuments(
  context: ParserContext,
  entryDocument: AST.Document,
  loaded: LoadedDocuments,
): Promise<AST.Document[]> {
  const documents = new Map<string, AST.Document>()
  let inputs = discoveredDependencies.get(loaded)
  if (!inputs) {
    inputs = new Map()
    discoveredDependencies.set(loaded, inputs)
  }
  // Sibling scans are memoized per directory for this load only; files may change between runs.
  const siblingScans: SiblingScanCache = new Map()
  const intrinsicPaths = await context.packages.intrinsicFilePaths()
  const intrinsicDocuments = await Promise.all(
    intrinsicPaths.map(path => documentFromFilePath(context, path, loaded)),
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
    queue.push(
      ...await loadReferencedDocuments(context, document, documents, siblingScans, loaded, inputs, intrinsicPaths),
    )
  }

  return [...documents.values()]
}

async function loadReferencedDocuments(
  context: ParserContext,
  document: AST.Document,
  loadedDocuments: ReadonlyMap<string, AST.Document>,
  siblingScans: SiblingScanCache,
  loaded: LoadedDocuments,
  inputs: Map<string, DependencyInputs>,
  intrinsicPaths: readonly string[],
): Promise<AST.Document[]> {
  const ast = document.parseResult.value
  if (ast === undefined) {
    return []
  }
  const referencedDocuments: AST.Document[] = []
  const edges: DependencyEdge[] = [['intrinsic', [...intrinsicPaths]]]
  const input: DependencyInputs = { edges, complete: true }
  inputs.set(document.uri.path, input)
  const addCandidates = async (kind: string, paths: readonly string[]): Promise<void> => {
    // Record empty sets and every candidate before suppressing already-loaded documents.
    edges.push([kind, [...paths]])
    for (const path of paths) {
      if (!loadedDocuments.has(path)) {
        referencedDocuments.push(await documentFromFilePath(context, path, loaded))
      }
    }
  }
  // Root membership is a validation input, not an additional reachability rule. Only the
  // entry's original root discovery loads root files; additional root paths are signature observations.
  edges.push(['project-root', [
    ...await context.packages.projectRootFilePaths(document.uri.path, {
      clearRequirementAliases: false,
    }),
  ]])
  if (AST.streamAllContents(ast).some(AST.isQuotedRender)) {
    await addCandidates(
      'quoted-render',
      await context.packages.candidateFilePaths(quotedTextImport(), {
        fromFilePath: document.uri.path,
      }),
    )
  }
  // Plain-name and folder visibility use these siblings even without a resolved reference.
  await addCandidates('folder', await siblingTaoFilePaths(context, document.uri.path, siblingScans, loaded))
  const importingStatements = ast.statements.filter(statement =>
    AST.isUseStatement(statement) || AST.isUsePackageStatement(statement)
  )
  for (const [index, useStatement] of importingStatements.entries()) {
    const candidatePaths = await context.packages.candidateFilePaths(useStatement, {
      fromFilePath: document.uri.path,
    })
    await addCandidates(`import:${index}:${useStatement.importPath ?? ''}`, candidatePaths)
  }
  for (const [index, requirement] of AST.streamAllContents(ast).filter(AST.isPackageRequires).entries()) {
    const paths = await context.packages.requirementFilePaths(requirement, document.uri.path)
    await addCandidates(`requirement:${index}`, paths)
    if (requirement.locator && paths.length === 0) {
      input.complete = false
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
  loaded?: LoadedDocuments,
): Promise<string[]> {
  const directory = FS.dirname(filePath)
  let scan = siblingScans.get(directory)
  if (!scan) {
    scan = folderSiblingPathsIn(context, directory, loaded)
    siblingScans.set(directory, scan)
  }
  return (await scan).filter(path => path !== filePath)
}

async function folderSiblingPathsIn(
  context: ParserContext,
  directory: string,
  loaded?: LoadedDocuments,
): Promise<string[]> {
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
    const source = await sourceFromFilePath(context, path, loaded)
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
  const source = await sourceFromFilePath(context, filePath, loaded)
  const document = documentFromSource(context.services, source, URI.file(filePath))
  loaded?.set(filePath, document)
  return document
}

function sourceFromFilePath(context: ParserContext, filePath: string, loaded?: LoadedDocuments): Promise<string> {
  if (loaded?.has(filePath)) {
    return Promise.resolve(loaded.get(filePath)!.textDocument.getText())
  }
  let sources = loaded && loadedSources.get(loaded)
  if (loaded && !sources) {
    sources = new Map()
    loadedSources.set(loaded, sources)
  }
  let source = sources?.get(filePath)
  if (!source) {
    const override = context.services.sourceOverrides?.[filePath]
    source = override === undefined
      ? context.services.shared.workspace.FileSystemProvider.readFile(URI.file(filePath))
      : Promise.resolve(override)
    sources?.set(filePath, source)
  }
  return source
}

function documentFromSource(services: ParserServices, source: string, uri: URI): AST.Document {
  const retained = services.shared.workspace.LangiumDocuments.getDocument(uri)
  if (retained !== undefined && retained.textDocument.getText() === source) {
    return retained as AST.Document
  }
  return services.shared.workspace.LangiumDocumentFactory.fromString<AST.TaoFile>(source, uri)
}
