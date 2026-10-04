import { Diagnostics } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { declarationWord, tokenWord } from '../parser-src/grammar-words'
import { Parser } from '../parser-src/parser'
import * as AST from '../parser-src/parserASTExport'
import { parseCodeWithErrors, parses, rejectsParser, testParseCode } from './test-parse'

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
    Expect(parserDiagnostics.every(diagnostic => diagnostic.range !== undefined)).toBe(true)
  })

  Test('requires parentheses for explicit renders', rejectsParser('render Text "hello"'))

  Test(
    'requires call parentheses on a do target, for a command exactly as for an action',
    rejectsParser('action Save() { } action Run() { do Save }'),
  )

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
    Expect(Diagnostics.allMessagesContain(parseResult.diagnostics, ' is in scope.')).toBe(true)
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
    Expect(Diagnostics.errorMessages(parseResult.diagnostics)).toEqual([
      "No app or alias named 'Tagline' is in scope.",
    ])
  })

  Test('reports lexer errors separately from parser errors', async () => {
    const source = 'app MyApp { view MyView } $ view MyView() { }'
    const parseResult = await parseCodeWithErrors(source)

    Expect(parseResult.entry.document.parseResult.lexerErrors.length).toBeGreaterThan(0)
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
    Expect(Diagnostics.hasSource(parseResult.diagnostics, 'parser')).toBe(true)
    Expect(linkerMessages.some(message => parserMessages.includes(message))).toBe(false)
  })

  Test('does not report linker diagnostics for bridged TypeScript export heads', async () => {
    await testParseCode(`
      type HNSource is Http with {
        Adapter item is HNAdapter from ./HNAdapter.ts
      }
    `)
  })

  // A grammar type name is an internal name no Tao program contains, and `packages/AGENTS.md`
  // keeps it out of a diagnostic the author reads.
  Test('names and positions an unresolved render target in Tao words', async () => {
    const parseResult = await Parser.parseCode('view Main() {\n   render NoSuchView()\n}\n')
    const linkerMessages = Diagnostics.errorMessages(parseResult.diagnostics, 'linker')
    const [diagnostic] = Diagnostics.errors(parseResult.diagnostics, 'linker')

    Expect(linkerMessages).toEqual(["No view named 'NoSuchView' is in scope."])
    Expect(diagnostic?.range?.start).toEqual({ line: 1, character: 10 })
    Expect(diagnostic?.range?.end).toEqual({ line: 1, character: 20 })
  })

  Test('spells every grammar cross-reference type as lowercase Tao words', async () => {
    const referenceTypes = Object.values(AST.reflection.types)
      .flatMap(type => Object.values(type.properties))
      .map(property => property.referenceType)
      .filter((referenceType): referenceType is string => referenceType !== undefined)
    const spellings = [...new Set(referenceTypes)].map(referenceType => declarationWord(referenceType))

    Expect(spellings.length).toBeGreaterThan(0)
    Expect(spellings.filter(spelling => /[A-Z]/.test(spelling))).toEqual([])
  })
})

/*
 * Chevrotain builds six syntax error messages and Langium replaces two of them, so Tao registers
 * a provider for each of the six. Every case below asserts the finished sentence, because the
 * sentence is the product surface: a regression in the wording and a regression in the service
 * wiring both read as a changed sentence here.
 */
