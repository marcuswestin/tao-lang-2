import { ASTUtils, Packages } from '@ast-utils'
import { AST, type ParsedFile } from '@parser'
import { Assert, Diagnostics, FS } from '@shared'
import Validator, { type ValidationResult } from '@validator'
import { designValidationCodes } from '@validator/diagnostic-codes'
import {
  configurationAliasTargetTypeBindingName,
  configurationRuntimeBindingName,
  configurationSidecarBindingName,
  isRuntimeConfigurableDeclaration,
  isTransparentConfigurableAlias,
} from './codegen/app/configuration-compiler'
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
import RuntimeGen from './codegen/app/runtime-gen'
import {
  compileStudioPreviewManifest,
  type StudioPreviewManifest,
  studioPreviewManifestModule,
} from './studio-preview-manifest'
import { compileTestPlan, type TaoTestPlan } from './tests-compiler'

const codeProjectRoot = '/__tao__'
const compiledSourceOutputPathMessage = 'compiled source output path exists'
const dataCatalogBindingName = '_TaoDataCatalog'

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

type DataCatalogPlan = {
  entities: readonly AST.EntityDataDeclaration[]
  ownerPath: string
  userPaths: ReadonlySet<string>
}

type PlannedSidecar = {
  binding: string
  exportName: string
  sourcePath: string
  relativePath: string
}

type PlannedSidecarCopy = {
  sourcePath: string
  relativePath: string
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
  /** studio emits preview-only render occurrence metadata into generated Tao props. */
  studio?: boolean
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
 * The package, parser, and Typir state lives for as long as the returned session
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
  const entryApps = AST.appValueDeclarationsInFile(validationResult.entry.ast)
  Assert(entryApps.length > 0, 'Cannot compile app entry: entry file must declare at least one app.')
  const appNames = entryApps.map(app => app.name)
  const selectedAppName = options.appName ?? (appNames.length === 1 ? appNames[0] : undefined)
  Assert.defined(
    selectedAppName,
    `Cannot compile app entry with multiple apps without a selection. Available apps: ${appNames.join(', ')}.`,
  )
  Assert(
    appNames.includes(selectedAppName),
    `Cannot compile unknown app '${selectedAppName}'. Available apps: ${appNames.join(', ')}.`,
    { appNames, selectedAppName },
  )
  return compileValidatedInput(validationResult, context, selectedAppName, options.studio === true)
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
  studio: boolean,
): CompileResult {
  const entryPath = validationResult.entry.path
  const sourceFiles = validationResult.files.filter(file =>
    file.ast.statements.length === 0
    || !file.ast.statements.every(statement =>
      AST.isPrimitiveDeclaration(statement) || AST.isProjectDeclaration(statement)
    )
  )
  const identityProjects = declarationIdentityProjects(validationResult.files, context)
  const sourceByPath = new Map(sourceFiles.map(file => [file.path, file]))
  const outputPaths = planOutputPaths(sourceFiles, entryPath, context.sourceRoot)
  const dataCatalog = planDataCatalog(sourceFiles, entryPath)
  const compiledFiles = sourceFiles.flatMap(file =>
    compileSourceFile(file, {
      dataCatalog,
      sourceByPath,
      outputPaths,
      packagesContext: context.packagesContext,
      identityProjects,
      selectedAppName: file.path === entryPath ? selectedAppName : undefined,
      studio,
    })
  )

  const studioManifest = studio ? compileStudioPreviewManifest(sourceFiles, selectedAppName) : undefined
  if (studioManifest !== undefined) {
    compiledFiles.push({
      code: studioPreviewManifestModule(studioManifest),
      relativePath: 'TaoStudioManifest.ts',
      sourcePath: entryPath,
    })
  }

  return {
    ...compileResultForEntry(validationResult, compiledFiles),
    ...(studioManifest === undefined ? {} : { studioManifest }),
  }
}

