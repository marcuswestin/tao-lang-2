import { Describe, Expect, Test } from '@shared/test'
import type { LexResult } from '../parser-src/parser'
import { lexCodeWithErrors, testLexCode } from './test-parse'

Describe('minimal Tao lexer', () => {
  Test('lexes identifiers', () => {
    const result = expectLexes('_foo bar123 _under_score')

    Expect(tokenImages(result)).toEqual(['_foo', 'bar123', '_under_score'])
  })

  Test('lexes double-quoted strings', () => {
    const result = expectLexes('"hello world" "hello \\"world\\""')

    Expect(tokenNames(result)).toEqual(['STRING', 'STRING'])
    Expect(tokenImages(result)).toEqual(['"hello world"', '"hello \\"world\\""'])
  })

  Test('switches lexer modes for interpolated strings and nested expression braces', () => {
    const result = expectLexes('"Hello { Greeting }, { action { } }!"')

    Expect(tokenNames(result)).toEqual([
      'INTERPOLATED_STRING_START',
      'STRING_TEXT',
      'INTERPOLATION_START',
      'ID',
      '}',
      'STRING_TEXT',
      'INTERPOLATION_START',
      'action',
      '{',
      '}',
      '}',
      'STRING_TEXT',
      'STRING_END',
    ])
  })

  Test('keeps escaped braces in ordinary strings', () => {
    const result = expectLexes('"literal \\{ brace, \\"quote\\", and \\\\ slash"')

    Expect(tokenNames(result)).toEqual(['STRING'])
  })

  Test('ignores line and block comments', () => {
    const result = expectLexes('view // comment\nMainView /* block */')

    Expect(tokenImages(result)).toEqual(['view', 'MainView'])
    Expect(result.hidden.map(token => token.image)).toEqual(['// comment', '/* block */'])
  })

  Test('lexes ts code blocks', () => {
    const result = expectLexes('```ts\nconst x = 1\n```')

    Expect(tokenNames(result)).toEqual(['TS_CODE_BLOCK'])
    Expect(tokenImages(result)).toEqual(['```ts\nconst x = 1\n```'])
  })

  Test('lexes a reserved word as a contextual boolean no-case alias', () => {
    const result = expectLexes('Enabled yes / no Name (default Enabled)')

    Expect(tokenNames(result)).toEqual([
      'ID',
      'yes',
      '/',
      'no',
      'BOOLEAN_NO_ALIAS',
      '(',
      'default',
      'ID',
      ')',
    ])
  })

  Test('rejects unknown characters', () => {
    expectLexErrors('@', '@')
    expectLexErrors('#', '#')
    expectLexErrors('$', '$')
  })

  Test('rejects unclosed ts code blocks', () => {
    expectLexErrors('```ts\nconst x = 1', '`')
  })
})

function expectLexes(source: string): LexResult {
  return testLexCode(source)
}

function expectLexErrors(source: string, ...unexpectedCharacters: string[]): LexResult {
  const result = lexCodeWithErrors(source)

  for (const unexpectedCharacter of unexpectedCharacters) {
    Expect(
      result.errors.some(error => errorTouches(error, source, unexpectedCharacter)),
    ).toBe(true)
  }

  return result
}

function errorTouches(error: { offset?: number; message?: string }, source: string, text: string): boolean {
  return (
    (typeof error.offset === 'number' && source.slice(error.offset).startsWith(text))
    || (error.message ?? '').includes(text)
  )
}

function tokenImages(result: LexResult): string[] {
  return result.tokens.map(token => token.image)
}

function tokenNames(result: LexResult): string[] {
  return result.tokens.map(token => token.tokenType.name)
}
