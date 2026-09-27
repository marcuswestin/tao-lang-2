import { ASTUtils, Packages, Type } from '@ast-utils'
import { AST, codeProjectRoot, type ParsedFile } from '@parser'
import { Assert, Diagnostics, Errors, FS } from '@shared'
import Validator, { type ValidationResult } from '@validator'
import { designValidationCodes } from '@validator/diagnostic-codes'
import { authPolicy } from './auth-policy'
import { BridgeMetadata } from './bridge-metadata'
import { withActionInstrumentation } from './codegen/app/action-control-flow'
import {
  configurationAliasTargetTypeBindingName,
  configurationRuntimeBindingName,
  configurationSidecarBindingName,
  isRuntimeConfigurableDeclaration,
  isTransparentConfigurableAlias,
} from './codegen/app/ConfigurationCompiler'
import { withDataStorePlan } from './codegen/app/data-store-context'
import {
  type DeclarationIdentityProject,
  withDeclarationIdentityContext,
} from './codegen/app/declaration-identity'
import {
  bridgeBindingName,
  bridgedExpressionsOf,
  bridgeExportName,
  foreignActionBindingName,
  foreignActionsOf,
  foreignViewBindingName,
  foreignViewsOf,
  type InlineInjection,
  inlineInjectionsOf,
  withInlineInjectionBindings,
} from './codegen/app/injection-plan'
import { RuntimeGen } from './codegen/app/RuntimeGen'
import { LocalDataBindings, ReadNetBinding } from './codegen/codegen-util'
import { storedDataSchemaFile, storedDataSchemas } from './stored-data-schema'
import {
  compileStudioPreviewManifest,
  type StudioPreviewManifest,
  studioPreviewManifestModule,
} from './studio-preview-manifest'
import { compileTestPlan, type TaoTestPlan } from './test-plan-compiler'

const compiledSourceOutputPathMessage = 'compiled source output path exists'
// `local only` entities live in a second emitted catalog with its own connection and storage key.
// The compiler binds it to the stdlib Local provider, which the source never names, so the owner
// module imports that provider as a sidecar exactly as a declared datasource would.
const localProviderStdlibPath = '@tao/data/providers/local/Local.ts'
const localProviderExportName = 'LocalProvider'
/** The companion catalog's bindings travel together: its schema and the datasource an app mounts. */
const localCatalogBindings = [LocalDataBindings.catalog, LocalDataBindings.datasource] as const

/** CompiledFile declares one generated TypeScript output file. */
export type CompiledFile = {
  sourcePath: string
  relativePath: string
  code: string
}

type ResolvedImports = {
  bySource: Map<string, Set<string>>
  scopeBindings: Map<string, string>
}

/** ImportTarget is one workspace file an import path reaches, and what it may name in it. */
type ImportTarget = {
  declarationsNamed: (name: string) => AST.Declaration[]
  path: string
}

type DataCatalogPlan = {
  entities: readonly AST.EntityDataDeclaration[]
  access: readonly AST.AccessDeclaration[]
  /** localOnly is whether any entity carries the `local only` storage fact, which adds a catalog. */
  localOnly: boolean
  /** localUserPaths are the files that reference the companion catalog's bindings. */
  localUserPaths: ReadonlySet<string>
  ownerPath: string
  /** stores is the project's partition: one emitted schema per store the datasources declare. */
  stores: ASTUtils.DataStorePlan
  userPaths: ReadonlySet<string>
}

type PlannedSidecarCopy = {
  sourcePath: string
  relativePath: string
}

type PlannedSidecar = PlannedSidecarCopy & {
  binding: string
  exportName: string
}

type PlannedSourceOutputs = {
  injections: PlannedInjection[]
  modulePath: string
  declarationsPath?: string
  sidecars: PlannedSidecar[]
  sidecarCopies: PlannedSidecarCopy[]
}

type PlannedInjection = {
  binding: string
  node: InlineInjection
  relativePath: string
}

type PlannedOutputs = {
  bySourcePath: ReadonlyMap<string, PlannedSourceOutputs>
  modulePathBySourcePath: ReadonlyMap<string, string>
}

/** CompileResult declares generated output for a Tao app entry. */
export type CompileResult = {
  appNames: string[]
  validation: ValidationResult
  code: string
  files: CompiledFile[]
  studioManifest?: StudioPreviewManifest
}

export type CompileOptions = {
  appName?: string
  /** appDatasourceConfiguration replaces selected-app datasource slots for a derived release host. */
  appDatasourceConfiguration?: Readonly<Record<string, string>>
  /** studio emits preview-only render occurrence metadata into generated Tao props. */
  studio?: boolean
  /** journeyObservations emits test-harness-only render locators into generated Tao props. */
  journeyObservations?: boolean
  /** debug instruments every action statement with a debugger gate. */
  debug?: boolean
  /** release promotes only stable release-gate diagnostics; ordinary development warnings stay non-blocking. */
  validationMode?: 'development' | 'release'
}

/** CompilerSession reuses standalone validation and package state across source strings. */
export type CompilerSession = {
  compileCode(code: string, options?: CompileOptions): Promise<CompileResult>
}

/** CompilerContext declares shared compiler invocation state. */
export type CompilerContext = {
  packagesContext: Packages.Context
  sourceRoot: string
}

/** createContext creates compiler invocation state. */
function createContext(packagesContext: Packages.Context, sourceRoot: string): CompilerContext {
  return { packagesContext, sourceRoot }
}

/**
 * createSession creates caller-owned standalone services for batch compilation.
 * The package, parser, and type state lives for as long as the returned session
 * is referenced; source text alone does not invalidate it.
 */
async function createSession(): Promise<CompilerSession> {
  const packagesContext = await Packages.createContext(codeProjectRoot)
  const validatorSession = await Validator.createSession(packagesContext)
  const compilerContext = createContext(packagesContext, codeProjectRoot)

  // Validation mutates the shared Langium document store, while compilation
  // still reads the resulting AST. Keep the whole pipeline serialized so a
  // later parse cannot invalidate documents that an earlier compile is using.
  let pending = Promise.resolve()
  return {
    compileCode(code: string, options: CompileOptions = {}): Promise<CompileResult> {
      const result = pending.then(async () =>
        compileValidated(await validatorSession.validateCode(code), compilerContext, options)
      )
      pending = result.then(() => undefined, () => undefined)
      return result
    },
  }
}