function planOutputPaths(
  sourceFiles: readonly ParsedFile[],
  entryPath: string,
  sourceRoot: string,
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
    const sidecarPathBySourcePath = new Map<string, string>()
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
    ]
    bySourcePath.set(file.path, { injections, modulePath, declarationsPath, sidecars, sidecarCopies })
  }
  return { bySourcePath, modulePathBySourcePath }
}

type CompileSourceFileOptions = {
  dataCatalog: DataCatalogPlan | undefined
  sourceByPath: Map<string, ParsedFile>
  outputPaths: PlannedOutputs
  packagesContext: Packages.Context
  identityProjects: readonly DeclarationIdentityProject[]
  selectedAppName: string | undefined
  studio: boolean
}

function compileSourceFile(file: ParsedFile, options: CompileSourceFileOptions): CompiledFile[] {
  const {
    dataCatalog,
    sourceByPath,
    outputPaths,
    packagesContext,
    identityProjects,
    selectedAppName,
    studio,
  } = options
  const imports = resolveImports(file.path, file.ast, sourceByPath, packagesContext)
  const ownsDataCatalog = dataCatalog?.ownerPath === file.path
  const needsStudioDataCatalog = studio && selectedAppName !== undefined && dataCatalog !== undefined
  if (dataCatalog && !ownsDataCatalog && (dataCatalog.userPaths.has(file.path) || needsStudioDataCatalog)) {
    addResolvedImport(imports, dataCatalog.ownerPath, dataCatalogBindingName)
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
    .map((declaration: AST.Declaration) => {
      const binding = isRuntimeConfigurableDeclaration(declaration)
        ? configurationRuntimeBindingName(declaration)
        : declaration.name
      return { exported: binding, binding }
    })
  if (ownsDataCatalog) {
    exportedBindings.push({ exported: dataCatalogBindingName, binding: dataCatalogBindingName })
  }

  const module: CompiledFile = {
    sourcePath: file.path,
    relativePath: planned.modulePath,
    code: withDeclarationIdentityContext(identityProjects, () =>
      withInlineInjectionBindings(
        new Map(planned.injections.map(injection => [injection.node, injection.binding])),
        () =>
          RuntimeGen.TaoFile(file.ast, {
            configurationTypes: planned.declarationsPath === undefined
              ? undefined
              : RuntimeGen.ConfigurationTypes(file.ast),
            dataEntities: ownsDataCatalog ? dataCatalog.entities : [],
            emitDataCatalog: ownsDataCatalog,
            importLines,
            scopeBindings,
            exportedBindings,
            selectedAppName,
            studioDataCatalog: studio && dataCatalog !== undefined && (ownsDataCatalog || needsStudioDataCatalog),
            studio,
            studioViews: studio && selectedAppName !== undefined
              ? file.ast.statements.filter(AST.isScenarioGroupDeclaration).flatMap(group =>
                AST.scenarioDeclarations(group).flatMap(scenario => {
                  const subject = AST.scenarioSubjectDeclaration(scenario)
                  const view = AST.isViewDeclaration(subject) ? subject : undefined
                  return view === undefined
                    ? []
                    : [{ id: `${AST.getDocument(view).uri.fsPath}#${view.name}`, view }]
                })
              )
              : [],
            viewRegistrations: RuntimeGen.ViewRegistrations(file.ast, { studio }),
          }),
      )),
  }
  const declarations: CompiledFile[] = planned.declarationsPath === undefined
    ? []
    : [{
      sourcePath: file.path,
      relativePath: planned.declarationsPath,
      code: RuntimeGen.ConfigurationDeclarations(
        file.ast,
        configurationAliasImportLines(file, planned.declarationsPath, outputPaths),
      ),
    }]
  const injections: CompiledFile[] = planned.injections.map(injection => ({
    sourcePath: file.path,
    relativePath: injection.relativePath,
    code: RuntimeGen.InjectionBoundary(injection.node),
  }))
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
      sourcePath: sidecar.sourcePath,
      relativePath: sidecar.relativePath,
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
      if (specifier.endsWith('.tao')) {
        continue
      }
      const dependency = resolveRelativeSidecarImport(sourcePath, specifier)
      Assert.defined(dependency, `Sidecar relative import '${specifier}' could not be resolved.`, {
        sourcePath,
      })
      visit(dependency)
    }
  }
  visit(rootPath)
  return graph
}

