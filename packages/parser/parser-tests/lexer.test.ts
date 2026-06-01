import { describe, expect, test } from 'bun:test'
import { lexTaoSource } from '../parser-src/parser'

describe('minimal Tao lexer', () => {
  test('lexes identifiers', () => {
    const result = expectLexes('_foo bar123 _under_score')

    expect(tokenImages(result)).toEqual(['_foo', 'bar123', '_under_score'])
  })

  test('lexes double-quoted strings', () => {
    const result = expectLexes('"hello world" "hello \\"world\\""')

    expect(tokenNames(result)).toEqual(['STRING', 'STRING'])
    expect(tokenImages(result)).toEqual(['"hello world"', '"hello \\"world\\""'])
  })

  test('ignores line and block comments', () => {
    const result = expectLexes('ui // comment\nMainView /* block */')

    expect(tokenImages(result)).toEqual(['ui', 'MainView'])
    expect(result.hidden.map(token => token.image)).toEqual(['// comment', '/* block */'])
  })

  test('lexes ts code blocks', () => {
    const result = expectLexes('```ts\nconst x = 1\n```')

    expect(tokenNames(result)).toEqual(['TS_CODE_BLOCK'])
    expect(tokenImages(result)).toEqual(['```ts\nconst x = 1\n```'])
  })

  test('rejects unknown characters', () => {
    expectLexErrors('@', '@')
    expectLexErrors('#', '#')
    expectLexErrors('$', '$')
  })

  test('rejects unclosed ts code blocks', () => {
    expectLexErrors('```ts\nconst x = 1', '`')
  })
})

function expectLexes(source: string): ReturnType<typeof lexTaoSource> {
  const result = lexTaoSource(source)
  expect(result.errors).toEqual([])
  return result
}

function expectLexErrors(source: string, ...unexpectedCharacters: string[]): ReturnType<typeof lexTaoSource> {
  const result = lexTaoSource(source)
  expect(result.errors.length).toBeGreaterThan(0)

  for (const unexpectedCharacter of unexpectedCharacters) {
    expect(
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

function tokenImages(result: ReturnType<typeof lexTaoSource>): string[] {
  return result.tokens.map(token => token.image)
}

function tokenNames(result: ReturnType<typeof lexTaoSource>): string[] {
  return result.tokens.map(token => token.tokenType.name)
}