/** compileCode compiles Tao source code using fresh standalone services. */
async function compileCode(code: string, options: CompileOptions = {}): Promise<CompileResult> {
  return await (await createSession()).compileCode(code, options)
}

/** compileValidated compiles an already validated Tao app into Expo-compatible TSX source. */
function compileValidated(
  validationResult: ValidationResult,
  context: CompilerContext,
  options: CompileOptions = {},
): CompileResult {
  validationResult = validationForCompileMode(validationResult, options.validationMode ?? 'development')
  const errors = Diagnostics.errorMessages(validationResult.diagnostics)
  Assert(errors.length === 0, `Cannot compile Tao source with validation errors: ${errors.join('; ')}`, {
    diagnostics: Diagnostics.errors(validationResult.diagnostics),
    errors,
  })
  const apps = validationResult.files.flatMap(file =>
    AST.appValueDeclarationsInFile(file.ast).map(app => ({ app, path: file.path }))
  )
  Assert(apps.length > 0, 'Cannot compile app graph: no app declaration is reachable from the entry file.')
  const entryApps = apps.filter(candidate => candidate.path === validationResult.entry.path)
  const namedApps = options.appName === undefined
    ? []
    : apps.filter(candidate => candidate.app.name === options.appName)
  const selected = options.appName === undefined
    ? (entryApps.length === 1 ? entryApps[0] : apps.length === 1 ? apps[0] : undefined)
    : (entryApps.find(candidate => candidate.app.name === options.appName)
      ?? (namedApps.length === 1 ? namedApps[0] : undefined))
  const appNames = apps.map(candidate => candidate.app.name)
  Assert.defined(
    selected,
    options.appName === undefined
      ? `Cannot compile app graph with multiple apps without a selection. Available apps: ${appNames.join(', ')}.`
      : namedApps.length > 1
      ? `Cannot compile ambiguous app '${options.appName}'. Select its declaring Tao file as the entry.`
      : `Cannot compile unknown app '${options.appName}'. Available apps: ${appNames.join(', ')}.`,
  )
  return compileValidatedInput(validationResult, context, selected.app.name, selected.path, options)
}

function validationForCompileMode(
  validationResult: ValidationResult,
  mode: NonNullable<CompileOptions['validationMode']>,
): ValidationResult {
  if (mode !== 'release') {
    return validationResult
  }
  return {
    ...validationResult,
    diagnostics: validationResult.diagnostics.map(diagnostic =>
      diagnostic.code === designValidationCodes.exploration
        ? { ...diagnostic, severity: 'error' as const }
        : diagnostic
    ),
  }
}

/** Compiler exposes Tao source compilation functions. */
const Compiler = {
  createContext,
  createSession,
  compileCode,
  compileStudioPreviewManifest,
  compileTestPlan,
  compileValidated,
} as const

namespace Compiler {
  /** Context declares compiler invocation state. */
  export type Context = CompilerContext
  /** TestPlan declares compiled Tao v0 test-plan IR. */
  export type TestPlan = TaoTestPlan
}

export default Compiler

function compileValidatedInput(
  validationResult: ValidationResult,
  context: CompilerContext,
  selectedAppName: string,
  selectedAppPath: string,
  options: CompileOptions,
): CompileResult {
  const studio = options.studio === true
  const journeyObservations = options.journeyObservations === true
  const entryPath = validationResult.entry.path
  const sourceFiles = validationResult.files.filter(file =>
    file.ast.statements.length === 0
    || !file.ast.statements.every(statement =>
      AST.isPrimitiveDeclaration(statement) || AST.isProjectDeclaration(statement)
    )
  )
  const identityProjects = declarationIdentityProjects(validationResult.files, context)
  const sourceByPath = new Map(sourceFiles.map(file => [file.path, file]))
  const dataCatalog = planDataCatalog(sourceFiles, entryPath)
  // Validation allows one `guard default` per project, and every app in the project carries it.
  const readNetOwnerPath = sourceFiles.find(file => file.ast.statements.some(AST.isGuardDefaultStatement))?.path
  const studioViews = studio
    ? sourceFiles.flatMap(file =>
      file.ast.statements.filter(AST.isScenarioGroupDeclaration).flatMap(group =>
        AST.scenarioDeclarations(group).flatMap(scenario => {
          const subject = AST.scenarioSubjectDeclaration(scenario)
          return AST.isViewDeclaration(subject)
            ? [{ id: `${AST.getDocument(subject).uri.fsPath}#${subject.name}`, view: subject }]
            : []
        })
      )
    )
    : []
  const outputPaths = planOutputPaths(sourceFiles, selectedAppPath, context.sourceRoot, {
    localDataProvider: dataCatalog?.localOnly
      ? {
        ownerPath: dataCatalog.ownerPath,
        sourcePath: FS.resolvePath(localProviderStdlibPath, context.packagesContext.stdlibRoot),
      }
      : undefined,
  })
  const compiledFiles = sourceFiles.flatMap(file =>
    compileSourceFile(file, {
      dataCatalog,
      readNetOwnerPath,
      sourceByPath,
      outputPaths,
      packagesContext: context.packagesContext,
      identityProjects,
      projectRoot: context.sourceRoot,
      selectedAppDatasourceConfiguration: options.appDatasourceConfiguration,
      selectedAppName: file.path === selectedAppPath ? selectedAppName : undefined,
      journeyObservations,
      studio,
      studioViews,
      debug: options.debug === true,
    })
  )

  if (dataCatalog?.access.length) {
    compiledFiles.push({
      relativePath: 'TaoDataPolicy.json',
      sourcePath: entryPath,
      code: JSON.stringify(authPolicy(dataCatalog.entities, dataCatalog.access), null, 2),
    })
  }
  const storedSchemas = dataCatalog === undefined ? undefined : storedDataSchemas(dataCatalog.stores)
  if (storedSchemas !== undefined && Object.keys(storedSchemas.stores).length > 0) {
    compiledFiles.push({
      relativePath: storedDataSchemaFile,
      sourcePath: entryPath,
      code: JSON.stringify(storedSchemas, null, 2),
    })
  }

  const studioManifest = studio
    ? compileStudioPreviewManifest(
      sourceFiles.filter(file => !FS.pathIsWithin(file.path, context.packagesContext.stdlibRoot)),
      selectedAppName,
      context.sourceRoot,
    )
    : undefined
  if (studioManifest !== undefined) {
    compiledFiles.push({
      code: studioPreviewManifestModule(studioManifest),
      relativePath: 'TaoStudioManifest.ts',
      sourcePath: entryPath,
    })
  }

  return {
    ...compileResultForApp(validationResult, compiledFiles, selectedAppPath),
    ...(studioManifest === undefined ? {} : { studioManifest }),
  }
}

