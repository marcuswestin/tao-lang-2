import { Parser, type ParseResult } from '@parser'
import { validateAliases } from './aliases-validator'
import { validateApp } from './app-validator'
import { hasError, parserDiagnostics, type TaoDiagnostic } from './diagnostics'
import { validateTypirProblems } from './expressions-validator'
import { validateInvocations } from './invocations-validator'
import { parseCodeForValidation, parseFileForValidation, rebuildForValidation } from './langium-services'
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
  const parsed = await Parser.parseFile(path)
  return await validateCleanOrReportParserDiagnostics(parsed, () => parseFileForValidation(path))
}

/** validateCode validates Tao source code. */
async function validateCode(code: string): Promise<ValidationResult> {
  const parsed = await Parser.parseCode(code)
  return await validateCleanOrReportParserDiagnostics(parsed, () =>
    parseCodeForValidation(code, {
      uri: parsed.document.uri,
    }))
}

/** validateParsed validates an existing parser result. */
async function validateParsed(parsed: ParseResult): Promise<ValidationResult> {
  return await validateCleanOrReportParserDiagnostics(parsed, () => rebuildForValidation(parsed))
}

async function validateCleanOrReportParserDiagnostics(
  parsed: ParseResult,
  parseForValidation: () => Promise<ParseResult & { typir: import('./type-system').TaoTypirServices }>,
): Promise<ValidationResult> {
  const parserMessages = parserDiagnostics(parsed)
  if (hasError(parserMessages)) {
    return {
      parsed,
      diagnostics: parserMessages,
      validatorDiagnostics: [],
    }
  }

  const validationParsed = await parseForValidation()
  const ctx = createValidationContext()
  validateApp(validationParsed.ast, ctx)
  validateViews(validationParsed.ast, ctx)
  validateAliases(validationParsed.ast, ctx)
  validateInvocations(validationParsed.ast, ctx)
  validateTypirProblems(validationParsed.ast, validationParsed.typir, ctx)

  return {
    parsed: validationParsed,
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
