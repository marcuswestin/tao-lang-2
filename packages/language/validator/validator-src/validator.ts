import { ASTUtils, Packages, Type } from '@ast-utils'
import { AST, codeProjectRoot, Parser, type ParseResult, type ParserServices, type ProjectGraph } from '@parser'
import { type Diagnostic, Diagnostics, FS, HCI, Platform, ReleaseCapabilities, type ReleaseProfile } from '@shared'
import { registerTaoValidationChecks } from './langium-validation'
import type { NodeValidationReuse } from './node-validation'
import { Validate } from './Validate'
import { Validation, type ValidationContext, type ValidationRunContext } from './validation'
import { AppValidator } from './validators/app-validator'
import { validatePackageWorkspace } from './validators/package-validator'
import { validateReleaseCapabilities } from './validators/release-capabilities-validator'

/** ValidationResult declares validated Tao source and diagnostics. */
export type ValidationResult = Pick<ParseResult, 'entry' | 'files'> & {
  diagnostics: readonly Diagnostic[]
  /** Sealed source contracts for this validated AST generation, retained for compilation. */
  associatedEffects?: ASTUtils.AssociatedEffectsContext
}

/** ValidatorSession reuses standalone parser services across independent source strings. */
export type ValidatorSession = {
  validateCode(code: string): Promise<ValidationResult>
}

/** createContext creates validator invocation state. */
function createContext(
  packagesContext: Packages.Context,
  workspaceFiles: readonly AST.TaoFile[],
  entryFilePath: string,
  projectFiles?: readonly AST.TaoFile[],
  releaseProfile: ReleaseProfile = ReleaseCapabilities.current(),
): ValidationRunContext {
  return {
    entryFilePath,
    releaseProfile,
    packagesContext,
    workspaceFiles,
    ...(projectFiles === undefined ? {} : { projectFiles }),
  }
}

/**
 * installLangiumChecks makes a document build on `services` run Tao validation, with each file
 * validated against the workspace those services currently hold. It is the one place validation
 * joins a Langium container, so the core and LSP workspace flavors install it the same way; the
 * standalone session below validates a parse result directly instead and never installs it.
 */
function installLangiumChecks(
  services: ParserServices,
  packagesContext: Packages.Context,
  editorRelease = false,
): void {
  let batch: {
    contexts: ReadonlyMap<AST.TaoFile, ValidationRunContext>
    pending: Set<AST.TaoFile>
  } | undefined
  registerTaoValidationChecks(services.language, file => {
    if (!batch?.pending.has(file)) {
      const allFiles = Array.from(services.shared.workspace.LangiumDocuments.all)
        .map(document => document.parseResult.value)
        .filter(AST.isTaoFile)
      if (!allFiles.includes(file)) {
        allFiles.push(file)
      }
      const workspaceByProject = new Map<string | undefined, readonly AST.TaoFile[]>()
      const memoByProject = new Map<string | undefined, Map<string, unknown>>()
      const contexts = new Map<AST.TaoFile, ValidationRunContext>()
      for (const candidate of allFiles) {
        const entryFilePath = AST.getDocument(candidate).uri.path
        const projectRoot = Packages.projectRootForPath(packagesContext.index, entryFilePath)
        let workspaceFiles = workspaceByProject.get(projectRoot)
        if (!workspaceFiles) {
          workspaceFiles = allFiles.filter(workspaceCandidate => {
            const path = AST.getDocument(workspaceCandidate).uri.path
            return FS.pathIsWithin(path, packagesContext.stdlibRoot)
              || !FS.pathIsWithin(path, packagesContext.index.projectRoot)
              || Packages.projectRootForPath(packagesContext.index, path) === projectRoot
          })
          workspaceByProject.set(projectRoot, workspaceFiles)
        }
        let memoStore = memoByProject.get(projectRoot)
        if (!memoStore) {
          memoStore = new Map<string, unknown>()
          memoByProject.set(projectRoot, memoStore)
        }
        contexts.set(candidate, {
          ...createContext(packagesContext, workspaceFiles, entryFilePath),
          memoStore,
        })
      }
      batch = { contexts, pending: new Set(allFiles) }
    }
    const context = batch.contexts.get(file)
    batch.pending.delete(file)
    if (context) {
      return context
    }
    const entryFilePath = AST.getDocument(file).uri.path
    const projectRoot = Packages.projectRootForPath(packagesContext.index, entryFilePath)
    const workspaceFiles = Array.from(services.shared.workspace.LangiumDocuments.all)
      .map(document => document.parseResult.value)
      .filter(AST.isTaoFile)
      .filter(candidate => {
        const path = AST.getDocument(candidate).uri.path
        return FS.pathIsWithin(path, packagesContext.stdlibRoot)
          || !FS.pathIsWithin(path, packagesContext.index.projectRoot)
          || Packages.projectRootForPath(packagesContext.index, path) === projectRoot
      })
    return createContext(packagesContext, workspaceFiles, entryFilePath)
  }, editorRelease)
}

