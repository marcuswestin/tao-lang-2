import { Diagnostics } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { lexCodeWithErrors, parseCodeWithErrors, parses, rejectsParser } from './test-parse'

Describe('parser: diagnostics', () => {
  Test(
    'parses compact source without newlines',
    parses('app MyApp { view MyView } view MyView() { }', result => {
      Expect(result.entry.ast.statements).toHaveLength(2)
    }),
  )

  Test('requires parentheses for child renders', rejectsParser('Legacy { }'))

  Test('reports parser errors for incomplete render statements', async () => {
    const parseResult = await parseCodeWithErrors('view Broken() { render }')
    const parserDiagnostics = Diagnostics.errors(parseResult.diagnostics, 'parser')

    Expect(parseResult.entry.document.parseResult.parserErrors.length).toBeGreaterThan(0)
    Expect(parseResult.diagnostics.length).toBeGreaterThan(0)
    Expect(parserDiagnostics.every(diagnostic => diagnostic.range !== undefined)).toBe(true)
  })

  Test('requires parentheses for explicit renders', rejectsParser('render Text "hello"'))

  Test('requires parentheses for action invocations', rejectsParser('action Save() { } action Run() { do Save }'))

  Test(
    'parses nested declarations for later validator checks',
    parses('app MyApp { view MyView } view MyView() { view Nested() { } }', result => {
      Expect(result.entry.ast.statements).toHaveLength(2)
    }),
  )

  Test(
    'parses aliases in app blocks for later validator checks',
    parses('app MyApp { let Greeting = "hello" view MyView } view MyView() { }', result => {
      Expect(result.entry.ast.statements).toHaveLength(2)
    }),
  )

  Test(
    'parses top-level renders for later validator checks',
    parses('render Text("hello") { } view Text(Value text) { }', result => {
      Expect(result.entry.ast.statements).toHaveLength(2)
    }),
  )

  Test(
    'parses number-typed parameters in semantically invalid positions',
    parses(
      `
        app MyApp { view MyView }
        view MyView(Count number) {
          render Text(Count) { }
        }
        view Text(Value text) { }
      `,
      result => {
        Expect(result.entry.ast.statements).toHaveLength(3)
      },
    ),
  )

  // Parameter types are juxtaposed; the retired `Name is Type` form is a parser error.
  Test('reports parser errors for the retired is-typed parameter syntax', rejectsParser('view Text(Value is text) { }'))

  Test('reports linker diagnostics for values outside their owning view', async () => {
    const parseResult = await parseCodeWithErrors(`
      view Text(Value text) { }
      view Source(Secret text) {
        let Local = Secret
      }
      view Target() {
        render Text(Secret) { }
        render Text(Local) { }
      }
    `)

    Expect(parseResult.entry.document.parseResult.lexerErrors).toEqual([])
    Expect(parseResult.entry.document.parseResult.parserErrors).toEqual([])
    Expect(parseResult.diagnostics).toHaveLength(2)
    Expect(Diagnostics.allFromSource(parseResult.diagnostics, 'linker')).toBe(true)
    Expect(Diagnostics.allWithSeverity(parseResult.diagnostics, 'error')).toBe(true)
    Expect(Diagnostics.allMessagesContain(parseResult.diagnostics, 'Could not resolve reference')).toBe(true)
  })

  Test('limits replacement targets to app declarations', async () => {
    const parseResult = await parseCodeWithErrors(`
      let SignedOutNav = 1
      let Tagline = "Not an app"
      app WordFlower { view Home }
      view Home() { }
      action Reset() {
        replace SignedOutNav in Tagline
      }
    `)

    Expect(parseResult.entry.document.parseResult.lexerErrors).toEqual([])
    Expect(parseResult.entry.document.parseResult.parserErrors).toEqual([])
    Expect(parseResult.diagnostics).toHaveLength(1)
    Expect(Diagnostics.allFromSource(parseResult.diagnostics, 'linker')).toBe(true)
    Expect(
      Diagnostics.allMessagesContain(parseResult.diagnostics, 'Could not resolve reference to AppValueDeclaration'),
    )
      .toBe(true)
  })

  Test('reports lexer errors separately from parser errors', async () => {
    const source = 'app MyApp { view MyView } @ view MyView() { }'
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
