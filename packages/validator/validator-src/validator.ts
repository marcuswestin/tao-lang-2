import { Parser, type ParseResult } from '@parser'
import { validateApp } from './app-validator'
import { hasError, parserDiagnostics, type TaoDiagnostic } from './diagnostics'
import { createValidationContext } from './validation'
import { validateViews } from './views-validator'

/** ValidationResult declares the parsed source and Tao diagnostics. */
export type ValidationResult = {
  parsed: ParseResult
  diagnostics: readonly TaoDiagnostic[]
  validatorDiagnostics: readonly TaoDiagnostic[]
}

/** validateFile validates the Tao file at `path`. */
async function validateFile(path: string): Promise<ValidationResult> {
  return validateParsed(await Parser.parseFile(path))
}

/** validateCode validates Tao source code. */
async function validateCode(code: string): Promise<ValidationResult> {
  return validateParsed(await Parser.parseCode(code))
}

/** validateParsed validates an existing parser result. */
function validateParsed(parsed: ParseResult): ValidationResult {
  const parserMessages = parserDiagnostics(parsed)
  const ctx = createValidationContext()
  if (!hasError(parserMessages)) {
    validateApp(parsed.ast, ctx)
    validateViews(parsed.ast, ctx)
  }

  return {
    parsed,
    diagnostics: [...parserMessages, ...ctx.diagnostics],
    validatorDiagnostics: ctx.diagnostics,
  }
}

/** Validator exposes Tao source validation functions. */
const Validator = {
  validateCode,
  validateFile,
  validateParsed,
}

export default Validator
