import { AST, type ParseResult } from '@parser'

/** DiagnosticSeverity declares the normalized severity for Tao diagnostics. */
export type DiagnosticSeverity = 'error' | 'warning' | 'info'

/** DiagnosticSource declares which pipeline stage produced a Tao diagnostic. */
export type DiagnosticSource = 'parser' | 'validator'

/** TaoDiagnostic declares one parser or validator diagnostic as data. */
export type TaoDiagnostic = {
  message: string
  severity: DiagnosticSeverity
  source: DiagnosticSource
  nodeType?: string
}

/** parserDiagnostics returns normalized parser, linker, and lexer diagnostics. */
export function parserDiagnostics(parsed: ParseResult): TaoDiagnostic[] {
  return uniqueDiagnostics([
    ...parsed.document.parseResult.lexerErrors.map(error => parserError(error.message)),
    ...parsed.document.parseResult.parserErrors.map(error => parserError(error.message)),
    ...parsed.diagnostics.map(langiumDiagnostic),
  ])
}

/** hasError returns true when diagnostics contain at least one error. */
export function hasError(diagnostics: readonly TaoDiagnostic[]): boolean {
  return diagnostics.some(diagnostic => diagnostic.severity === 'error')
}

/** errorMessages returns all error diagnostic messages. */
export function errorMessages(diagnostics: readonly TaoDiagnostic[]): string[] {
  return diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(diagnostic => diagnostic.message)
}

/** validatorError creates a validator error diagnostic. */
export function validatorError(message: string, node?: AST.Node): TaoDiagnostic {
  return {
    message,
    severity: 'error',
    source: 'validator',
    nodeType: node?.$type,
  }
}

function parserError(message: string): TaoDiagnostic {
  return {
    message,
    severity: 'error',
    source: 'parser',
  }
}

function langiumDiagnostic(diagnostic: AST.ParseDiagnostic): TaoDiagnostic {
  return {
    message: diagnostic.message,
    severity: severityFromLangium(diagnostic.severity),
    source: 'parser',
  }
}

function severityFromLangium(severity: number | undefined): DiagnosticSeverity {
  switch (severity) {
    case undefined:
    case 1:
      return 'error'
    case 2:
      return 'warning'
    default:
      return 'info'
  }
}

function uniqueDiagnostics(diagnostics: readonly TaoDiagnostic[]): TaoDiagnostic[] {
  const seen = new Set<string>()
  return diagnostics.filter((diagnostic) => {
    const key = `${diagnostic.source}:${diagnostic.severity}:${diagnostic.message}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}
