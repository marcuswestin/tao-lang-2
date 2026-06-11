import ASTUtils from '@ast-utils'
import { Parser, type ParseResult } from '@parser'
import { defaultStdLibRoot } from '@parser/module-resolution'
import { validateAliases } from './aliases-validator'
import { validateApp } from './app-validator'
import { hasError, linkerDiagnostics, parserDiagnostics, type TaoDiagnostic } from './diagnostics'
import { validateTypirProblems } from './expressions-validator'
import { validateInjections } from './injections-validator'
import { validateInvocations } from './invocations-validator'
import { parseCodeForValidation, parseFileForValidation, rebuildForValidation } from './langium-services'
import { validateUseStatements } from './use-validator'
import { createValidationContext } from './validation'
import { validateViews } from './views-validator'

/** ValidationResult declares the parsed source and Tao diagnostics. */
export type ValidationResult = {
  parsed: ParseResult & {
    workspaceFiles?: import('@parser').AST.TaoFile[]
    entryFilePath?: string
  }
  diagnostics: readonly TaoDiagnostic[]
  validatorDiagnostics: readonly TaoDiagnostic[]
}

/** validateFile validates the Tao file at `path`. */
async function validateFile(path: string): Promise<ValidationResult> {
  return await validateValidationParseResult(await parseFileForValidation(path))
}

/** validateCode validates Tao source code. */
async function validateCode(code: string): Promise<ValidationResult> {
  const parsed = await Parser.parseCode(code)
  return await validateValidationParseResult(
    await parseCodeForValidation(code, {
      uri: parsed.document.uri,
    }),
  )
}

/** validateParsed validates an existing parser result. */
async function validateParsed(parsed: ParseResult): Promise<ValidationResult> {
  return await validateValidationParseResult(await rebuildForValidation(parsed))
}

async function validateValidationParseResult(
  validationParsed: ParseResult & {
    typir: import('./type-system').TaoTypirServices
    workspaceFiles?: import('@parser').AST.TaoFile[]
    entryFilePath?: string
  },
): Promise<ValidationResult> {
  const workspaceFiles = validationParsed.workspaceFiles ?? [validationParsed.ast]
  const workspaceDocuments = workspaceFiles.map(file => ASTUtils.getDocument(file))
  const parserMessages = parserDiagnostics(validationParsed, workspaceDocuments)
  if (hasError(parserMessages)) {
    return {
      parsed: validationParsed,
      diagnostics: parserMessages,
      validatorDiagnostics: [],
    }
  }

  // Linker errors don't gate structural validation: the AST shape is intact and
  // validators tolerate unresolved references.
  const linkerMessages = linkerDiagnostics(workspaceDocuments)
  const ctx = createValidationContext()
  for (const file of workspaceFiles) {
    validateApp(file, ctx)
    validateViews(file, ctx)
    validateAliases(file, ctx)
    validateInjections(file, ctx)
    validateInvocations(file, ctx)
    const document = ASTUtils.getDocument(file)
    if (document.uri.scheme === 'file') {
      validateUseStatements(file, ctx, {
        workspaceFiles,
        filePath: document.uri.path,
        stdLibRoot: defaultStdLibRoot(),
      })
    }
    validateTypirProblems(file, validationParsed.typir, ctx)
  }

  return {
    parsed: validationParsed,
    diagnostics: [...parserMessages, ...linkerMessages, ...ctx.diagnostics],
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
