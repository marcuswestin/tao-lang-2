import { type Diagnostic, FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { diagnosticLocation, renderDiagnostic, severityWord } from '../cli-src/diagnostic-report'

const source = 'view Main() {\n   render NoSuchView()\n}\n'

function diagnostic(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    filePath: FS.resolvePath('App.tao'),
    message: "No view named 'NoSuchView' is in scope.",
    severity: 'error',
    source: 'linker',
    range: { start: { line: 1, character: 10 }, end: { line: 1, character: 20 } },
    ...overrides,
  }
}

Describe('tao CLI diagnostic rendering', () => {
  Test('renders a located headline over the source line and an underline for the span', () => {
    Expect(renderDiagnostic(diagnostic(), source)).toBe(
      "App.tao:2:11 error: No view named 'NoSuchView' is in scope.\n"
        + '2 |    render NoSuchView()\n'
        + '  |           ^^^^^^^^^^',
    )
  })

  Test('names the severity so the reader does not depend on the terminal color', () => {
    Expect(severityWord(diagnostic())).toBe('error')
    Expect(severityWord(diagnostic({ severity: 'warning' }))).toBe('warning')
    Expect(severityWord(diagnostic({ severity: 'information' }))).toBe('info')
    Expect(severityWord(diagnostic({ severity: 'hint' }))).toBe('hint')
  })

  Test('reports a one-based line and column, because that is what an editor shows', () => {
    Expect(diagnosticLocation(diagnostic())).toBe('App.tao:2:11')
  })

  Test('renders the headline alone when the diagnostic has no range', () => {
    const noRange = { ...diagnostic(), range: undefined }

    Expect(renderDiagnostic(noRange, source)).toBe(
      "App.tao error: No view named 'NoSuchView' is in scope.",
    )
  })

  Test('renders the headline alone when the source is unavailable or has moved on', () => {
    Expect(renderDiagnostic(diagnostic(), undefined)).not.toContain('|')
    Expect(
      renderDiagnostic(
        diagnostic({ range: { start: { line: 99, character: 0 }, end: { line: 99, character: 4 } } }),
        source,
      ),
    )
      .not.toContain('|')
  })

  Test('underlines at least one character for an empty span, and stops at the end of the line', () => {
    const empty = diagnostic({ range: { start: { line: 0, character: 5 }, end: { line: 0, character: 5 } } })
    const overrun = diagnostic({ range: { start: { line: 0, character: 5 }, end: { line: 0, character: 400 } } })

    Expect(renderDiagnostic(empty, source)).toContain('\n  |      ^')
    Expect(renderDiagnostic(overrun, source)).toContain(`\n  |      ${'^'.repeat('view Main() {'.length - 5)}`)
  })
})
