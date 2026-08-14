import { Packages } from '@ast-utils'
import { AST, Parser, type ParseResult } from '@parser'
import { type Diagnostic, Diagnostics } from '@shared'
import { createTypirLangiumServices, initializeLangiumTypirServices } from 'typir-langium'
import { type TaoSpecifics, TaoTypeSystem, type TaoTypirServices } from './type-system'
import { Validate } from './Validate'
import { Validation, type ValidationRunContext } from './validation'

const codeProjectRoot = '/__tao__'

/** ValidationResult declares validated Tao source and diagnostics. */
export type ValidationResult = Pick<ParseResult, 'entry' | 'files'> & {
  diagnostics: readonly Diagnostic[]
}

/** ValidatorSession reuses standalone parser and Typir services across independent source strings. */
export type ValidatorSession = {
  validateCode(code: string): Promise<ValidationResult>
}

/** createContext creates validator invocation state. */
function createContext(
  packagesContext: Packages.Context,
  typir: TaoTypirServices,
  workspaceFiles: readonly AST.TaoFile[],
  entryFilePath: string,
): ValidationRunContext {
  return {
    entryFilePath,
    packagesContext,
    typir,
    workspaceFiles,
  }
}

/** validateParseResult validates an existing parse result. */
function validateParseResult(parseResult: ParseResult, context: ValidationRunContext): ValidationResult {
  if (Diagnostics.hasError(parseResult.diagnostics, 'lexer', 'parser')) {
    return validationResultFromParse(parseResult, parseResult.diagnostics)
  }

  // Linker errors don't gate structural validation: the AST shape is intact and
  // validators tolerate unresolved references.
  const validationDiagnostics = Validation.collectDiagnostics()
  const ctx = Validation.createContext(validationDiagnostics.accept, {
    entryFilePath: context.entryFilePath,
    packagesContext: context.packagesContext,
    typir: context.typir,
    workspaceFiles: context.workspaceFiles,
  })
  for (const file of context.workspaceFiles) {
    const nodes = Validate.TaoFile(file, ctx)
    Validate.TypirProblems(file, nodes, context.typir, ctx)
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
  const typir = createTypirLangiumServices<TaoSpecifics>(
    parserContext.services.shared,
    AST.reflection,
    new TaoTypeSystem(),
  )
  initializeLangiumTypirServices(parserContext.services.language, typir)

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
            typir,
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
