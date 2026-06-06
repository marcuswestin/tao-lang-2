import { Expect } from '@shared/test'
import { Parser, type ParseResult } from '../parser-src/parser'

/** testParseCode parses Tao source and asserts that no errors were produced. */
export async function testParseCode(source: string): Promise<ParseResult> {
  const parsed = await Parser.parseCode(source)

  expectNoLexerErrors(parsed)
  expectNoParserErrors(parsed)
  expectNoDiagnostics(parsed)
  return parsed
}

/** testParseCodeWithLexerErrors parses Tao source expected to contain lexer errors. */
export async function testParseCodeWithLexerErrors(source: string): Promise<ParseResult> {
  const parsed = await Parser.parseCode(source)

  Expect(parsed.document.parseResult.lexerErrors.length).toBeGreaterThan(0)
  expectNoParserErrors(parsed)
  return parsed
}

/** testParseCodeWithParserErrors parses Tao source expected to contain parser errors. */
export async function testParseCodeWithParserErrors(source: string): Promise<ParseResult> {
  const parsed = await Parser.parseCode(source)

  expectNoLexerErrors(parsed)
  Expect(parsed.document.parseResult.parserErrors.length).toBeGreaterThan(0)
  return parsed
}

function expectNoLexerErrors(parsed: ParseResult): void {
  Expect(parsed.document.parseResult.lexerErrors.map(error => error.message)).toEqual([])
}

function expectNoParserErrors(parsed: ParseResult): void {
  Expect(parsed.document.parseResult.parserErrors.map(error => error.message)).toEqual([])
}

function expectNoDiagnostics(parsed: ParseResult): void {
  Expect(parsed.diagnostics.map(diagnostic => diagnostic.message)).toEqual([])
}
