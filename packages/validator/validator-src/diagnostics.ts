import { AST, type ParseResult } from '@parser'

/** DiagnosticSeverity declares the normalized severity for Tao diagnostics. */
type DiagnosticSeverity = 'error' | 'warning' | 'info'

/** DiagnosticSource declares which pipeline stage produced a Tao diagnostic. */
type DiagnosticSource = 'parser' | 'validator'

/** TaoDiagnosticRange declares a source span for a Tao diagnostic. */
export type TaoDiagnosticRange = {
  start: {
    line: number
    character: number
  }
  end: {
    line: number
    character: number
  }
}

/** TaoDiagnostic declares one parser or validator diagnostic as data. */
export type TaoDiagnostic = {
  message: string
  severity: DiagnosticSeverity
  source: DiagnosticSource
  nodeType?: string
  range?: TaoDiagnosticRange
}

/** parserDiagnostics returns normalized parser, linker, and lexer diagnostics. */
export function parserDiagnostics(parsed: ParseResult): TaoDiagnostic[] {
  return uniqueDiagnostics([
    ...parsed.diagnostics.map(langiumDiagnostic),
    ...parsed.document.parseResult.lexerErrors.map(error => parserError(error.message)),
    ...parsed.document.parseResult.parserErrors.map(error => parserError(error.message)),
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
    range: node?.$cstNode?.range,
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
    range: diagnostic.range,
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
  const seenMessages = new Set<string>()
  const seenRanges = new Set<string>()
  return diagnostics.filter((diagnostic) => {
    const messageKey = `${diagnostic.source}:${diagnostic.severity}:${diagnostic.message}`
    if (diagnostic.range === undefined) {
      if (seenMessages.has(messageKey)) {
        return false
      }
      seenMessages.add(messageKey)
      return true
    }

    const rangeKey =
      `${messageKey}:${diagnostic.range.start.line}:${diagnostic.range.start.character}:${diagnostic.range.end.line}:${diagnostic.range.end.character}`
    if (seenRanges.has(rangeKey)) {
      return false
    }
    seenRanges.add(rangeKey)
    seenMessages.add(messageKey)
    return true
  })
}
