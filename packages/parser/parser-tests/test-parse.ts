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

function expectNoLexerErrors(parseResult: ParseResult): void {
  Expect(parseResult.entry.document.parseResult.lexerErrors.map(error => error.message)).toEqual([])
}

function expectNoParserErrors(parseResult: ParseResult): void {
  Expect(parseResult.entry.document.parseResult.parserErrors.map(error => error.message)).toEqual([])
}

function expectNoDiagnostics(parseResult: ParseResult): void {
  Expect(parseResult.diagnostics).toEqual([])
}
