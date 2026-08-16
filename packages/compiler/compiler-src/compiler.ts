import { Packages } from '@ast-utils'
import { AST, type ParsedFile } from '@parser'
import { Assert, Diagnostics, FS } from '@shared'
import Validator, { type ValidationResult } from '@validator'
import {
  configurationRuntimeBindingName,
  configurationSidecarBindingName,
  isRuntimeConfigurableDeclaration,
} from './codegen/app/configuration-compiler'
import {
  type InlineInjection,
  inlineInjectionsOf,
  withInlineInjectionBindings,
} from './codegen/app/injection-plan'
import RuntimeGen from './codegen/app/runtime-gen'
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
  declaration: AST.ConfigurableDeclaration
  sourcePath: string
  relativePath: string
}

type PlannedSourceOutputs = {
  injections: PlannedInjection[]
  modulePath: string
  declarationsPath?: string
  sidecars: PlannedSidecar[]
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
}

export type CompileOptions = {
  appName?: string
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
  const errors = Diagnostics.errorMessages(validationResult.diagnostics)
  Assert(errors.length === 0, `Cannot compile Tao source with validation errors: ${errors.join('; ')}`, { errors })
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
  return compileValidatedInput(validationResult, context, selectedAppName)
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
): CompileResult {
  const entryPath = validationResult.entry.path
  const sourceFiles = validationResult.files.filter(file =>
    file.ast.statements.length === 0 || !file.ast.statements.every(AST.isPrimitiveDeclaration)
  )
  const sourceByPath = new Map(sourceFiles.map(file => [file.path, file]))
  const outputPaths = planOutputPaths(sourceFiles, entryPath, context.sourceRoot)
  const dataCatalog = planDataCatalog(sourceFiles, entryPath)
  const compiledFiles = sourceFiles.flatMap(file =>
    compileSourceFile(file, {
      dataCatalog,
      sourceByPath,
      outputPaths,
      packagesContext: context.packagesContext,
      selectedAppName: file.path === entryPath ? selectedAppName : undefined,
    })
  )

  return compileResultForEntry(validationResult, compiledFiles)
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
    const sidecars = declarations.flatMap(declaration => {
      const sidecarPath = AST.configurationImplementationOf(declaration)?.sidecarPath
      if (sidecarPath === undefined) {
        return []
      }
      const sourcePath = FS.resolvePath(sidecarPath, FS.dirname(file.path))
      let relativePath = sidecarPathBySourcePath.get(sourcePath)
      if (relativePath === undefined) {
        relativePath = reserveOutputPath(
          outputPathInDirectory(companionDirectory, FS.basename(sourcePath)),
          usedOutputPaths,
        )
        sidecarPathBySourcePath.set(sourcePath, relativePath)
      }
      return [{ declaration, sourcePath, relativePath }]
    })
    bySourcePath.set(file.path, { injections, modulePath, declarationsPath, sidecars })
  }
  return { bySourcePath, modulePathBySourcePath }
}

type CompileSourceFileOptions = {
  dataCatalog: DataCatalogPlan | undefined
  sourceByPath: Map<string, ParsedFile>
  outputPaths: PlannedOutputs
  packagesContext: Packages.Context
  selectedAppName: string | undefined
}

function compileSourceFile(file: ParsedFile, options: CompileSourceFileOptions): CompiledFile[] {
  const { dataCatalog, sourceByPath, outputPaths, packagesContext, selectedAppName } = options
  const imports = resolveImports(file.path, file.ast, sourceByPath, packagesContext)
  const ownsDataCatalog = dataCatalog?.ownerPath === file.path
  if (dataCatalog && !ownsDataCatalog && dataCatalog.userPaths.has(file.path)) {
    addResolvedImport(imports, dataCatalog.ownerPath, dataCatalogBindingName)
  }
  const planned = outputPaths.bySourcePath.get(file.path)
  Assert.defined(planned, compiledSourceOutputPathMessage, { sourcePath: file.path })
  const importLines = [
    ...importLinesForCompiledFile(imports, planned.modulePath, outputPaths.modulePathBySourcePath),
    ...planned.injections.map(injection =>
      `import ${injection.binding} from '${relativeImportPath(planned.modulePath, injection.relativePath)}'`
    ),
    ...planned.sidecars.map(sidecar =>
      `import ${configurationSidecarBindingName(sidecar.declaration)} from '${
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
    code: withInlineInjectionBindings(
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
        }),
    ),
  }
  const declarations: CompiledFile[] = planned.declarationsPath === undefined
    ? []
    : [{
      sourcePath: file.path,
      relativePath: planned.declarationsPath,
      code: RuntimeGen.ConfigurationDeclarations(file.ast),
    }]
  const injections: CompiledFile[] = planned.injections.map(injection => ({
    sourcePath: file.path,
    relativePath: injection.relativePath,
    code: RuntimeGen.InjectionBoundary(injection.node),
  }))
  const copiedSidecars = new Map<string, CompiledFile>()
  for (const sidecar of planned.sidecars) {
    Assert(FS.existsSync(sidecar.sourcePath), 'validated configuration sidecar exists', {
      sourcePath: sidecar.sourcePath,
    })
    copiedSidecars.set(sidecar.relativePath, {
      sourcePath: sidecar.sourcePath,
      relativePath: sidecar.relativePath,
      code: FS.readTextSync(sidecar.sourcePath),
    })
  }
  return [module, ...injections, ...declarations, ...copiedSidecars.values()]
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
      const target = targets.find(candidate =>
        candidate.ast.statements.some(statement =>
          declarationEmitsRuntimeBinding(statement)
          && statement.name === importedName
          && Packages.declarationIsImportableFromUse(statement, resolution)
        )
      )
      if (!target) {
        continue
      }
      const names = bySource.get(target.path) ?? new Set<string>()
      const declarations = target.ast.statements.filter(statement =>
        declarationEmitsRuntimeBinding(statement)
        && statement.name === importedName
        && Packages.declarationIsImportableFromUse(statement, resolution)
      )
      for (const declaration of declarations) {
        const binding = isRuntimeConfigurableDeclaration(declaration)
          ? configurationRuntimeBindingName(declaration)
          : importedName
        names.add(binding)
        scopeBindings.set(binding, binding)
      }
      bySource.set(target.path, names)
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

function declarationEmitsRuntimeBinding(node: AST.Node): node is AST.Declaration {
  return AST.isDeclaration(node)
    && AST.isEmittingRuntimeBinding(node)
    && (!AST.isTypeDeclaration(node) || isRuntimeConfigurableDeclaration(node))
}