Describe('parser: syntax diagnostics', () => {
  Test('states the one token a mismatch expected, and what stands there instead', async () => {
    const errors = await syntaxErrors('view Text(Value is text) { }\n')

    Expect(errors[0]).toEqual({
      kind: 'MismatchedTokenException',
      message: 'Expected `)` here, but found `is`.',
    })
  })

  Test('names a terminal by what an author writes in its place, and spells out running off the end', async () => {
    const errors = await syntaxErrors('use Text from')

    Expect(errors[0]).toEqual({
      kind: 'MismatchedTokenException',
      message: 'Expected an import path here, but found the end of the file.',
    })
  })

  Test('states source that runs on past the last declaration', async () => {
    const errors = await syntaxErrors('view Main() { }\n)\n')

    Expect(errors[0]).toEqual({
      kind: 'NotAllInputParsedException',
      message: 'Expected the end of the file here, but found `)`.',
    })
  })

  // Two alternatives fit inside the sentence, so the reader is told exactly what to type.
  Test('names the alternatives when only a few tokens could stand here', async () => {
    const errors = await syntaxErrors('view Main {\n}\n')

    Expect(errors[0]).toEqual({
      kind: 'NoViableAltException',
      message: 'Expected `(` or `=` here, but found `{`.',
    })
  })

  // A view body accepts forty-six different opening tokens, which Chevrotain printed as seventy
  // numbered lines. Naming the construct is the whole point of the threshold.
  Test('names the construct when too many tokens could stand here to list them', async () => {
    const errors = await syntaxErrors('view Broken() {\n  Text is "hi"\n}\n')

    Expect(errors[0]).toEqual({
      kind: 'NoViableAltException',
      message: 'Expected a view member here, but found `Text`.',
    })
  })

  Test('states a repetition that matched nothing at all', async () => {
    const errors = await syntaxErrors('guard default { }\n')

    Expect(errors[0]).toEqual({
      kind: 'EarlyExitException',
      message: 'Expected a guard default case here, but found `}`.',
    })
  })

  Test('states a closing brace that closes nothing', async () => {
    const errors = await syntaxErrors('view Main() {\n}\n}\n')

    Expect(errors[0]).toEqual({
      kind: 'lexer',
      message: 'Expected an open block for this `}` to close, but none is open here.',
    })
  })

  // Every kind of token is legal after `=`, which is too broad a category to act on, so the
  // sentence shows one of each instead of naming three abstractions and a byte offset.
  Test('shows what a character Tao cannot read should have been, by example', async () => {
    const errors = await syntaxErrors('view Main() {\n  let x = §\n}\n')

    Expect(errors[0]).toEqual({
      kind: 'lexer',
      message: 'Expected a name like `Greeting`, a value like `"hello"`, or a keyword like `render` here, '
        + 'but found `§`.',
    })
  })

  Test('keeps malformed-source diagnostics short and actionable', async () => {
    const sources = [
      'view Main() {\n  let Greeting =\n}\n',
    ]
    const errors = await Promise.all(sources.map(syntaxErrors))
    Expect(errors.every(sourceErrors => sourceErrors.length > 0)).toBe(true)
    const messages = errors.flat().map(error => error.message)

    // One line, and short enough to read at a glance: the widest is the one carrying three examples.
    Expect(messages.filter(message => message.includes('\n'))).toEqual([])
    Expect(messages.filter(message => message.length > 110)).toEqual([])
    Expect(messages.filter(message => !message.startsWith('Expected '))).toEqual([])
  })

  // The companion of the cross-reference test above: a terminal name is just as internal as a
  // grammar type name, and an unlisted one still has to come out as words.
  Test('spells every lexer token in Tao words rather than by its terminal name', () => {
    const tokenNames = Object.keys(Parser.createContext().services.language.parser.Lexer.definition)
    const spellings = tokenNames.map(name => ({ name, word: tokenWord({ name }) }))

    Expect(tokenNames.length).toBeGreaterThan(0)
    Expect(spellings.filter(spelling => spelling.word.includes('_'))).toEqual([])
    Expect(spellings.filter(spelling => /[A-Z]/.test(spelling.name) && spelling.word.includes(spelling.name)))
      .toEqual([])
  })
})

/** SyntaxError pairs one syntax diagnostic's sentence with the Chevrotain builder that wrote it. */
type SyntaxError = { kind: string; message: string }

/**
 * syntaxErrors returns a parse's lexer and parser errors in report order. The builder is named
 * alongside the sentence so a case proves which of the six produced it; every lexer error is
 * reported as `lexer`, since its two builders are told apart by their sentences alone.
 */
async function syntaxErrors(source: string): Promise<SyntaxError[]> {
  const { lexerErrors, parserErrors } = (await Parser.parseCode(source)).entry.document.parseResult
  return [
    ...lexerErrors.map(error => ({ kind: 'lexer', message: error.message })),
    ...parserErrors.map(error => ({ kind: error.name, message: error.message })),
  ]
}