type SidecarToken = Readonly<{ kind: 'identifier' | 'punctuation' | 'string'; value: string }>

/** Covers imports, re-exports, side-effect imports, and dynamic import calls without false comment/string edges. */
function relativeModuleSpecifiers(source: string): string[] {
  const tokens = sidecarTokens(source)
  const specifiers: string[] = []
  const add = (token: SidecarToken | undefined): void => {
    if (token?.kind === 'string' && (token.value.startsWith('./') || token.value.startsWith('../'))) {
      specifiers.push(token.value)
    }
  }
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (token?.kind !== 'identifier' || (token.value !== 'import' && token.value !== 'export')) {
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
  return [...new Set(specifiers)]
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
    if (current === '"' || current === "'") {
      const quote = current
      let value = ''
      index += 1
      while (index < source.length && source[index] !== quote) {
        if (source[index] === '\\' && index + 1 < source.length) {
          value += source[index + 1]
          index += 2
        } else {
          value += source[index]
          index += 1
        }
      }
      index += index < source.length ? 1 : 0
      tokens.push({ kind: 'string', value })
      continue
    }
    if (current === '`') {
      // Module specifiers are string literals. Skipping the complete template also prevents its
      // prose and interpolation text from manufacturing graph edges.
      index += 1
      while (index < source.length) {
        if (source[index] === '\\') {
          index += 2
        } else if (source[index] === '`') {
          index += 1
          break
        } else {
          index += 1
        }
      }
      continue
    }
    if (/[A-Za-z_$]/.test(current)) {
      let end = index + 1
      while (end < source.length && /[\w$]/.test(source[end]!)) {
        end += 1
      }
      tokens.push({ kind: 'identifier', value: source.slice(index, end) })
      index = end
      continue
    }
    tokens.push({ kind: 'punctuation', value: current })
    index += 1
  }
  return tokens
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
  const userPaths = new Set(
    sourceFiles
      .filter(fileUsesDataCatalog)
      .map(file => file.path),
  )
  if (entities.length === 0 && userPaths.size === 0) {
    return undefined
  }
  const ownerPath = sourceFiles.find(file => file.ast.statements.some(AST.isEntityDataDeclaration))?.path ?? entryPath
  return { entities, ownerPath, userPaths }
}

function fileUsesDataCatalog(file: ParsedFile): boolean {
  return AST.streamAllContents(file.ast).some(node =>
    AST.isEntityQueryDeclaration(node)
    || AST.isCreateStatement(node)
    || (AST.isAppProperty(node) && node.name === 'Datasource')
  )
}

function addResolvedImport(imports: ResolvedImports, sourcePath: string, binding: string): void {
  const names = imports.bySource.get(sourcePath) ?? new Set<string>()
  names.add(binding)
  imports.bySource.set(sourcePath, names)
  imports.scopeBindings.set(binding, binding)
}

function importLinesForCompiledFile(
  imports: ResolvedImports,
  currentOutputPath: string,
  outputPathBySourcePath: ReadonlyMap<string, string>,
): string[] {
  return [...imports.bySource.entries()].map(([sourcePath, names]) => {
    const sourceOutputPath = outputPathBySourcePath.get(sourcePath)
    Assert.defined(sourceOutputPath, compiledSourceOutputPathMessage, { sourcePath })
    const importedNames = Array.from(names).toSorted((left, right) => left.localeCompare(right)).join(', ')
    const importPath = relativeImportPath(currentOutputPath, sourceOutputPath)
    return `import { ${importedNames} } from '${importPath}'`
  })
}