/** PlanOutputPathsOptions carries sidecars the compiler owns rather than a source file naming them. */
type PlanOutputPathsOptions = {
  localDataProvider?: { ownerPath: string; sourcePath: string }
}

function planOutputPaths(
  sourceFiles: readonly ParsedFile[],
  entryPath: string,
  sourceRoot: string,
  options: PlanOutputPathsOptions = {},
): PlannedOutputs {
  // Basename buckets in moduleOutputPath can collide across distinct sources;
  // suffix deterministically instead of silently overwriting generated files.
  const modulePathBySourcePath = new Map<string, string>()
  const usedOutputPaths = new Set<string>()
  for (const file of sourceFiles) {
    const preferredPath = file.path === entryPath ? 'App.tsx' : moduleOutputPath(file.path, entryPath, sourceRoot)
    modulePathBySourcePath.set(file.path, reserveModuleOutputPath(file, preferredPath, usedOutputPaths))
  }

  const bySourcePath = new Map<string, PlannedSourceOutputs>()
  // One foreign implementation file is one module, however many Tao files name it. The map spans
  // every file so the second namer imports the first one's copy instead of getting a second copy,
  // whose module-level state would be a separate instance of the same source at runtime.
  const sidecarPathBySourcePath = new Map<string, string>()
  for (const file of sourceFiles) {
    const modulePath = modulePathBySourcePath.get(file.path)
    Assert.defined(modulePath, compiledSourceOutputPathMessage, { sourcePath: file.path })
    const injections = inlineInjectionsOf(file.ast).map((node, index) => ({
      // Bindings are local to this generated module. An inherited implementation may be owned
      // by another Tao file, whose own ordinal must not collide with this file's injections.
      binding: `__tao_injection_${index + 1}__`,
      node,
      relativePath: reserveOutputPath(
        outputPathInDirectory(
          outputDirectory(modulePath),
          `${FS.basename(modulePath, FS.extname(modulePath))}.injection-${index + 1}.tsx`,
        ),
        usedOutputPaths,
      ),
    }))
    const declarations = file.ast.statements.filter(isRuntimeConfigurableDeclaration)
    const companionDirectory = declarations.length === 0
      ? outputDirectory(modulePath)
      : companionOutputDirectory(file.path, modulePath, usedOutputPaths)
    const declarationsPath = declarations.length === 0
      ? undefined
      : reserveOutputPath(
        outputPathInDirectory(companionDirectory, `${FS.basename(file.path)}.d.ts`),
        usedOutputPaths,
      )
    const sidecarCopies: PlannedSidecarCopy[] = []
    // A sidecar is named relative to the file that declares it, which an imported file may own, so
    // every path resolves against its own declaring document rather than this one.
    const planSidecar = (node: AST.Node, path: string, exportName: string, binding: string): PlannedSidecar => {
      const sourcePath = FS.resolvePath(path, FS.dirname(AST.getDocument(node).uri.path))
      let relativePath = sidecarPathBySourcePath.get(sourcePath)
      if (relativePath === undefined) {
        const graph = sidecarSourceGraph(sourcePath)
        const plannedGraph = planSidecarGraphOutputs(
          graph,
          sourcePath,
          companionDirectory,
          usedOutputPaths,
        )
        relativePath = plannedGraph.get(sourcePath)
        Assert.defined(relativePath, 'planned sidecar graph contains its root', { sourcePath })
        sidecarCopies.push(...[...plannedGraph].map(([graphSourcePath, graphRelativePath]) => ({
          relativePath: graphRelativePath,
          sourcePath: graphSourcePath,
        })))
        sidecarPathBySourcePath.set(sourcePath, relativePath)
      }
      return { binding, exportName, sourcePath, relativePath }
    }
    const sidecars = [
      ...declarations.flatMap(declaration => {
        if (isTransparentConfigurableAlias(declaration)) {
          return []
        }
        const implementation = AST.configurationImplementationOf(declaration)
        const sidecarPath = implementation?.path
        return implementation === undefined || sidecarPath === undefined
          ? []
          : [planSidecar(
            implementation,
            sidecarPath,
            implementation.exportName,
            configurationSidecarBindingName(declaration),
          )]
      }),
      ...bridgedExpressionsOf(file.ast).map(bridge =>
        planSidecar(bridge, bridge.path, bridgeExportName(bridge), bridgeBindingName(bridge))
      ),
      ...foreignViewsOf(file.ast).map(view => {
        const foreign = view.foreign
        Assert.defined(foreign, 'planned foreign view has a sidecar implementation')
        return planSidecar(view, foreign.path, view.name, foreignViewBindingName(view))
      }),
      ...foreignActionsOf(file.ast).map(action => {
        const foreign = action.foreign
        Assert.defined(foreign, 'planned foreign action has a sidecar implementation')
        return planSidecar(action, foreign.path, action.name, foreignActionBindingName(action))
      }),
      ...(options.localDataProvider?.ownerPath === file.path
        ? [planSidecar(
          file.ast,
          options.localDataProvider.sourcePath,
          localProviderExportName,
          LocalDataBindings.provider,
        )]
        : []),
    ]
    bySourcePath.set(file.path, { injections, modulePath, declarationsPath, sidecars, sidecarCopies })
  }
  return { bySourcePath, modulePathBySourcePath }
}

type CompileSourceFileOptions = {
  dataCatalog: DataCatalogPlan | undefined
  /** readNetOwnerPath is the file declaring the project's `guard default`, when there is one. */
  readNetOwnerPath: string | undefined
  sourceByPath: Map<string, ParsedFile>
  outputPaths: PlannedOutputs
  packagesContext: Packages.Context
  identityProjects: readonly DeclarationIdentityProject[]
  projectRoot: string
  selectedAppDatasourceConfiguration?: Readonly<Record<string, string>>
  selectedAppName: string | undefined
  journeyObservations: boolean
  studio: boolean
  studioViews: ReadonlyArray<{ id: string; view: AST.ViewDeclaration }>
  debug: boolean
}

