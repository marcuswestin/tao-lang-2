import { Describe, Expect, Test } from '@shared/test'
import type { LexResult } from '../parser-src/parser'
import { rejectsLexer, testLexCode } from './test-parse'

Describe('parser: lexer', () => {
  Test('lexes identifiers', () => {
    const result = testLexCode('_foo bar123 _under_score')

    Expect(tokenImages(result)).toEqual(['_foo', 'bar123', '_under_score'])
  })

  Test('lexes double-quoted strings', () => {
    const result = testLexCode('"hello world" "hello \\"world\\""')

    Expect(tokenNames(result)).toEqual(['STRING', 'STRING'])
    Expect(tokenImages(result)).toEqual(['"hello world"', '"hello \\"world\\""'])
  })

  Test('switches lexer modes for interpolated strings and nested expression braces', () => {
    const result = testLexCode('"Hello { Greeting }, { action { } }!"')

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
    const result = testLexCode('"literal \\{ brace, \\"quote\\", and \\\\ slash"')

    Expect(tokenNames(result)).toEqual(['STRING'])
  })

  Test('ignores line and block comments', () => {
    const result = testLexCode('view // comment\nMainView /* block */')

    Expect(tokenImages(result)).toEqual(['view', 'MainView'])
    Expect(result.hidden.map(token => token.image)).toEqual(['// comment', '/* block */'])
  })

  Test('lexes ts code blocks', () => {
    const result = testLexCode('```ts\nconst x = 1\n```')

    Expect(tokenNames(result)).toEqual(['TS_CODE_BLOCK'])
    Expect(tokenImages(result)).toEqual(['```ts\nconst x = 1\n```'])
  })

  Test('lexes a reserved word as a contextual boolean no-case alias', () => {
    const result = testLexCode('Enabled yes / no Name (default Enabled)')

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

  Test('lexes tags and hexadecimal design colors through one contextual token', () => {
    const result = testLexCode('#screen #121826 #f6f7f3 #abc_123')

    Expect(tokenNames(result)).toEqual([
      'TagOrHexColor',
      'TagOrHexColor',
      'TagOrHexColor',
      'TagOrHexColor',
    ])
    Expect(tokenImages(result)).toEqual(['#screen', '#121826', '#f6f7f3', '#abc_123'])
  })

  for (const character of ['@', '$']) {
    Test(`rejects unknown ${character} characters`, rejectsLexer(character, character))
  }

  Test('rejects unclosed ts code blocks', rejectsLexer('```ts\nconst x = 1', '`'))
})

function tokenImages(result: LexResult): string[] {
  return result.tokens.map(token => token.image)
}

function tokenNames(result: LexResult): string[] {
  return result.tokens.map(token => token.tokenType.name)
}
