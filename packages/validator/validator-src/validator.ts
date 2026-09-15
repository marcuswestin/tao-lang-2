import { Packages } from '@ast-utils'
import { AST, codeProjectRoot, Parser, type ParseResult, type ParserServices } from '@parser'
import { type Diagnostic, Diagnostics } from '@shared'
import { registerTaoValidationChecks } from './langium-validation'
import { Validate } from './Validate'
import { Validation, type ValidationRunContext } from './validation'
import { validateProjectWorkspace } from './validators/project-validator'

/** ValidationResult declares validated Tao source and diagnostics. */
export type ValidationResult = Pick<ParseResult, 'entry' | 'files'> & {
  diagnostics: readonly Diagnostic[]
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
): ValidationRunContext {
  return {
    entryFilePath,
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
function installLangiumChecks(services: ParserServices, packagesContext: Packages.Context): void {
  registerTaoValidationChecks(services.language, file => {
    const workspaceFiles = Array.from(services.shared.workspace.LangiumDocuments.all)
      .map(document => document.parseResult.value)
      .filter(AST.isTaoFile)
    return createContext(packagesContext, workspaceFiles, AST.getDocument(file).uri.path)
  })
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
    entryFilePath: context.entryFilePath,
    packagesContext: context.packagesContext,
    workspaceFiles: context.workspaceFiles,
    ...(context.projectFiles === undefined ? {} : { projectFiles: context.projectFiles }),
  })
  validateProjectWorkspace(ctx)
  for (const file of context.workspaceFiles) {
    const nodes = Validate.TaoFile(file, ctx)
    Validate.Types(file, nodes, ctx)
    await Validate.ForeignImplementationFiles(file, ctx)
  }

  return validationResultFromParse(parseResult, [...parseResult.diagnostics, ...validationDiagnostics.diagnostics])
}

/**
 * createSession creates caller-owned standalone services for batch validation.
 *
 * The package context and language services live for as long as the returned
 * session is referenced. Create a new session when its package context changes;
 * source text alone does not invalidate it because each call replaces the
 * synthetic Langium document.
 */
async function createSession(packagesContext?: Packages.Context): Promise<ValidatorSession> {
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
          ),
        )
      })
      pending = result.then(() => undefined, () => undefined)
      return result
    },
  }
}

/** validateCode validates Tao source code using fresh standalone services. */
async function validateCode(code: string): Promise<ValidationResult> {
  return await (await createSession()).validateCode(code)
}

/** Validator exposes Tao source validation functions. */
const Validator = {
  createContext,
  createSession,
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