function compileSourceFile(file: ParsedFile, options: CompileSourceFileOptions): CompiledFile[] {
  const {
    dataCatalog,
    readNetOwnerPath,
    sourceByPath,
    outputPaths,
    packagesContext,
    identityProjects,
    projectRoot,
    selectedAppDatasourceConfiguration,
    selectedAppName,
    journeyObservations,
    studio,
    studioViews,
    debug,
  } = options
  const imports = resolveImports(file.path, file.ast, sourceByPath, packagesContext)
  const ownsDataCatalog = dataCatalog?.ownerPath === file.path
  const needsStudioDataCatalog = studio && selectedAppName !== undefined && dataCatalog !== undefined
  // A studio preview renders any view of the app, so its root reads the catalog whether or not
  // this file names a query of its own.
  const readsCatalogRows = dataCatalog !== undefined
    && (dataCatalog.userPaths.has(file.path) || needsStudioDataCatalog)
  if (dataCatalog && !ownsDataCatalog && readsCatalogRows) {
    for (const binding of syncedCatalogBindings(dataCatalog)) {
      addResolvedImport(imports, dataCatalog.ownerPath, binding)
    }
  }
  if (studio && selectedAppName !== undefined) {
    for (const item of studioViews) {
      const ownerPath = AST.getDocument(item.view).uri.fsPath
      if (ownerPath !== file.path && !imports.bySource.has(ownerPath)) {
        imports.bySource.set(ownerPath, new Set())
      }
    }
  }
  // The companion bindings reach further than the synced catalog's: every app root binds them,
  // including an app that configures no Datasource of its own. Both travel together, because a
  // catalog user reads the local schema and an app root binds its datasource.
  const usesLocalDataCatalog = dataCatalog?.localOnly === true
    && (ownsDataCatalog || dataCatalog.localUserPaths.has(file.path))
  if (usesLocalDataCatalog && !ownsDataCatalog) {
    for (const binding of localCatalogBindings) {
      addResolvedImport(imports, dataCatalog.ownerPath, binding)
    }
  }
  // Every app carries the project's read net, so a module declaring an app reads it from its owner.
  const ownsReadNet = readNetOwnerPath === file.path
  if (
    readNetOwnerPath !== undefined && !ownsReadNet && AST.appValueDeclarationsInFile(file.ast).length > 0
  ) {
    addResolvedImport(imports, readNetOwnerPath, ReadNetBinding)
  }
  const planned = outputPaths.bySourcePath.get(file.path)
  Assert.defined(planned, compiledSourceOutputPathMessage, { sourcePath: file.path })
  const importLines = [
    ...importLinesForCompiledFile(imports, planned.modulePath, outputPaths.modulePathBySourcePath),
    ...configurationAliasImportLines(file, planned.modulePath, outputPaths),
    ...planned.injections.map(injection =>
      `import ${injection.binding} from '${relativeImportPath(planned.modulePath, injection.relativePath)}'`
    ),
    ...planned.sidecars.map(sidecar =>
      `import { ${sidecar.exportName} as ${sidecar.binding} } from '${
        relativeImportPath(planned.modulePath, sidecar.relativePath)
      }'`
    ),
  ]
  const scopeBindings = [...imports.scopeBindings].map(([binding, imported]) =>
    `TR.Use(_Scope, '${binding}', () => ${imported})`
  )
  const exportedBindings = file.ast.statements
    .filter(AST.isExportableDeclaration)
    .filter(declarationEmitsRuntimeBinding)
    .filter(declarationVisibleOutsideFile)
    .map((declaration: AST.Declaration) => exportedBinding(runtimeBindingName(declaration)))
  if (ownsReadNet) {
    exportedBindings.push(exportedBinding(ReadNetBinding))
  }
  if (ownsDataCatalog) {
    exportedBindings.push(...syncedCatalogBindings(dataCatalog).map(exportedBinding))
    if (dataCatalog.localOnly) {
      exportedBindings.push(...localCatalogBindings.map(exportedBinding))
    }
  }

  const emitted = (relativePath: string, code: string): CompiledFile => ({ code, relativePath, sourcePath: file.path })
  const module = emitted(
    planned.modulePath,
    withDataStorePlan(
      dataCatalog?.stores,
      () =>
        withDeclarationIdentityContext(identityProjects, () =>
          withInlineInjectionBindings(
            new Map(planned.injections.map(injection => [injection.node, injection.binding])),
            () =>
              withActionInstrumentation(debug, () =>
                RuntimeGen.TaoFile(file.ast, {
                  bridgeTypes: BridgeMetadata.typesFor(file.ast),
                  configurationTypes: planned.declarationsPath === undefined
                    ? undefined
                    : RuntimeGen.ConfigurationTypes(file.ast),
                  dataEntities: ownsDataCatalog ? dataCatalog.entities : [],
                  dataAccess: ownsDataCatalog ? dataCatalog.access : [],
                  emitDataCatalog: ownsDataCatalog,
                  importLines,
                  localDataCatalog: usesLocalDataCatalog,
                  journeyObservations,
                  readNet: readNetOwnerPath !== undefined,
                  scopeBindings,
                  exportedBindings,
                  selectedAppDatasourceConfiguration,
                  selectedAppName,
                  projectRoot,
                  studioDataCatalog: studio && dataCatalog !== undefined && (ownsDataCatalog || needsStudioDataCatalog),
                  studio,
                  debug,
                  studioViews: studio && selectedAppName !== undefined ? studioViews : [],
                  viewRegistrations: RuntimeGen.ViewRegistrations(file.ast, { studio }),
                })),
          )),
    ),
  )
  const declarationsPath = planned.declarationsPath
  const declarations = declarationsPath === undefined ? [] : [emitted(
    declarationsPath,
    RuntimeGen.ConfigurationDeclarations(
      file.ast,
      configurationAliasImportLines(file, declarationsPath, outputPaths),
      BridgeMetadata.typesFor(file.ast),
    ),
  )]
  const injections = planned.injections.map(injection =>
    emitted(injection.relativePath, RuntimeGen.InjectionBoundary(injection.node))
  )
  const copiedSidecars = new Map<string, CompiledFile>()
  for (const sidecar of planned.sidecarCopies) {
    // A synthetic in-memory source has no directory to copy from. Real compiles still assert,
    // which is what catches a missing sidecar before emitting an import of it.
    if (!FS.existsSync(FS.dirname(sidecar.sourcePath))) {
      continue
    }
    Assert(FS.existsSync(sidecar.sourcePath), 'validated sidecar exists', {
      sourcePath: sidecar.sourcePath,
    })
    copiedSidecars.set(sidecar.relativePath, {
      ...sidecar,
      code: rewriteSidecarTaoImports(
        FS.readTextSync(sidecar.sourcePath),
        sidecar.sourcePath,
        sidecar.relativePath,
        outputPaths,
      ),
    })
  }
  return [module, ...injections, ...declarations, ...copiedSidecars.values()]
}

