import { Diagnostics } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { AST } from '../parser-src/parser'
import { lexCodeWithErrors, parseCodeWithErrors, testParseCode } from './test-parse'

Describe('minimal Tao parser diagnostics', () => {
  Test('parses compact source without newlines', async () => {
    const parseResult = await testParseCode('app MyApp { ui MyView } ui MyView { }')

    Expect(parseResult.entry.ast.statements).toHaveLength(2)
  })

  Test('parses unknown leading identifiers for later validator checks', async () => {
    const parseResult = await parseCodeWithErrors('view Legacy { }')

    Expect(parseResult.entry.document.parseResult.parserErrors).toEqual([])
    Expect.Is(parseResult.entry.ast.statements[0], AST.isViewRender)
    Expect(Diagnostics.allFromSource(parseResult.diagnostics, 'linker')).toBe(true)
    Expect(Diagnostics.allWithSeverity(parseResult.diagnostics, 'error')).toBe(true)
    Expect(Diagnostics.hasMessageContaining(parseResult.diagnostics, 'Could not resolve reference')).toBe(true)
  })

  Test('reports parser errors for incomplete render statements', async () => {
    const parseResult = await parseCodeWithErrors('ui Broken { render }')
    const parserDiagnostics = Diagnostics.errors(parseResult.diagnostics, 'parser')

    Expect(parseResult.entry.document.parseResult.parserErrors.length).toBeGreaterThan(0)
    Expect(parseResult.diagnostics.length).toBeGreaterThan(0)
    Expect(parserDiagnostics.every(diagnostic => diagnostic.range !== undefined)).toBe(true)
  })

  Test('parses nested declarations for later validator checks', async () => {
    const parseResult = await testParseCode('app MyApp { ui MyView } ui MyView { ui Nested { } }')

    Expect(parseResult.entry.ast.statements).toHaveLength(2)
  })

  Test('parses aliases in app blocks for later validator checks', async () => {
    const parseResult = await testParseCode('app MyApp { alias Greeting = "hello" ui MyView } ui MyView { }')

    Expect(parseResult.entry.ast.statements).toHaveLength(2)
  })

  Test('parses top-level renders for later validator checks', async () => {
    const parseResult = await testParseCode('render Text "hello" ui Text Value text { }')

    Expect(parseResult.entry.ast.statements).toHaveLength(2)
  })

  Test('parses number-typed parameters in semantically invalid positions', async () => {
    const parseResult = await testParseCode(`
      app MyApp { ui MyView }
      ui MyView Count number {
        render Text Count { }
      }
      ui Text Value text { }
    `)

    Expect(parseResult.entry.ast.statements).toHaveLength(3)
  })

  Test('reports linker diagnostics for values outside their owning view', async () => {
    const parseResult = await parseCodeWithErrors(`
      ui Text Value text { }
      ui Source Secret text {
        alias Local = Secret
      }
      ui Target {
        render Text Secret { }
        render Text Local { }
      }
    `)

    Expect(parseResult.entry.document.parseResult.lexerErrors).toEqual([])
    Expect(parseResult.entry.document.parseResult.parserErrors).toEqual([])
    Expect(parseResult.diagnostics).toHaveLength(2)
    Expect(Diagnostics.allFromSource(parseResult.diagnostics, 'linker')).toBe(true)
    Expect(Diagnostics.allWithSeverity(parseResult.diagnostics, 'error')).toBe(true)
    Expect(Diagnostics.allMessagesContain(parseResult.diagnostics, 'Could not resolve reference')).toBe(true)
  })

  Test('reports lexer errors separately from parser errors', async () => {
    const source = 'app MyApp { ui MyView } @ ui MyView { }'
    lexCodeWithErrors(source)
    const parseResult = await parseCodeWithErrors(source)

    Expect(parseResult.entry.document.parseResult.lexerErrors.length).toBeGreaterThan(0)
    Expect(parseResult.diagnostics.length).toBeGreaterThan(0)
    Expect(Diagnostics.hasSource(parseResult.diagnostics, 'lexer')).toBe(true)
    Expect(Diagnostics.errors(parseResult.diagnostics, 'lexer').every(diagnostic => diagnostic.range !== undefined))
      .toBe(true)
    Expect(Diagnostics.hasSource(parseResult.diagnostics, 'linker')).toBe(false)
  })

  Test('reports parser errors for malformed use statements', async () => {
    const parseResult = await parseCodeWithErrors('use Text from')
    const parserMessages = parseResult.entry.document.parseResult.parserErrors.map(error => error.message)
    const linkerMessages = Diagnostics.messages(parseResult.diagnostics, 'linker')

    Expect(parseResult.entry.document.parseResult.parserErrors.length).toBeGreaterThan(0)
    Expect(parseResult.diagnostics.length).toBeGreaterThan(0)
    Expect(Diagnostics.hasSource(parseResult.diagnostics, 'parser')).toBe(true)
    Expect(linkerMessages.some(message => parserMessages.includes(message))).toBe(false)
  })
})
