import { type Diagnostic, FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { renderDiagnostic, severityWord } from '../cli-src/diagnostic-report'

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
        + '1 | view Main() {\n'
        + '2 |    render NoSuchView()\n'
        + '  |           ^^^^^^^^^^',
    )
  })

  // An underlined fragment on its own reads as an anonymous line of code; the line above it is
  // usually the declaration header, which is what makes the reader recognize where they are.
  Test('leads with the line above the mistake, and has none to lead with on the first line', () => {
    const firstLine = diagnostic({ range: { start: { line: 0, character: 5 }, end: { line: 0, character: 9 } } })

    Expect(renderDiagnostic(firstLine, source).split('\n')[1]).toBe('1 | view Main() {')
    Expect(renderDiagnostic(firstLine, source).split('\n')).toHaveLength(3)
  })

  // A two-row excerpt can straddle a change of width, and a ragged gutter breaks the column the
  // carets line up in.
  Test('pads both line numbers to one gutter width when they differ', () => {
    const tenLines = `${'view Main() {\n'.repeat(9)}   render NoSuchView()\n`
    const onLineTen = diagnostic({ range: { start: { line: 9, character: 10 }, end: { line: 9, character: 20 } } })

    Expect(renderDiagnostic(onLineTen, tenLines).split('\n').slice(1)).toEqual([
      ' 9 | view Main() {',
      '10 |    render NoSuchView()',
      '   |           ^^^^^^^^^^',
    ])
  })

  Test('names the severity so the reader does not depend on the terminal color', () => {
    Expect(severityWord(diagnostic())).toBe('error')
    Expect(severityWord(diagnostic({ severity: 'warning' }))).toBe('warning')
    Expect(severityWord(diagnostic({ severity: 'information' }))).toBe('info')
    Expect(severityWord(diagnostic({ severity: 'hint' }))).toBe('hint')
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