const sidecarModuleExtensions = ['.ts', '.tsx', '.js', '.jsx', '.json'] as const

/** sidecarSourceGraph follows authored relative module edges while leaving package imports installed. */
function sidecarSourceGraph(rootPath: string): readonly string[] {
  if (!FS.existsSync(rootPath)) {
    return [rootPath]
  }
  const graph: string[] = []
  const visited = new Set<string>()
  const visit = (sourcePath: string): void => {
    if (visited.has(sourcePath)) {
      return
    }
    visited.add(sourcePath)
    graph.push(sourcePath)
    const source = FS.readTextSync(sourcePath)
    for (const specifier of relativeModuleSpecifiers(source)) {
      if (specifier.value.endsWith('.tao')) {
        continue
      }
      const dependency = resolveRelativeSidecarImport(sourcePath, specifier.value)
      if (dependency === undefined) {
        const message = `Sidecar relative import '${specifier.value}' could not be resolved.`
        Errors.throwUserInput(message, {
          diagnostics: [{
            filePath: sourcePath,
            message,
            range: sidecarSourceRange(source, specifier.start, specifier.end),
            severity: 'error',
            source: 'compiler',
          }],
        })
      }
      visit(dependency)
    }
  }
  visit(rootPath)
  return graph
}

type SidecarToken = Readonly<{
  end: number
  kind: 'identifier' | 'punctuation' | 'string'
  start: number
  value: string
}>

type SidecarSpecifier = Readonly<{ end: number; start: number; value: string }>

/** Covers imports, re-exports, side-effect imports, and dynamic import calls without false comment/string edges. */
function relativeModuleSpecifiers(source: string): SidecarSpecifier[] {
  const tokens = sidecarTokens(source)
  const specifiers: SidecarSpecifier[] = []
  const add = (token: SidecarToken | undefined): void => {
    if (token?.kind === 'string' && (token.value.startsWith('./') || token.value.startsWith('../'))) {
      specifiers.push({ end: token.end, start: token.start, value: token.value })
    }
  }
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (!isModuleKeyword(token)) {
      continue
    }
    const next = tokens[index + 1]
    if (token.value === 'import' && next?.value === '(') {
      add(tokens[index + 2])
      continue
    }
    if (token.value === 'import' && next?.kind === 'string') {
      add(next)
      continue
    }
    for (let cursor = index + 1; cursor < tokens.length; cursor++) {
      const candidate = tokens[cursor]
      if (candidate?.value === ';' || candidate?.value === 'import' || candidate?.value === 'export') {
        break
      }
      if (candidate?.kind === 'identifier' && candidate.value === 'from') {
        add(tokens[cursor + 1])
        break
      }
    }
  }
  const firstByValue = new Map<string, SidecarSpecifier>()
  for (const specifier of specifiers) {
    if (!firstByValue.has(specifier.value)) {
      firstByValue.set(specifier.value, specifier)
    }
  }
  return [...firstByValue.values()]
}

/** isModuleKeyword identifies the keyword that can begin a module specifier: `import` or `export`. */
function isModuleKeyword(token: SidecarToken | undefined): token is SidecarToken {
  return token?.kind === 'identifier' && (token.value === 'import' || token.value === 'export')
}

function sidecarSourceRange(source: string, start: number, end: number): {
  start: { line: number; character: number }
  end: { line: number; character: number }
} {
  const position = (offset: number) => {
    const prefix = source.slice(0, offset)
    const lines = prefix.split('\n')
    return { line: lines.length - 1, character: lines.at(-1)?.length ?? 0 }
  }
  return { start: position(start), end: position(end) }
}

/** sidecarTokens is a deliberately small JS/TS lexical scanner; comments and literal bodies never become code. */
function sidecarTokens(source: string): SidecarToken[] {
  const tokens: SidecarToken[] = []
  for (let index = 0; index < source.length;) {
    const current = source[index]!
    const next = source[index + 1]
    if (/\s/.test(current)) {
      index += 1
      continue
    }
    if (current === '/' && next === '/') {
      index = source.indexOf('\n', index + 2)
      if (index < 0) {
        break
      }
      continue
    }
    if (current === '/' && next === '*') {
      const close = source.indexOf('*/', index + 2)
      index = close < 0 ? source.length : close + 2
      continue
    }
    if (current === '"' || current === "'" || current === '`') {
      const start = index
      const literal = quotedLiteralAt(source, index)
      index = literal.end
      // Module specifiers are string literals. Reading the complete template too, and emitting no
      // token for it, prevents its prose and interpolation text from manufacturing graph edges.
      if (current !== '`') {
        tokens.push({ end: index, kind: 'string', start, value: literal.value })
      }
      continue
    }
    if (/[A-Za-z_$]/.test(current)) {
      const start = index
      let end = index + 1
      while (end < source.length && /[\w$]/.test(source[end]!)) {
        end += 1
      }
      tokens.push({ end, kind: 'identifier', start, value: source.slice(index, end) })
      index = end
      continue
    }
    tokens.push({ end: index + 1, kind: 'punctuation', start: index, value: current })
    index += 1
  }
  return tokens
}

/** quotedLiteralAt reads the quoted or template literal starting at `start`, resolving its escapes. */
function quotedLiteralAt(source: string, start: number): { end: number; value: string } {
  const quote = source[start]
  let value = ''
  let index = start + 1
  while (index < source.length && source[index] !== quote) {
    if (source[index] === '\\' && index + 1 < source.length) {
      value += source[index + 1]
      index += 2
    } else {
      value += source[index]
      index += 1
    }
  }
  return { end: index + (index < source.length ? 1 : 0), value }
}

