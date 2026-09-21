import { Diagnostics } from '@shared'
import { Expect } from '@shared/test'
import { type LexResult, Parser, type ParseResult } from '../parser-src/parser'

/** testLexCode lexes Tao source and asserts that no lexer errors were produced. */
export function testLexCode(source: string): LexResult {
  const result = Parser.lexCode(source)

  Expect(result.errors).toEqual([])
  return result
}

/** lexCodeWithErrors lexes Tao source and asserts that lexer errors were produced. */
export function lexCodeWithErrors(source: string): LexResult {
  const result = Parser.lexCode(source)

  Expect(result.errors.length).toBeGreaterThan(0)
  return result
}

/** testParseSyntax parses Tao source and asserts that no lexer or parser errors were produced. */
export async function testParseSyntax(source: string): Promise<ParseResult> {
  const parseResult = await Parser.parseCode(source)

  expectNoLexerErrors(parseResult)
  expectNoParserErrors(parseResult)
  return parseResult
}

/** testParseCode parses Tao source and asserts that no errors were produced. */
export async function testParseCode(source: string): Promise<ParseResult> {
  const parseResult = await testParseSyntax(source)

  expectNoDiagnostics(parseResult)
  return parseResult
}

/** parseCodeWithErrors parses Tao source and asserts that parser diagnostics were produced. */
export async function parseCodeWithErrors(source: string): Promise<ParseResult> {
  const parseResult = await Parser.parseCode(source)

  Expect(Diagnostics.hasError(parseResult.diagnostics)).toBe(true)
  return parseResult
}

/** parses returns a test callback that parses clean Tao source before making optional focused assertions. */
export function parses(
  source: string,
  assertResult?: (result: ParseResult) => Promise<void> | void,
): () => Promise<void> {
  return async () => {
    const result = await testParseCode(source)
    await assertResult?.(result)
  }
}

/** rejectsParser returns a test callback that requires parser-owned diagnostics for Tao source. */
export function rejectsParser(source: string): () => Promise<void> {
  return async () => {
    const result = await parseCodeWithErrors(source)

    Expect(result.entry.document.parseResult.lexerErrors).toEqual([])
    Expect(result.entry.document.parseResult.parserErrors.length).toBeGreaterThan(0)
    Expect(Diagnostics.hasSource(result.diagnostics, 'parser')).toBe(true)
  }
}

/** rejectsLexer returns a test callback that requires lexer errors touching the expected text. */
export function rejectsLexer(source: string, ...unexpectedText: string[]): () => void {
  return () => {
    const result = lexCodeWithErrors(source)

    for (const text of unexpectedText) {
      Expect(
        result.errors.some(error =>
          (typeof error.offset === 'number' && source.slice(error.offset).startsWith(text))
          || (error.message ?? '').includes(text)
        ),
      ).toBe(true)
    }
  }
}

function expectNoLexerErrors(parseResult: ParseResult): void {
  Expect(parseResult.entry.document.parseResult.lexerErrors.map(error => error.message)).toEqual([])
}

function expectNoParserErrors(parseResult: ParseResult): void {
  Expect(parseResult.entry.document.parseResult.parserErrors.map(error => error.message)).toEqual([])
}

function expectNoDiagnostics(parseResult: ParseResult): void {
  Expect(parseResult.diagnostics).toEqual([])
}
