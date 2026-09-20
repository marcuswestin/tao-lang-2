import { type Diagnostic, type DiagnosticRange, FS, Switch } from '@shared'

/**
 * DiagnosticReport renders a Tao diagnostic the way a person reads one: where it is, how bad it is,
 * what is wrong, and the line it is on with the offending span underlined. The diagnostics
 * themselves carry all of that already; before this module the CLI printed only the sentence, and
 * only for warnings.
 */

/** severityWord names a diagnostic severity in the one word a reader scans for. */
export function severityWord(diagnostic: Diagnostic): string {
  return Switch(diagnostic.severity, {
    error: () => 'error',
    warning: () => 'warning',
    information: () => 'info',
    hint: () => 'hint',
  })
}

/** diagnosticLocation returns `path:line:column`, or just the path when the diagnostic has no range. */
export function diagnosticLocation(diagnostic: Diagnostic): string {
  const path = FS.displayPath(diagnostic.filePath ?? '')
  if (diagnostic.range === undefined) {
    return path
  }
  return `${path}:${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1}`
}

/**
 * renderDiagnostic returns the block for one diagnostic: a located headline, then the source around
 * it with the offending span underlined, when `source` holds the file the diagnostic points into. A
 * diagnostic whose range has scrolled off the end of the source renders as the headline alone
 * rather than guessing.
 */
export function renderDiagnostic(diagnostic: Diagnostic, source?: string): string {
  const headline = `${diagnosticLocation(diagnostic)} ${severityWord(diagnostic)}: ${diagnostic.message}`
  const excerpt = diagnostic.range === undefined || source === undefined
    ? undefined
    : sourceExcerpt(diagnostic.range, source)
  return excerpt === undefined ? headline : `${headline}\n${excerpt}`
}

/**
 * sourceExcerpt returns the line the diagnostic points at with a caret underline for its span, led
 * by the line above it. One line of lead-in is what turns an underlined fragment back into code the
 * reader recognizes — it is usually the `view` or `action` header the mistake sits inside — and a
 * second would start scrolling the terminal for no more recognition.
 */
function sourceExcerpt(range: DiagnosticRange, source: string): string | undefined {
  const lines = source.split('\n')
  const line = lines[range.start.line]
  if (line === undefined) {
    return undefined
  }
  const text = sourceLineText(line)
  const start = Math.min(range.start.character, text.length)
  const end = range.end.line === range.start.line ? Math.min(range.end.character, text.length) : text.length
  const underline = ' '.repeat(start) + '^'.repeat(Math.max(end - start, 1))
  // The widest number shown is the offending line's own, so it sets the gutter every row pads to.
  const width = String(range.start.line + 1).length
  const preceding = lines[range.start.line - 1]
  return [
    ...(preceding === undefined ? [] : [numberedRow(range.start.line, width, sourceLineText(preceding))]),
    numberedRow(range.start.line + 1, width, text),
    `${' '.repeat(width)} | ${underline}`,
  ].join('\n')
}

/** numberedRow returns one excerpt row, its line number padded to the block's gutter width. */
function numberedRow(lineNumber: number, width: number, text: string): string {
  return `${String(lineNumber).padStart(width)} | ${text}`
}

/** sourceLineText returns one source line as the excerpt shows it. */
function sourceLineText(line: string): string {
  // Tao indents with spaces, but a stray tab would still slide the carets out from under the span.
  return line.replaceAll('\t', ' ')
}