function resolveRelativeSidecarImport(sourcePath: string, specifier: string): string | undefined {
  const requested = FS.resolvePath(specifier, FS.dirname(sourcePath))
  const extension = FS.extname(requested)
  const candidates = extension === ''
    ? [
      ...sidecarModuleExtensions.map(extension => `${requested}${extension}`),
      ...sidecarModuleExtensions.map(extension => FS.resolvePath(`index${extension}`, requested)),
    ]
    : [
      requested,
      ...(extension === '.js' || extension === '.jsx'
        ? ['.ts', '.tsx'].map(authoredExtension => `${requested.slice(0, -extension.length)}${authoredExtension}`)
        : []),
    ]
  return candidates.find(FS.existsSync)
}

function planSidecarGraphOutputs(
  graph: readonly string[],
  rootPath: string,
  companionDirectory: string,
  usedOutputPaths: Set<string>,
): ReadonlyMap<string, string> {
  if (graph.length <= 1) {
    return new Map([[
      rootPath,
      reserveOutputPath(
        outputPathInDirectory(companionDirectory, FS.basename(rootPath)),
        usedOutputPaths,
      ),
    ]])
  }
  const commonDirectory = commonPath(graph.map(FS.dirname))
  const graphName = `${FS.basename(rootPath, FS.extname(rootPath))}.files`
  for (let suffix = 1;; suffix++) {
    const directoryName = suffix === 1 ? graphName : `${graphName}-${suffix}`
    const directory = outputPathInDirectory(companionDirectory, directoryName)
    const outputs = new Map(graph.map(sourcePath => [
      sourcePath,
      outputPathInDirectory(directory, FS.relativePath(commonDirectory, sourcePath)),
    ]))
    if ([...outputs.values()].some(path => usedOutputPaths.has(path))) {
      continue
    }
    for (const path of outputs.values()) {
      usedOutputPaths.add(path)
    }
    return outputs
  }
}

function commonPath(paths: readonly string[]): string {
  const first = paths[0]
  Assert.defined(first, 'sidecar graph has at least one directory')
  const segments = first.split('/')
  for (const path of paths.slice(1)) {
    const candidate = path.split('/')
    while (segments.length > 0 && segments.join('/') !== candidate.slice(0, segments.length).join('/')) {
      segments.pop()
    }
  }
  return segments.join('/') || '/'
}