type TypeReport = (ctx: ValidationContext) => void

/** DocumentReuse belongs to one workspace; clear it when package topology changes or a build fails. */
export interface DocumentReuse {
  clear(): void
}

type CapturedReport = {
  severity: 'error' | 'warning' | 'hint'
  node: AST.Node
  message: string
  opts: Parameters<ValidationContext['error']>[2]
}
type DocumentReports = {
  structural: Map<
    AST.Node,
    Map<number, {
      check: Parameters<NodeValidationReuse['run']>[1]
      reports: readonly CapturedReport[]
    }>
  >
  types?: readonly CapturedReport[]
}
type DocumentVariant = {
  file: AST.TaoFile
  dependencies: NonNullable<ReturnType<typeof Parser.validationDependencies>>
  packagesContext: Packages.Context
  contextKey: string
  reports: DocumentReports
}
type DocumentReuseState = Map<string, readonly DocumentVariant[]>
type PreviewValidationSnapshot = {
  packagesContext: Packages.Context
  files: readonly AST.TaoFile[]
  diagnostics: ReadonlyMap<AST.TaoFile, readonly Diagnostic[]>
  dependencies: ReadonlyMap<AST.TaoFile, DocumentVariant['dependencies']>
}
const previewValidationSnapshots = new WeakMap<DocumentReuse, Map<string, PreviewValidationSnapshot>>()
const documentReuseStates = new WeakMap<DocumentReuse, DocumentReuseState>()

function createDocumentReuse(options: { experimentalWholeDocumentReuse?: boolean } = {}): DocumentReuse {
  const state: DocumentReuseState = new Map()
  const snapshots = options.experimentalWholeDocumentReuse ? new Map<string, PreviewValidationSnapshot>() : undefined
  const reuse = {
    clear: () => {
      state.clear()
      snapshots?.clear()
    },
  }
  if (snapshots !== undefined) {
    previewValidationSnapshots.set(reuse, snapshots)
  }
  documentReuseStates.set(reuse, state)
  return reuse
}

function captureReports(action: (ctx: ValidationContext) => void, ctx: ValidationContext): readonly CapturedReport[] {
  const reports: CapturedReport[] = []
  const accept = (severity: CapturedReport['severity']): ValidationContext['error'] => (node, message, opts) => {
    reports.push(Object.freeze({ severity, node, message, opts: opts ? Object.freeze({ ...opts }) : undefined }))
  }
  action({ ...ctx, error: accept('error'), warning: accept('warning'), hint: accept('hint') })
  return Object.freeze(reports)
}

function replayReports(reports: readonly CapturedReport[], ctx: ValidationContext): void {
  for (const report of reports) {
    ctx[report.severity](report.node, report.message, report.opts ? { ...report.opts } : undefined)
  }
}

/** Compare frozen dependency observations, never the mutable linked documents themselves. */
function sameValidationDependencies(
  left: DocumentVariant['dependencies'],
  right: DocumentVariant['dependencies'],
): boolean {
  const same = <T>(a: readonly T[], b: readonly T[]) =>
    a.length === b.length && a.every((value, index) => value === b[index])
  return left.signature === right.signature && same(left.files, right.files) && same(left.targets, right.targets)
}

function documentVariant(
  file: AST.TaoFile,
  context: ValidationRunContext,
  state: DocumentReuseState,
  contextKey: string,
): DocumentVariant | undefined {
  const dependencies = Parser.validationDependencies(file)
  if (!dependencies) {
    state.delete(AST.getDocument(file).uri.path)
    return undefined
  }
  const path = AST.getDocument(file).uri.path
  const variants = state.get(path) ?? []
  const previous = variants.find(candidate =>
    candidate.file === file && candidate.packagesContext === context.packagesContext
    && candidate.contextKey === contextKey && sameValidationDependencies(candidate.dependencies, dependencies)
  )
  if (previous) {
    return previous
  }
  const variant: DocumentVariant = {
    file,
    dependencies,
    packagesContext: context.packagesContext,
    contextKey,
    reports: { structural: new Map() },
  }
  // Bound entry/context variants and release old ASTs rather than retaining an edit history.
  state.set(path, [...variants.filter(candidate => candidate.file === file).slice(-31), variant])
  return variant
}

