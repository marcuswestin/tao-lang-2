import { Packages } from '@ast-utils'
import { AST, Parser, type ParseResult } from '@parser'
import { type Diagnostic, Diagnostics } from '@shared'
import { createTypirLangiumServices, initializeLangiumTypirServices } from 'typir-langium'
import { type TaoSpecifics, TaoTypeSystem, type TaoTypirServices } from './type-system'
import { Validate } from './Validate'
import { collectValidationDiagnostics, createValidationContext, type ValidationRunContext } from './validation'

const codeProjectRoot = '/__tao__'

/** ValidationResult declares validated Tao source and diagnostics. */
export type ValidationResult = Pick<ParseResult, 'entry' | 'files'> & {
  diagnostics: readonly Diagnostic[]
}

/** createContext creates validator invocation state. */
function createContext(
  packagesContext: Packages.Context,
  typir: TaoTypirServices,
  workspaceFiles: readonly AST.TaoFile[],
): ValidationRunContext {
  return {
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
  const validationDiagnostics = collectValidationDiagnostics()
  const ctx = createValidationContext(validationDiagnostics.accept, {
    packagesContext: context.packagesContext,
    typir: context.typir,
    workspaceFiles: context.workspaceFiles,
  })
  for (const file of context.workspaceFiles) {
    Validate.TaoFile(file, ctx)
    Validate.TypirProblems(file, context.typir, ctx)
  }

  return validationResultFromParse(parseResult, [...parseResult.diagnostics, ...validationDiagnostics.diagnostics])
}

/** validateCode validates Tao source code using a standalone validator context. */
async function validateCode(code: string): Promise<ValidationResult> {
  const packagesContext = await Packages.createContext(codeProjectRoot)
  const parserContext = Parser.createContext({
    packages: Packages.createResolver(packagesContext),
  })
  const typir = createTypirLangiumServices<TaoSpecifics>(
    parserContext.services.shared,
    AST.reflection,
    new TaoTypeSystem(),
  )
  initializeLangiumTypirServices(parserContext.services.language, typir)
  const parseResult = await Parser.parseSource(parserContext, code, { validation: false })
  return validateParseResult(
    parseResult,
    createContext(packagesContext, typir, parseResult.files.map(file => file.ast)),
  )
}

/** Validator exposes Tao source validation functions. */
const Validator = {
  createContext,
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