/** A moved sidecar still resolves generated declaration companions for authored `.tao` type imports. */
function rewriteSidecarTaoImports(
  source: string,
  sourcePath: string,
  relativePath: string,
  outputPaths: PlannedOutputs,
): string {
  return source.replace(/(['"])(\.\.?\/[^'"]+\.tao)\1/g, (match, quote: string, specifier: string) => {
    const taoSourcePath = FS.resolvePath(specifier, FS.dirname(sourcePath))
    const planned = outputPaths.bySourcePath.get(taoSourcePath)
    if (!planned) {
      return match
    }
    const target = planned.declarationsPath ?? planned.modulePath
    return `${quote}${relativeImportPath(relativePath, target)}${quote}`
  })
}

function declarationIdentityProjects(
  files: readonly ParsedFile[],
  context: CompilerContext,
): DeclarationIdentityProject[] {
  const projects = files.flatMap(file =>
    file.ast.statements.filter(AST.isProjectDeclaration).flatMap(project => {
      const id = AST.blockStatementOf(project, { filter: AST.isProjectId })[0]?.value
      return id === undefined ? [] : [{ id, root: FS.dirname(file.path) }]
    })
  )
  if (context.sourceRoot === codeProjectRoot && !projects.some(project => project.root === codeProjectRoot)) {
    projects.push({ id: 'tao-compiler-test', root: codeProjectRoot })
  }
  return projects
}

function configurationAliasImportLines(
  file: ParsedFile,
  currentOutputPath: string,
  outputPaths: PlannedOutputs,
): string[] {
  const importLines = file.ast.statements.filter(isTransparentConfigurableAlias).flatMap(declaration => {
    const target = declaration.aliasTarget?.member.ref
    if (!target || !AST.isTypeDeclaration(target)) {
      return []
    }
    const targetSourcePath = AST.getDocument(target).uri.path
    const targetOutputPath = outputPaths.modulePathBySourcePath.get(targetSourcePath)
    if (!targetOutputPath) {
      return []
    }
    const targetType = `${target.name}Config`
    const localType = configurationAliasTargetTypeBindingName(declaration)
    return [
      `import type { ${targetType} as ${localType} } from '${relativeImportPath(currentOutputPath, targetOutputPath)}'`,
    ]
  })
  return [...new Set(importLines)]
}

function planDataCatalog(sourceFiles: readonly ParsedFile[], entryPath: string): DataCatalogPlan | undefined {
  const entities = sourceFiles.flatMap(file => file.ast.statements.filter(AST.isEntityDataDeclaration))
  const datasources = sourceFiles.flatMap(file => file.ast.statements.filter(AST.isDatasourceDeclaration))
  const pathsOf = (matches: (file: ParsedFile) => boolean) => new Set(sourceFiles.filter(matches).map(f => f.path))
  const directUserPaths = pathsOf(fileUsesDataCatalog)
  if (entities.length === 0 && directUserPaths.size === 0) {
    return undefined
  }
  const stores = ASTUtils.planDataStores(entities, datasources)
  const seedsSyncedRows = stores.stores.some(store => store.kind !== 'device' && store.collections.length > 0)
  const userPaths = new Set([
    ...directUserPaths,
    // Every app root seeds the project's synced stores when a test or Studio fixture is mounted,
    // including an app that leaves its datasource at the default. A project with only local-only
    // rows does not need the empty synced catalog in those roots.
    ...pathsOf(file => seedsSyncedRows && AST.appValueDeclarationsInFile(file.ast).length > 0),
  ])
  const ownerPath = sourceFiles.find(file => file.ast.statements.some(AST.isEntityDataDeclaration))?.path ?? entryPath
  // Both catalogs are emitted by one owner file, so a project that mixes stores still has a single
  // module every user imports from and a single sidecar copy of the local provider. An app root
  // binds the companion catalog whether or not it configures a Datasource, so a file that declares
  // an app is a companion user even when it never names the catalog itself.
  const localUserPaths = pathsOf(file =>
    fileUsesDataCatalog(file) || AST.appValueDeclarationsInFile(file.ast).length > 0
  )
  return {
    entities,
    access: sourceFiles.flatMap(file => file.ast.statements.filter(AST.isAccessDeclaration)),
    localOnly: entities.some(Type.dataEntityIsLocalOnly),
    localUserPaths,
    ownerPath,
    stores,
    userPaths,
  }
}

/**
 * A file uses the catalog when it reads or writes rows, and an app file uses it because mounting a
 * store is what an app root does. The app side is read from the resolved binding rather than from a
 * slot spelled `Datasource`, so a variant that inherits its datasources still counts as a user.
 */
/**
 * The catalog bindings a module shares. Every store but the device one travels together: a file that
 * reads rows may read any of them, and an app file mounts the ones it binds, so splitting the import
 * per query would save nothing and make the owner module's exports depend on its readers.
 */
function syncedCatalogBindings(plan: DataCatalogPlan): readonly string[] {
  return plan.stores.stores.filter(store => store.kind !== 'device').map(store => store.binding)
}

function fileUsesDataCatalog(file: ParsedFile): boolean {
  if (AST.appValueDeclarationsInFile(file.ast).some(app => ASTUtils.appBoundDatasources(app).length > 0)) {
    return true
  }
  return AST.streamAllContents(file.ast).some(node =>
    AST.isEntityQueryDeclaration(node) || AST.isCreateStatement(node)
    || (AST.isValueReference(node) && AST.isAuthLibraryDeclaration(node.target.ref, 'Account'))
  )
}

function addResolvedImport(imports: ResolvedImports, sourcePath: string, binding: string): void {
  addImportedName(imports.bySource, sourcePath, binding)
  imports.scopeBindings.set(binding, binding)
}

function addImportedName(bySource: Map<string, Set<string>>, sourcePath: string, name: string): void {
  const names = bySource.get(sourcePath) ?? new Set<string>()
  names.add(name)
  bySource.set(sourcePath, names)
}

/** exportedBinding re-exports one generated binding under its own name. */
function exportedBinding(binding: string): { exported: string; binding: string } {
  return { exported: binding, binding }
}

/** runtimeBindingName is the binding a declaration is emitted under, which a configurable
 * declaration renames so its own name can stay the configured value. */
function runtimeBindingName(declaration: AST.Declaration): string {
  return isRuntimeConfigurableDeclaration(declaration)
    ? configurationRuntimeBindingName(declaration)
    : declaration.name
}

function importLinesForCompiledFile(
  imports: ResolvedImports,
  currentOutputPath: string,
  outputPathBySourcePath: ReadonlyMap<string, string>,
): string[] {
  return [...imports.bySource.entries()].map(([sourcePath, names]) => {
    const sourceOutputPath = outputPathBySourcePath.get(sourcePath)
    Assert.defined(sourceOutputPath, compiledSourceOutputPathMessage, { sourcePath })
    const importPath = relativeImportPath(currentOutputPath, sourceOutputPath)
    if (names.size === 0) {
      return `import '${importPath}'`
    }
    const importedNames = Array.from(names).toSorted((left, right) => left.localeCompare(right)).join(', ')
    return `import { ${importedNames} } from '${importPath}'`
  })
}

function compileResultForApp(
  validationResult: ValidationResult,
  compiledFiles: CompiledFile[],
  selectedAppPath: string,
): CompileResult {
  const appNames = validationResult.files.flatMap(file => AST.appValueDeclarationsInFile(file.ast).map(app => app.name))
  const entryCode = compiledFiles.find((compiledFile: CompiledFile) =>
    compiledFile.sourcePath === selectedAppPath && compiledFile.relativePath === 'App.tsx'
  )?.code
  Assert.defined(entryCode, 'selected app compiled code exists', { selectedAppPath })
  return {
    appNames,
    validation: validationResult,
    code: entryCode,
    files: compiledFiles,
  }
}

// Module output paths must stay inside the generated app root, so out-of-root
// sources fall back to entry-relative and basename buckets instead of `..` segments.
function moduleOutputPath(filePath: string, entryPath: string, sourceRoot: string): string {
  const sourceRelative = FS.relativePath(sourceRoot, filePath)
  if (!sourceRelative.startsWith('..')) {
    return `modules/${sourceRelative}.tsx`
  }
  const entryRelative = FS.relativePath(FS.dirname(entryPath), filePath)
  if (!entryRelative.startsWith('..')) {
    return `modules/app/${entryRelative}.tsx`
  }
  return `modules/external/${FS.basename(filePath)}.tsx`
}

function resolveImports(
  filePath: string,
  file: AST.TaoFile,
  sourceByPath: Map<string, ParsedFile>,
  packagesContext: Packages.Context,
): ResolvedImports {
  const bySource = new Map<string, Set<string>>()
  const scopeBindings = new Map<string, string>()
  const sourcePaths = new Set(sourceByPath.keys())
  // Both `use` and a package alias name their target the same way: resolve the import path, keep
  // the workspace files it matches, and take the declarations each of them lets that name reach.
  const importTargets = (importPath: string | undefined): ImportTarget[] => {
    const resolution = Packages.resolve(packagesContext, { importPath, fromFilePath: filePath })
    if (resolution.relation === 'invalid') {
      return []
    }
    return [...sourceByPath.values()]
      .filter(candidate =>
        Packages.targetMatches(packagesContext, resolution, {
          filePath: candidate.path,
          workspaceFilePaths: sourcePaths,
        })
      )
      .map(candidate => ({
        declarationsNamed: (name: string) =>
          candidate.ast.statements.filter(declarationEmitsRuntimeBinding).filter(declaration =>
            declaration.name === name && Packages.declarationIsImportableFromUse(declaration, resolution)
          ),
        path: candidate.path,
      }))
  }
  // A `folder` declaration is in scope without a `use` statement, so the generated module still
  // has to import it by name from the sibling file that declares it.
  const currentDirectory = FS.dirname(filePath)
  // Only what this file actually names: importing every folder-visible sibling declaration would
  // make each file in the folder import every other one, dead bindings and cycles included.
  const referencedNames = ASTUtils.referencedNames(file)
  for (const candidate of sourceByPath.values()) {
    if (candidate.path === filePath || FS.dirname(candidate.path) !== currentDirectory) {
      continue
    }
    for (const declaration of candidate.ast.statements) {
      if (
        !declarationEmitsRuntimeBinding(declaration)
        || Packages.visibilityOf(declaration) !== 'folder'
        || !referencedNames.has(declaration.name)
      ) {
        continue
      }
      const binding = runtimeBindingName(declaration)
      addImportedName(bySource, candidate.path, binding)
      scopeBindings.set(binding, binding)
    }
  }
  // A transparent view or configurable-type alias imports its target under a private local name;
  // the alias's own exported binding points at that exact value, preserving declaration identity.
  for (
    const declaration of file.statements.filter(statement =>
      AST.isViewDeclaration(statement) || isTransparentConfigurableAlias(statement)
    )
  ) {
    const aliasTarget = declaration.aliasTarget
    if (!aliasTarget) {
      continue
    }
    const namespaceName = aliasTarget.namespace.$refText
    const namespaceStatement = file.statements
      .filter(AST.isUsePackageStatement)
      .find(statement => AST.packageNamespaceName(statement) === namespaceName)
    if (!namespaceStatement) {
      continue
    }
    const memberName = aliasTarget.member.$refText
    const imported = importTargets(namespaceStatement.importPath)
      .flatMap(target => target.declarationsNamed(memberName).map(found => ({ path: target.path, found })))[0]
    if (!imported) {
      continue
    }
    const localBinding = `__tao_package_${namespaceName}_${memberName}`
    addImportedName(bySource, imported.path, `${runtimeBindingName(imported.found)} as ${localBinding}`)
    scopeBindings.set(runtimeBindingName(declaration), localBinding)
  }
  // An auth provider type named only by `accepts { Kind from Auth }` is compared by name at runtime,
  // so its module — and the sign-in SDK its sidecar loads — stays out of this module's imports.
  const pairingIssuers = new Set(
    AST.streamAllContents(file).filter(AST.isConfigurationAcceptedProof).flatMap(proof =>
      proof.issuer ? [proof.issuer.root] : []
    ),
  )
  const runtimeNames = pairingIssuers.size > 0 ? ASTUtils.referencedNames(file, { runtimeOnly: true }) : referencedNames
  for (const useStatement of file.statements.filter(AST.isUseStatement)) {
    const targets = importTargets(useStatement.importPath)
    for (const importedName of useStatement.importedDeclarations.map(reference => reference.$refText)) {
      if (pairingIssuers.has(importedName) && !runtimeNames.has(importedName)) {
        continue
      }
      // The first target that declares the name wins; a later one would bind the same name twice.
      const target = targets
        .map(candidate => ({ declarations: candidate.declarationsNamed(importedName), path: candidate.path }))
        .find(candidate => candidate.declarations.length > 0)
      if (!target) {
        continue
      }
      for (const declaration of target.declarations) {
        const binding = runtimeBindingName(declaration)
        addImportedName(bySource, target.path, binding)
        scopeBindings.set(binding, binding)
      }
    }
  }
  return { bySource, scopeBindings }
}

function relativeImportPath(fromOutputPath: string, toOutputPath: string): string {
  const fromDir = FS.dirname(fromOutputPath)
  const relative = FS.relativePath(fromDir, toOutputPath)
  const withoutExtension = relative.replace(/\.(?:d\.ts|tsx?)$/, '')
  return withoutExtension.startsWith('.') ? withoutExtension : `./${withoutExtension}`
}

function companionOutputDirectory(
  sourcePath: string,
  modulePath: string,
  usedOutputPaths: ReadonlySet<string>,
): string {
  const directory = outputDirectory(modulePath)
  const declarationName = `${FS.basename(sourcePath)}.d.ts`
  if (!usedOutputPaths.has(outputPathInDirectory(directory, declarationName))) {
    return directory
  }

  const moduleName = FS.basename(modulePath, FS.extname(modulePath))
  for (let suffix = 1;; suffix++) {
    const name = suffix === 1 ? `${moduleName}.files` : `${moduleName}.files-${suffix}`
    const candidate = outputPathInDirectory(outputPathInDirectory(directory, name), declarationName)
    if (!usedOutputPaths.has(candidate)) {
      return outputPathInDirectory(directory, name)
    }
  }
}

function outputDirectory(outputPath: string): string {
  const directory = FS.dirname(outputPath)
  return directory === '.' ? '' : directory
}

function outputPathInDirectory(directory: string, name: string): string {
  return directory === '' ? name : `${directory}/${name}`
}

function reserveOutputPath(preferredPath: string, usedOutputPaths: Set<string>): string {
  let outputPath = preferredPath
  for (let suffix = 2; usedOutputPaths.has(outputPath); suffix++) {
    outputPath = suffixedOutputPath(preferredPath, suffix)
  }
  usedOutputPaths.add(outputPath)
  return outputPath
}

function reserveModuleOutputPath(
  file: ParsedFile,
  preferredPath: string,
  usedOutputPaths: Set<string>,
): string {
  if (!usedOutputPaths.has(preferredPath)) {
    usedOutputPaths.add(preferredPath)
    return preferredPath
  }
  if (!file.ast.statements.some(isRuntimeConfigurableDeclaration)) {
    return reserveOutputPath(preferredPath, usedOutputPaths)
  }

  const directory = outputDirectory(preferredPath)
  const preferredName = FS.basename(preferredPath, FS.extname(preferredPath))
  for (let suffix = 2;; suffix++) {
    const collisionDirectory = outputPathInDirectory(directory, `${preferredName}-${suffix}.files`)
    const candidate = outputPathInDirectory(collisionDirectory, `${FS.basename(file.path)}.tsx`)
    if (!usedOutputPaths.has(candidate)) {
      usedOutputPaths.add(candidate)
      return candidate
    }
  }
}

function suffixedOutputPath(outputPath: string, suffix: number): string {
  if (outputPath.endsWith('.d.ts')) {
    return `${outputPath.slice(0, -'.d.ts'.length)}-${suffix}.d.ts`
  }
  const extension = FS.extname(outputPath)
  return extension === ''
    ? `${outputPath}-${suffix}`
    : `${outputPath.slice(0, -extension.length)}-${suffix}${extension}`
}

function declarationVisibleOutsideFile(declaration: AST.Declaration): boolean {
  return Packages.visibilityOf(declaration) !== undefined
}

// Most type declarations are erased, but a case set carries runtime case identities and a
// configurable type carries a declaration identity, so both cross file boundaries as bindings.
// Entity declarations contribute to the shared catalog rather than emitting individual bindings.
function declarationEmitsRuntimeBinding(node: AST.Node): node is AST.Declaration {
  return AST.isDeclaration(node)
    && AST.isEmittingRuntimeBinding(node)
    && !AST.isEntityDataDeclaration(node)
    && (!AST.isTypeDeclaration(node)
      || AST.isCaseSetTypeExpression(node.type)
      || isRuntimeConfigurableDeclaration(node))
}
