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
    if (!Array.isArray(built)) {
      throw new Error('Tao expects Langium default tokens before installing lexer modes.')
    }
    const tokens = built as MutableTokenType[]
    const byName = new Map(tokens.map(token => [token.name, token]))
    const interpolatedStart = requiredToken(byName, 'INTERPOLATED_STRING_START')
    const stringText = requiredToken(byName, 'STRING_TEXT')
    const stringEnd = requiredToken(byName, 'STRING_END')
    const interpolationStart = requiredToken(byName, 'INTERPOLATION_START')
    const booleanNoAlias = requiredToken(byName, 'BOOLEAN_NO_ALIAS')
    const identifier = requiredToken(byName, 'ID')
    const openBrace = requiredToken(byName, '{')
    const closeBrace = requiredToken(byName, '}')

    interpolatedStart.PATTERN = matchInterpolatedStringStart
    interpolatedStart.LINE_BREAKS = false
    interpolatedStart.START_CHARS_HINT = ['"']
    interpolatedStart.PUSH_MODE = stringMode
    stringEnd.POP_MODE = true
    interpolationStart.PUSH_MODE = expressionMode
    booleanNoAlias.PATTERN = matchBooleanNoAlias
    booleanNoAlias.LINE_BREAKS = false
    booleanNoAlias.START_CHARS_HINT = identifierStarts
    tokens.splice(tokens.indexOf(booleanNoAlias), 1)
    // The optional no-case alias may itself be an otherwise reserved word (`Name`, for example),
    // so its contextual token must win before both keywords and the ordinary identifier token.
    tokens.unshift(booleanNoAlias)
    // Capitalized app-property words remain usable in ordinary declaration/reference positions.
    for (const name of ['Name', 'Navigator', 'Datasource']) {
      const keyword = requiredToken(byName, name)
      keyword.CATEGORIES = [...(keyword.CATEGORIES ?? []), identifier]
      keyword.LONGER_ALT = identifier
    }

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
  if (!token) {
    throw new Error(`Tao lexer token '${name}' was not generated.`)
  }
  return token
}

const quotePattern = /"/y
const identifierPattern = /[_a-zA-Z][\w_]*/y
const identifierStarts = [
  '_',
  ...'abcdefghijklmnopqrstuvwxyz',
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
]

/** Matches an optional boolean no-case alias only on the same line as `yes / no`. */
function matchBooleanNoAlias(text: string, offset: number): RegExpExecArray | null {
  const lineStart = Math.max(text.lastIndexOf('\n', offset - 1), text.lastIndexOf('\r', offset - 1)) + 1
  if (!/\byes\s*\/\s*no[ \t]+$/.test(text.slice(lineStart, offset))) {
    return null
  }
  identifierPattern.lastIndex = offset
  return identifierPattern.exec(text)
}

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