function documentContextKey(context: ValidationRunContext): string {
  const paths = (files: readonly AST.TaoFile[]) => files.map(candidate => AST.getDocument(candidate).uri.path)
  return JSON.stringify([
    ReleaseCapabilities.fingerprint(context.releaseProfile ?? ReleaseCapabilities.current()),
    context.entryFilePath,
    Packages.isTestSourcePath(context.entryFilePath),
    paths(context.workspaceFiles),
    paths(context.projectFiles ?? context.workspaceFiles),
  ])
}

function structuralReuse(reports: DocumentReports, ctx: ValidationContext): Pick<NodeValidationReuse, 'run'> {
  let collecting: CapturedReport[] = []
  const accept = (severity: CapturedReport['severity']): ValidationContext['error'] => (node, message, opts) => {
    collecting.push(Object.freeze({ severity, node, message, opts: opts ? Object.freeze({ ...opts }) : undefined }))
  }
  const reportingContext = { ...ctx, error: accept('error'), warning: accept('warning'), hint: accept('hint') }
  return {
    run(node, check, slot, ctx, file) {
      let slots = reports.structural.get(node)
      if (!slots) {
        slots = new Map()
        reports.structural.set(node, slots)
      }
      let invocation = slots.get(slot)
      if (!invocation || invocation.check !== check) {
        collecting = []
        check(node, reportingContext, file)
        invocation = { check, reports: Object.freeze(collecting) }
        slots.set(slot, invocation)
      }
      replayReports(invocation.reports, ctx)
    },
  }
}

type BatchReuse = {
  apps: ReturnType<typeof AppValidator.createBatchMemo>
  inference: ReturnType<typeof Type.createInferenceMemo>
  nodes: WeakMap<AST.TaoFile, readonly AST.Node[]>
  types: Map<Packages.Context, Map<AST.TaoFile, readonly TypeReport[]>>
  graphs: {
    packagesContext: Packages.Context
    projectRoot: string
    workspaceFiles: readonly AST.TaoFile[]
    testEntry: string | undefined
    graph: ProjectGraph
  }[]
}

/**
 * validateParseResults shares linked-AST inference, type reports, app helpers, and equivalent requirement graphs.
 * Results retain each entry's gating, file order, structural checks, and foreign-file checks. All
 * inference, graph, app, and descendant reuse dies with this call. An optional caller-owned
 * document cache retains only eligible handler reports guarded by parser dependency snapshots.
 * Callers must supply results from one completed, unmodified build.
 */
async function validateParseResults(
  runs: readonly { parseResult: ParseResult; context: ValidationRunContext }[],
  documentReuse?: DocumentReuse,
  experimentalChangedPaths?: readonly string[],
): Promise<readonly ValidationResult[]> {
  const reuse: BatchReuse = {
    apps: AppValidator.createBatchMemo(),
    inference: Type.createInferenceMemo(),
    nodes: new WeakMap(),
    types: new Map(),
    graphs: [],
  }
  const persisted = documentReuse && documentReuseStates.get(documentReuse)
  const failedBuild = runs.some(run => Diagnostics.hasError(run.parseResult.diagnostics, 'lexer', 'parser', 'linker'))
  if (failedBuild) {
    documentReuse?.clear()
  }
  // New reports are published only after every entry has completed successfully.
  const staged = persisted && !failedBuild ? new Map(persisted) : undefined
  const activeVariants = new Set<DocumentVariant>()
  const snapshots = documentReuse && previewValidationSnapshots.get(documentReuse)
  const stagedSnapshots = snapshots && !failedBuild ? new Map(snapshots) : undefined
  try {
    const results: ValidationResult[] = []
    for (const { parseResult, context } of runs) {
      results.push(
        await validateParseResult(
          parseResult,
          context,
          reuse,
          staged,
          activeVariants,
          stagedSnapshots,
          failedBuild ? undefined : experimentalChangedPaths,
        ),
      )
    }
    if (persisted && staged) {
      const paths = new Set(runs.flatMap(run => run.context.workspaceFiles.map(file => AST.getDocument(file).uri.path)))
      persisted.clear()
      for (const [path, variants] of staged) {
        if (paths.has(path)) {
          persisted.set(path, variants.filter(variant => activeVariants.has(variant)))
        }
      }
    }
    if (snapshots && stagedSnapshots) {
      snapshots?.clear()
      for (const [key, snapshot] of stagedSnapshots) {
        snapshots.set(key, snapshot)
      }
    }
    return results
  } catch (error) {
    documentReuse?.clear()
    throw error
  }
}

