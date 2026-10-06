import { Assert } from '@shared'
import { DefaultTokenBuilder, type Grammar, type TokenBuilderOptions } from 'langium'

const expressionMode = 'expression'
const stringMode = 'interpolated-string'

type MutableTokenType = {
  name: string
  PATTERN: unknown
  PUSH_MODE?: string
  POP_MODE?: boolean
  LINE_BREAKS?: boolean
  START_CHARS_HINT?: string[]
  LONGER_ALT?: MutableTokenType | MutableTokenType[]
  CATEGORIES?: MutableTokenType[]
}

/** TaoTokenBuilder switches between ordinary Tao expressions and interpolated-string text. */
export class TaoTokenBuilder extends DefaultTokenBuilder {
  override buildTokens(
    grammar: Grammar,
    options?: TokenBuilderOptions,
  ): ReturnType<DefaultTokenBuilder['buildTokens']> {
    const built = super.buildTokens(grammar, options)
    Assert(Array.isArray(built), 'Langium to build default tokens before Tao installs lexer modes')
    const tokens = built as MutableTokenType[]
    const byName = new Map(tokens.map(token => [token.name, token]))
    // Install before lexer and parser construction so lowercase names also satisfy every ID rule.
    requiredToken(byName, 'NUMERIC_UNIT_ID').CATEGORIES = [requiredToken(byName, 'ID')]
    const interpolatedStart = requiredToken(byName, 'INTERPOLATED_STRING_START')
    const stringText = requiredToken(byName, 'STRING_TEXT')
    const stringEnd = requiredToken(byName, 'STRING_END')
    const interpolationStart = requiredToken(byName, 'INTERPOLATION_START')
    const openBrace = requiredToken(byName, '{')
    const closeBrace = requiredToken(byName, '}')

    interpolatedStart.PATTERN = matchInterpolatedStringStart
    interpolatedStart.LINE_BREAKS = false
    interpolatedStart.START_CHARS_HINT = ['"']
    interpolatedStart.PUSH_MODE = stringMode
    stringEnd.POP_MODE = true
    interpolationStart.PUSH_MODE = expressionMode
    // Pushing the expression mode for every ordinary brace makes nested action/item/block
    // expressions balance naturally. The final interpolation brace then returns to string mode.
    openBrace.PUSH_MODE = expressionMode
    closeBrace.POP_MODE = true

    const stringOnly = new Set([stringText, stringEnd, interpolationStart])
    for (const token of tokens) {
      token.LONGER_ALT = withoutModeExternalAlternatives(token.LONGER_ALT, stringOnly)
    }
    return {
      modes: {
        [expressionMode]: tokens.filter(token => !stringOnly.has(token)),
        [stringMode]: [stringEnd, interpolationStart, stringText],
      },
      defaultMode: expressionMode,
    } as unknown as ReturnType<DefaultTokenBuilder['buildTokens']>
  }
}

function withoutModeExternalAlternatives(
  alternatives: MutableTokenType | MutableTokenType[] | undefined,
  excluded: ReadonlySet<MutableTokenType>,
): MutableTokenType | MutableTokenType[] | undefined {
  if (!alternatives) {
    return undefined
  }
  if (Array.isArray(alternatives)) {
    const remaining = alternatives.filter(token => !excluded.has(token))
    return remaining.length > 0 ? remaining : undefined
  }
  return excluded.has(alternatives) ? undefined : alternatives
}

function requiredToken(tokens: ReadonlyMap<string, MutableTokenType>, name: string): MutableTokenType {
  const token = tokens.get(name)
  Assert.defined(token, `the generated Tao lexer to declare token '${name}'`)
  return token
}

const quotePattern = /"/y
/** Matches an opening quote only when its string contains an unescaped interpolation brace. */
function matchInterpolatedStringStart(text: string, offset: number): RegExpExecArray | null {
  if (text[offset] !== '"' || !containsInterpolation(text, offset + 1)) {
    return null
  }
  quotePattern.lastIndex = offset
  return quotePattern.exec(text)
}

function containsInterpolation(text: string, start: number): boolean {
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]
    if (character === '\\') {
      index += 1
      continue
    }
    if (character === '"') {
      return false
    }
    if (character === '{') {
      return true
    }
  }
  return false
}
