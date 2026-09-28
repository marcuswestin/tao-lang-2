import { Packages } from '@ast-utils'
import { AST, codeProjectRoot } from '@parser'
import { Assert, Diagnostics } from '@shared'
import Validator, { type ValidationResult } from '@validator'
import { designValidationCodes } from '@validator/diagnostic-codes'
import { Backends } from './codegen/Backend'
import { compileStudioPreviewManifest, type StudioPreviewManifest } from './studio-preview-manifest'
import { compileTestPlan, type TaoTestPlan } from './test-plan-compiler'

/** CompiledFile declares one generated output file. */
export type CompiledFile = {
  sourcePath: string
  relativePath: string
  code: string
}

/** CompileResult declares generated output for a Tao app entry. */
export type CompileResult = {
  target?: 'react-native' | 'watchos'
  entryArtifact?: string
  /** displayName is a native app's literal Name, suitable for the host app label. */
  displayName?: string
  appNames: string[]
  validation: ValidationResult
  code: string
  files: CompiledFile[]
  studioManifest?: StudioPreviewManifest
}

export type CompileOptions = {
  target?: 'react-native' | 'watchos'
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

/** compileValidated selects an app and dispatches an already validated graph to its target backend. */
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
  return Backends[options.target ?? 'react-native'].compile({
    validation: validationResult,
    context,
    app: selected.app,
    appPath: selected.path,
    options,
  })
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