function compileResultForEntry(
  validationResult: ValidationResult,
  compiledFiles: CompiledFile[],
): CompileResult {
  const entryPath = validationResult.entry.path
  const entryCode = compiledFiles.find((compiledFile: CompiledFile) => compiledFile.sourcePath === entryPath)?.code
  Assert.defined(entryCode, 'entry compiled code exists', { entryPath })
  return {
    appNames: AST.appValueDeclarationsInFile(validationResult.entry.ast).map(app => app.name),
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
      const binding = isRuntimeConfigurableDeclaration(declaration)
        ? configurationRuntimeBindingName(declaration)
        : declaration.name
      const names = bySource.get(candidate.path) ?? new Set<string>()
      names.add(binding)
      bySource.set(candidate.path, names)
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
    const resolution = Packages.resolve(packagesContext, {
      importPath: namespaceStatement.importPath,
      fromFilePath: filePath,
    })
    if (resolution.relation === 'invalid') {
      continue
    }
    const memberName = aliasTarget.member.$refText
    const target = [...sourceByPath.values()].filter(candidate =>
      Packages.targetMatches(resolution, {
        filePath: candidate.path,
        workspaceFilePaths: sourcePaths,
      })
    ).find(candidate =>
      candidate.ast.statements.some(statement =>
        declarationEmitsRuntimeBinding(statement)
        && statement.name === memberName
        && Packages.declarationIsImportableFromUse(statement, resolution)
      )
    )
    if (!target) {
      continue
    }
    const targetDeclaration = target.ast.statements.find(statement =>
      declarationEmitsRuntimeBinding(statement)
      && statement.name === memberName
      && Packages.declarationIsImportableFromUse(statement, resolution)
    )
    if (!targetDeclaration) {
      continue
    }
    const targetBinding = isRuntimeConfigurableDeclaration(targetDeclaration)
      ? configurationRuntimeBindingName(targetDeclaration)
      : memberName
    const aliasBinding = isRuntimeConfigurableDeclaration(declaration)
      ? configurationRuntimeBindingName(declaration)
      : declaration.name
    const localBinding = `__tao_package_${namespaceName}_${memberName}`
    const names = bySource.get(target.path) ?? new Set<string>()
    names.add(`${targetBinding} as ${localBinding}`)
    bySource.set(target.path, names)
    scopeBindings.set(aliasBinding, localBinding)
  }
  for (const useStatement of file.statements.filter(AST.isUseStatement)) {
    const resolution = Packages.resolve(packagesContext, {
      importPath: useStatement.importPath,
      fromFilePath: filePath,
    })
    if (resolution.relation === 'invalid') {
      continue
    }
    const targets = [...sourceByPath.values()].filter(candidate =>
      Packages.targetMatches(resolution, {
        filePath: candidate.path,
        workspaceFilePaths: sourcePaths,
      })
    )
    for (const importedName of useStatement.importedDeclarations.map(reference => reference.$refText)) {
      for (const target of targets) {
        const declarations = target.ast.statements.filter(statement =>
          declarationEmitsRuntimeBinding(statement)
          && statement.name === importedName
          && Packages.declarationIsImportableFromUse(statement, resolution)
        )
        if (declarations.length === 0) {
          continue
        }
        const names = bySource.get(target.path) ?? new Set<string>()
        for (const declaration of declarations) {
          const binding = isRuntimeConfigurableDeclaration(declaration)
            ? configurationRuntimeBindingName(declaration)
            : importedName
          names.add(binding)
          scopeBindings.set(binding, binding)
        }
        bySource.set(target.path, names)
        break
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
  return AST.isAppDeclaration(declaration) || Packages.visibilityOf(declaration) !== undefined
}

// Most type declarations are erased, but a case set carries runtime case identities and a
// configurable type carries a declaration identity, so both cross file boundaries as bindings.
function declarationEmitsRuntimeBinding(node: AST.Node): node is AST.Declaration {
  return AST.isDeclaration(node)
    && AST.isEmittingRuntimeBinding(node)
    && (!AST.isTypeDeclaration(node)
      || AST.isCaseSetTypeExpression(node.type)
      || isRuntimeConfigurableDeclaration(node))
}
