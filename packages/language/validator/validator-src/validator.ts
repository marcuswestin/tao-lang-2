import { ASTUtils, Packages } from '@ast-utils'
import { AST, codeProjectRoot, Parser, type ParseResult, type ParserServices } from '@parser'
import { type Diagnostic, Diagnostics, FS, ReleaseCapabilities, type ReleaseProfile } from '@shared'
import { registerTaoValidationChecks } from './langium-validation'
import { Validate } from './Validate'
import { Validation, type ValidationRunContext } from './validation'
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

/** validateParseResult validates an existing parse result. */
async function validateParseResult(
  parseResult: ParseResult,
  context: ValidationRunContext,
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
    ...(context.projectFiles === undefined ? {} : { projectFiles: context.projectFiles }),
  })
  validatePackageWorkspace(ctx)
  const associatedEffects = ASTUtils.createAssociatedEffects(context.workspaceFiles)
  for (const file of context.workspaceFiles) {
    const nodes = Validate.TaoFile(file, ctx, associatedEffects)
    Validate.Types(file, nodes, ctx, associatedEffects)
    await Validate.ForeignImplementationFiles(file, ctx)
  }

  return {
    ...validationResultFromParse(parseResult, [...parseResult.diagnostics, ...validationDiagnostics.diagnostics]),
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
  createSession,
  releaseDiagnostics,
  installLangiumChecks,
  validateCode,
  validateParseResult,
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