/** batchNodes snapshots descendants once for each exact AST identity in this batch. */
function batchNodes(file: AST.TaoFile, reuse: BatchReuse): readonly AST.Node[] {
  let nodes = reuse.nodes.get(file)
  if (!nodes) {
    nodes = Object.freeze(AST.streamAllContents(file))
    reuse.nodes.set(file, nodes)
  }
  return nodes
}

/** sharedRequirementGraph compares the exact ordered graph inputs before sharing a graph. */
function sharedRequirementGraph(context: ValidationRunContext, reuse: BatchReuse): ProjectGraph {
  const projectRoot = Packages.projectRootForPath(context.packagesContext.index, context.entryFilePath)
    ?? FS.dirname(context.entryFilePath)
  const workspaceFiles = [...new Set(context.workspaceFiles.flatMap(AST.workspaceFilesFor))]
    .filter(file => {
      const path = AST.getDocument(file).uri.path
      return !Packages.isTestSourcePath(path) || path === context.entryFilePath
    })
  const testEntry = Packages.isTestSourcePath(context.entryFilePath) ? context.entryFilePath : undefined
  const existing = reuse.graphs.find(candidate =>
    candidate.packagesContext === context.packagesContext
    && candidate.projectRoot === projectRoot
    && candidate.testEntry === testEntry
    && candidate.workspaceFiles.length === workspaceFiles.length
    && candidate.workspaceFiles.every((file, index) => file === workspaceFiles[index])
  )
  if (existing) {
    return existing.graph
  }
  const graph = Packages.createResolver(context.packagesContext).projectGraph({
    fromFilePath: context.entryFilePath,
    workspaceFiles: context.workspaceFiles,
  })
  reuse.graphs.push({ packagesContext: context.packagesContext, projectRoot, workspaceFiles, testEntry, graph })
  return graph
}

/** validateBatchTypes replays AST-only type reports where the ordinary type pass would run. */
function validateBatchTypes(
  file: AST.TaoFile,
  nodes: readonly AST.Node[],
  ctx: ValidationContext,
  reuse: BatchReuse,
  effects: ASTUtils.AssociatedEffectsContext,
): void {
  let types = reuse.types.get(ctx.packagesContext)
  if (!types) {
    types = new Map()
    reuse.types.set(ctx.packagesContext, types)
  }
  let reports = types.get(file)
  if (!reports) {
    const collected: TypeReport[] = []
    Validate.Types(file, nodes, {
      ...ctx,
      error: (node, message, opts) => collected.push(context => context.error(node, message, opts)),
      warning: (node, message, opts) => collected.push(context => context.warning(node, message, opts)),
      hint: (node, message, opts) => collected.push(context => context.hint(node, message, opts)),
    }, effects)
    reports = collected
    types.set(file, reports)
  }
  for (const report of reports) {
    report(ctx)
  }
}

