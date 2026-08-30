import { Errors, FS, Repo } from '@shared'
import { createHighlighterCore } from '@shikijs/core'
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript'
import tsxLanguage from '@shikijs/langs/tsx'
import githubDarkTheme from '@shikijs/themes/github-dark'
import type { GrammarState, HighlighterCore, LanguageRegistration, ThemedToken } from '@shikijs/types'

export type StudioHighlightRequest = {
  content: string
}

export type StudioLanguageHighlightToken = {
  color?: string
  from: number
  to: number
}

export type StudioLanguageHighlight = {
  tokens: readonly StudioLanguageHighlightToken[]
}

type TaoTextMateGrammar = Record<string, unknown> & {
  scopeName?: string
}

const maximumHighlightLength = 1_000_000
const taoLanguageName = 'tao-lang'
const taoThemeName = 'github-dark'
let highlighterPromise: Promise<HighlighterCore> | undefined

/** StudioHighlight applies the IDE's generated TextMate grammar through server-side Shiki. */
export const StudioHighlight = {
  highlight,
  testing: {
    tokenize,
  },
} as const

async function highlight(input: unknown): Promise<StudioLanguageHighlight> {
  const request = highlightRequest(input)
  return { tokens: await tokenize(request.content) }
}

async function tokenize(content: string): Promise<readonly StudioLanguageHighlightToken[]> {
  const highlighter = await createHighlighter()
  const tokens: StudioLanguageHighlightToken[] = []
  let grammarState: GrammarState | undefined
  let offset = 0

  for (const line of content.split('\n')) {
    const result = highlighter.codeToTokens(line, {
      grammarState,
      lang: taoLanguageName,
      theme: taoThemeName,
    })
    grammarState = result.grammarState
    for (const token of result.tokens[0] ?? []) {
      const highlighted = highlightToken(offset, token)
      if (highlighted !== undefined) {
        tokens.push(highlighted)
      }
    }
    offset += line.length + 1
  }

  return tokens
}

function highlightRequest(input: unknown): StudioHighlightRequest {
  if (
    typeof input !== 'object'
    || input === null
    || !('content' in input)
    || typeof input.content !== 'string'
  ) {
    throw new Errors.UserInputError('Expected Tao source content for Studio highlighting.')
  }
  if (input.content.length > maximumHighlightLength) {
    throw new Errors.UserInputError(`Studio highlighting is limited to ${maximumHighlightLength} characters.`)
  }
  return { content: input.content }
}

function highlightToken(lineOffset: number, token: ThemedToken): StudioLanguageHighlightToken | undefined {
  if (token.color === undefined || token.content.length === 0) {
    return undefined
  }
  return {
    color: token.color,
    from: lineOffset + token.offset,
    to: lineOffset + token.offset + token.content.length,
  }
}

function createHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterWithShiki()
  return highlighterPromise
}

async function createHighlighterWithShiki(): Promise<HighlighterCore> {
  const grammar = await FS.readJson<TaoTextMateGrammar>(Repo.resolvePath(
    'packages/ide-extension/ide-extension-syntaxes/_gen_syntaxes/tao-lang.tmLanguage.json',
  ))
  if (grammar.scopeName !== 'source.tao-lang') {
    throw new Error('The generated Tao TextMate grammar has an unexpected scope name.')
  }
  return await createHighlighterCore({
    engine: createJavaScriptRegexEngine(),
    langs: [{
      ...(grammar as unknown as LanguageRegistration),
      aliases: ['tao'],
      embeddedLangs: ['tsx'],
      name: taoLanguageName,
    }, tsxLanguage],
    themes: [githubDarkTheme],
  })
}
