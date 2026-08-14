import { Packages } from '@ast-utils'
import { AST, type ParsedFile } from '@parser'
import { Assert, Diagnostics, FS } from '@shared'
import Validator, { type ValidationResult } from '@validator'
import RuntimeGen from './codegen/app/runtime-gen'
import { compileTestPlan, type TaoTestPlan } from './tests-compiler'

const codeProjectRoot = '/__tao__'
const compiledSourceOutputPathMessage = 'compiled source output path exists'

/** CompiledFile declares one generated TypeScript output file. */
export type CompiledFile = {
  sourcePath: string
  relativePath: string
  code: string
}

type ResolvedImports = {
  bySource: Map<string, Set<string>>
  importedNames: Set<string>
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

/** createSession creates a reusable standalone compiler context for batch compilation. */
async function createSession(): Promise<CompilerSession> {
  const packagesContext = await Packages.createContext(codeProjectRoot)
  const validatorSession = await Validator.createSession(packagesContext)
  const compilerContext = createContext(packagesContext, codeProjectRoot)
  return {
    async compileCode(code: string, options: CompileOptions = {}): Promise<CompileResult> {
      return compileValidated(await validatorSession.validateCode(code), compilerContext, options)
    },
  }
}

/** compileCode compiles Tao source code using standalone parser and validator contexts. */
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
  const sourceFiles = validationResult.files
  const sourceByPath = new Map(sourceFiles.map(file => [file.path, file]))
  const outputPathBySourcePath = planOutputPaths(sourceFiles, entryPath, context.sourceRoot)
  const compiledFiles = sourceFiles.map(file =>
    compileSourceFile(file, {
      sourceByPath,
      outputPathBySourcePath,
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
): Map<string, string> {
  // Basename buckets in moduleOutputPath can collide across distinct sources;
  // suffix deterministically instead of silently overwriting generated files.
  const outputPathBySourcePath = new Map<string, string>()
  const usedOutputPaths = new Set<string>()
  for (const file of sourceFiles) {
    const preferredPath = file.path === entryPath ? 'App.tsx' : moduleOutputPath(file.path, entryPath, sourceRoot)
    let outputPath = preferredPath
    for (let suffix = 2; usedOutputPaths.has(outputPath); suffix++) {
      outputPath = preferredPath.replace(/\.tsx$/, `-${suffix}.tsx`)
    }
    usedOutputPaths.add(outputPath)
    outputPathBySourcePath.set(file.path, outputPath)
  }
  return outputPathBySourcePath
}

type CompileSourceFileOptions = {
  sourceByPath: Map<string, ParsedFile>
  outputPathBySourcePath: ReadonlyMap<string, string>
  packagesContext: Packages.Context
  selectedAppName: string | undefined
}

function compileSourceFile(file: ParsedFile, options: CompileSourceFileOptions): CompiledFile {
  const { sourceByPath, outputPathBySourcePath, packagesContext, selectedAppName } = options
  const imports = resolveImports(file.path, file.ast, sourceByPath, packagesContext)
  const currentOutputPath = outputPathBySourcePath.get(file.path)
  Assert.defined(currentOutputPath, compiledSourceOutputPathMessage, { sourcePath: file.path })
  const importLines = importLinesForCompiledFile(imports, currentOutputPath, outputPathBySourcePath)
  const scopeBindings = [...imports.importedNames].map(name => `TR.Use(_Scope, '${name}', () => ${name})`)
  const exportedNames = file.ast.statements
    .filter(AST.isExportableDeclaration)
    .filter(AST.isEmittingRuntimeBinding)
    .filter(declarationVisibleOutsideFile)
    .map((statement: AST.Declaration) => statement.name)

  return {
    sourcePath: file.path,
    relativePath: currentOutputPath,
    code: RuntimeGen.TaoFile(file.ast, {
      importLines,
      scopeBindings,
      exportedNames,
      selectedAppName,
    }),
  }
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
  const importedNames = new Set<string>()
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
          AST.isDeclaration(statement)
          && AST.isEmittingRuntimeBinding(statement)
          && statement.name === importedName
          && Packages.isVisible(Packages.visibilityOf(statement), resolution)
        )
      )
      if (!target) {
        continue
      }
      importedNames.add(importedName)
      const names = bySource.get(target.path) ?? new Set<string>()
      names.add(importedName)
      bySource.set(target.path, names)
    }
  }
  return { bySource, importedNames }
}

function relativeImportPath(fromOutputPath: string, toOutputPath: string): string {
  const fromDir = FS.dirname(fromOutputPath)
  const relative = FS.relativePath(fromDir, toOutputPath)
  const withoutExtension = relative.replace(/\.tsx$/, '')
  return withoutExtension.startsWith('.') ? withoutExtension : `./${withoutExtension}`
}

function declarationVisibleOutsideFile(declaration: AST.Declaration): boolean {
  return Packages.visibilityOf(declaration) !== undefined
}