/** validateParseResult validates an existing parse result. */
async function validateParseResult(
  parseResult: ParseResult,
  context: ValidationRunContext,
  reuse?: BatchReuse,
  documents?: DocumentReuseState,
  activeVariants?: Set<DocumentVariant>,
  snapshots?: Map<string, PreviewValidationSnapshot>,
  experimentalChangedPaths?: readonly string[],
): Promise<ValidationResult> {
  if (Diagnostics.hasError(parseResult.diagnostics, 'lexer', 'parser')) {
    return validationResultFromParse(parseResult, parseResult.diagnostics)
  }

  // Linker errors don't gate structural validation: the AST shape is intact and
  // validators tolerate unresolved references.
  const validationDiagnostics = Validation.collectDiagnostics()
  const ctx = Validation.createContext(validationDiagnostics.accept, {
    releaseProfile: context.releaseProfile,
    entryFilePath: context.entryFilePath,
    packagesContext: context.packagesContext,
    workspaceFiles: context.workspaceFiles,
    ...(reuse === undefined ? {} : { appMemo: reuse.apps }),
    ...(reuse === undefined ? {} : { nodesInFile: (file: AST.TaoFile) => batchNodes(file, reuse) }),
    ...(reuse === undefined ? {} : { requirementGraph: () => sharedRequirementGraph(context, reuse) }),
    ...(context.projectFiles === undefined ? {} : { projectFiles: context.projectFiles }),
  })
  validatePackageWorkspace(ctx)
  const associatedEffects = ASTUtils.createAssociatedEffects(context.workspaceFiles)
  const profile = Platform.runtimeProcess.env['TAO_STUDIO_PREVIEW_PROFILE'] === 'true'
  const phases = { structural: 0, types: 0, foreign: 0 }
  const contextKey = documents ? documentContextKey(context) : undefined
  const snapshotKey = documentContextKey(context)
  const previousSnapshot = snapshots?.get(snapshotKey)
  const changed = new Set(experimentalChangedPaths)
  // These observations include transitive references, import candidates, package boundaries
  // and project-wide structural inputs. An unchanged AST alone cannot authorize replay.
  const dependencies = new Map<AST.TaoFile, DocumentVariant['dependencies']>()
  if (snapshots !== undefined) {
    for (const file of context.workspaceFiles) {
      const observed = Parser.validationDependencies(file)
      if (observed) {
        dependencies.set(file, observed)
      }
    }
  }
  const workspacePaths = new Set(context.workspaceFiles.map(file => AST.getDocument(file).uri.path))
  const selective = experimentalChangedPaths !== undefined
    && changed.size > 0
    && dependencies.size === context.workspaceFiles.length
    && previousSnapshot?.dependencies.size === context.workspaceFiles.length
    && [...changed].every(path => workspacePaths.has(path))
    && previousSnapshot?.packagesContext === context.packagesContext
    && previousSnapshot.files.length === context.workspaceFiles.length
    // Entire-file reports also include workspace-global commands and navigation render sites.
    // The reference graph does not certify those reverse/global inputs across package roots:
    // until those reports are partitioned, every workspace input must remain identical.
    && context.workspaceFiles.every((file, index) => {
      const previousDependencies = previousSnapshot.dependencies.get(file)
      const currentDependencies = dependencies.get(file)
      return previousSnapshot.files[index] === file && previousDependencies !== undefined
        && currentDependencies !== undefined && sameValidationDependencies(previousDependencies, currentDependencies)
    })
  const completed = new Map<AST.TaoFile, readonly Diagnostic[]>()
  const completedDiagnostics = [...validationDiagnostics.diagnostics]
  let validatedFiles = 0
  let reusedFiles = 0
  for (const file of context.workspaceFiles) {
    const previousDependencies = previousSnapshot?.dependencies.get(file)
    const currentDependencies = dependencies.get(file)
    const previousDiagnostics = selective && !changed.has(AST.getDocument(file).uri.path)
        && previousDependencies && currentDependencies
        && sameValidationDependencies(previousDependencies, currentDependencies)
      ? previousSnapshot?.diagnostics.get(file)
      : undefined
    if (previousDiagnostics !== undefined) {
      // Skipping a document must not evict its ordinary guarded cache before the full pass.
      for (const variant of documents?.get(AST.getDocument(file).uri.path) ?? []) {
        if (variant.file === file && variant.contextKey === snapshotKey) {
          activeVariants?.add(variant)
        }
      }
      completedDiagnostics.push(...previousDiagnostics)
      completed.set(file, previousDiagnostics)
      reusedFiles++
      continue
    }
    validatedFiles++
    const diagnosticStart = validationDiagnostics.diagnostics.length
    const document = documents ? documentVariant(file, context, documents, contextKey!) : undefined
    if (document) {
      activeVariants?.add(document)
    }
    const startedAt = profile ? performance.now() : 0
    const nodes = reuse
      ? Type.withInferenceMemo(
        reuse.inference,
        () => Validate.TaoFile(file, ctx, associatedEffects, document && structuralReuse(document.reports, ctx)),
      )
      : Validate.TaoFile(file, ctx, associatedEffects)
    const structuralAt = profile ? performance.now() : 0
    if (document) {
      if (!document.reports.types) {
        document.reports.types = Type.withInferenceMemo(
          reuse!.inference,
          () => captureReports(context => validateBatchTypes(file, nodes, context, reuse!, associatedEffects), ctx),
        )
      }
      replayReports(document.reports.types, ctx)
    } else if (reuse) {
      Type.withInferenceMemo(reuse.inference, () => validateBatchTypes(file, nodes, ctx, reuse, associatedEffects))
    } else {
      Validate.Types(file, nodes, ctx, associatedEffects)
    }
    const typesAt = profile ? performance.now() : 0
    await Validate.ForeignImplementationFiles(file, ctx)
    const fileDiagnostics = validationDiagnostics.diagnostics.slice(diagnosticStart)
    completed.set(file, fileDiagnostics)
    completedDiagnostics.push(...fileDiagnostics)
    if (profile) {
      phases.structural += structuralAt - startedAt
      phases.types += typesAt - structuralAt
      phases.foreign += performance.now() - typesAt
    }
  }
  if (profile) {
    HCI.logProcessInfo(
      'validator',
      JSON.stringify({
        type: 'studio-validator-profile',
        entry: context.entryFilePath,
        files: context.workspaceFiles.length,
        validatedFiles,
        reusedFiles,
        phases,
      }),
    )
  }

  // Only full passes refresh the authoritative snapshot; fast attempts never seed another fast attempt.
  if (!selective) {
    snapshots?.set(snapshotKey, {
      packagesContext: context.packagesContext,
      files: [...context.workspaceFiles],
      diagnostics: completed,
      dependencies,
    })
  }
  return {
    ...validationResultFromParse(parseResult, [...parseResult.diagnostics, ...completedDiagnostics]),
    associatedEffects,
  }
}

