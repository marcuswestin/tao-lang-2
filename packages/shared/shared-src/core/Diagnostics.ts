/** DiagnosticSeverity declares normalized diagnostic severity values across Tao stages. */
export type DiagnosticSeverity = 'error' | 'warning' | 'information' | 'hint'

/** DiagnosticSource declares known Tao pipeline diagnostic sources. */
export type DiagnosticSource = 'lexer' | 'parser' | 'linker' | 'validator' | 'compiler'

/** DiagnosticRange declares a source span for a diagnostic. */
export type DiagnosticRange = {
  start: {
    line: number
    character: number
  }
  end: {
    line: number
    character: number
  }
}

/** Diagnostic declares one diagnostic reported by a Tao pipeline stage. */
export type Diagnostic = {
  filePath?: string
  message: string
  severity: DiagnosticSeverity
  source: DiagnosticSource
  code?: string
  nodeType?: string
  range?: DiagnosticRange
}

/** Diagnostic provides helpers for individual diagnostics. */
export const Diagnostic = {
  isError(diagnostic: Diagnostic): boolean {
    return diagnostic.severity === 'error'
  },

  isWarning(diagnostic: Diagnostic): boolean {
    return diagnostic.severity === 'warning'
  },

  isInformation(diagnostic: Diagnostic): boolean {
    return diagnostic.severity === 'information'
  },

  isHint(diagnostic: Diagnostic): boolean {
    return diagnostic.severity === 'hint'
  },

  hasSource(diagnostic: Diagnostic, ...sources: DiagnosticSource[]): boolean {
    return matchesSources(diagnostic, sources)
  },
} as const

/** Diagnostics provides helpers for diagnostic collections. */
export const Diagnostics = {
  hasError(diagnostics: readonly Diagnostic[], ...sources: DiagnosticSource[]): boolean {
    return Diagnostics.errors(diagnostics, ...sources).length > 0
  },

  hasWarning(diagnostics: readonly Diagnostic[], ...sources: DiagnosticSource[]): boolean {
    return Diagnostics.warnings(diagnostics, ...sources).length > 0
  },

  errors(diagnostics: readonly Diagnostic[], ...sources: DiagnosticSource[]): Diagnostic[] {
    return bySources(diagnostics, sources).filter(Diagnostic.isError)
  },

  warnings(diagnostics: readonly Diagnostic[], ...sources: DiagnosticSource[]): Diagnostic[] {
    return bySources(diagnostics, sources).filter(Diagnostic.isWarning)
  },

  hasSource(diagnostics: readonly Diagnostic[], ...sources: DiagnosticSource[]): boolean {
    return diagnostics.some(diagnostic => Diagnostic.hasSource(diagnostic, ...sources))
  },

  allFromSource(diagnostics: readonly Diagnostic[], ...sources: DiagnosticSource[]): boolean {
    return diagnostics.every(diagnostic => Diagnostic.hasSource(diagnostic, ...sources))
  },

  allWithSeverity(
    diagnostics: readonly Diagnostic[],
    severity: DiagnosticSeverity,
    ...sources: DiagnosticSource[]
  ): boolean {
    return bySources(diagnostics, sources).every(diagnostic => diagnostic.severity === severity)
  },

  hasMessageContaining(
    diagnostics: readonly Diagnostic[],
    text: string,
    ...sources: DiagnosticSource[]
  ): boolean {
    return bySources(diagnostics, sources).some(diagnostic => diagnostic.message.includes(text))
  },

  allMessagesContain(
    diagnostics: readonly Diagnostic[],
    text: string,
    ...sources: DiagnosticSource[]
  ): boolean {
    return bySources(diagnostics, sources).every(diagnostic => diagnostic.message.includes(text))
  },

  messages(diagnostics: readonly Diagnostic[], ...sources: DiagnosticSource[]): string[] {
    return bySources(diagnostics, sources).map(diagnostic => diagnostic.message)
  },

  errorMessages(diagnostics: readonly Diagnostic[], ...sources: DiagnosticSource[]): string[] {
    return Diagnostics.messages(Diagnostics.errors(diagnostics, ...sources))
  },

  unique(diagnostics: readonly Diagnostic[]): Diagnostic[] {
    const seen = new Set<string>()
    return diagnostics.filter((diagnostic) => {
      const key = diagnosticKey(diagnostic)
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
  },
} as const

function bySources(diagnostics: readonly Diagnostic[], sources: readonly DiagnosticSource[]): Diagnostic[] {
  return diagnostics.filter(diagnostic => matchesSources(diagnostic, sources))
}

function diagnosticKey(diagnostic: Diagnostic): string {
  return `${diagnostic.source}:${diagnostic.severity}:${diagnostic.filePath ?? ''}:${
    diagnostic.nodeType ?? ''
  }:${diagnostic.message}:${rangeKey(diagnostic.range)}`
}

function matchesSources(diagnostic: Diagnostic, sources: readonly DiagnosticSource[]): boolean {
  return sources.length === 0 || sources.includes(diagnostic.source)
}

function rangeKey(range: DiagnosticRange | undefined): string {
  if (!range) {
    return ''
  }
  return `${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`
}