/**
 * createSession creates caller-owned standalone services for batch validation.
 *
 * The package context and language services live for as long as the returned
 * session is referenced. Create a new session when its package context changes;
 * source text alone does not invalidate it because each call replaces the
 * synthetic Langium document.
 */
async function createSession(
  packagesContext?: Packages.Context,
  releaseProfile: ReleaseProfile = ReleaseCapabilities.current(),
): Promise<ValidatorSession> {
  const sharedPackagesContext = packagesContext ?? await Packages.createContext(codeProjectRoot)
  const parserContext = Parser.createContext({
    packages: Packages.createResolver(sharedPackagesContext),
  })

  // Langium's document builder mutates the session document store. Serialize
  // callers so a batch can safely share the synthetic source URI.
  let pending = Promise.resolve()
  return {
    validateCode(code: string): Promise<ValidationResult> {
      const result = pending.then(async () => {
        const parseResult = await Parser.parseSource(parserContext, code, { validation: false })
        return validateParseResult(
          parseResult,
          createContext(
            sharedPackagesContext,
            parseResult.files.map(file => file.ast),
            parseResult.entry.path,
            undefined,
            releaseProfile,
          ),
        )
      })
      pending = result.then(() => undefined, () => undefined)
      return result
    },
  }
}

/** validateCode validates Tao source code using fresh standalone services. */
async function validateCode(
  code: string,
  releaseProfile: ReleaseProfile = ReleaseCapabilities.current(),
): Promise<ValidationResult> {
  return await (await createSession(undefined, releaseProfile)).validateCode(code)
}

/** releaseDiagnostics always applies eligibility, including compiler paths that already validated types. */
function releaseDiagnostics(context: ValidationRunContext): readonly Diagnostic[] {
  const collector = Validation.collectDiagnostics()
  const ctx = Validation.createContext(collector.accept, context)
  for (const file of context.workspaceFiles) {
    validateReleaseCapabilities(file, ctx)
  }
  return collector.diagnostics
}

/** Validator exposes Tao source validation functions. */
const Validator = {
  createContext,
  createDocumentReuse,
  createSession,
  releaseDiagnostics,
  installLangiumChecks,
  validateCode,
  validateParseResult,
  validateParseResults,
}

namespace Validator {
  /** Context declares the shared workspace state required by validation. */
  export type Context = ValidationRunContext
}

export default Validator

function validationResultFromParse(
  parseResult: ParseResult,
  diagnostics: readonly Diagnostic[],
): ValidationResult {
  return {
    entry: parseResult.entry,
    files: parseResult.files,
    diagnostics,
  }
}
