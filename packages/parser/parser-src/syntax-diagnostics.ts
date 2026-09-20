import { AbstractParserErrorMessageProvider, DefaultLexerErrorMessageProvider } from 'langium'
import { asWritten, constructWords, type TokenSpelling, tokenWord, withArticle } from './grammar-words'

/**
 * syntax-diagnostics states every lexer and parser syntax error in Tao's voice. Chevrotain words
 * these for whoever wrote the grammar — it lists token sequences, names lexer modes, and reports
 * byte offsets — and Langium replaces only two of the six. The position, the source line, and the
 * caret a reader needs are already right, so what is replaced here is the sentence alone.
 *
 * The providers are registered in `taoLanguageModule`, which reaches the core parser, the language
 * server, and every workspace or session built on either, so `tao check`, `tao fix`, the LSP, and
 * Studio all read the same sentences.
 */

/**
 * A diagnostic names the tokens it expected only while the deduplicated set is this short; past it
 * the sentence stops being one a reader can scan, and the construct being parsed says more than
 * the list does. Three is the most a single clause carries as "a, b, or c", and the shapes on
 * either side of the line are far apart: a view member offers forty-six alternatives, which is the
 * seventy-line list this replaces, while a view's name is followed by exactly `(` or `=`.
 */
const NAMED_TOKEN_LIMIT = 3

/**
 * SyntaxMessages spells every syntax diagnostic a Tao author reads. It stays module-local because
 * the providers below are its only callers: a test asserts the finished sentence against a real
 * parse, which is what proves the wiring as well as the wording.
 */
const SyntaxMessages = {
  /** expected states what Tao was looking for at a position and what it found in that place. */
  expected(expectation: string, found: string): string {
    return `Expected ${expectation} here, but found ${found}.`
  },

  /**
   * unreadableCharacters states a character the lexer cannot begin any token with. What Tao expects
   * there is every kind of token at once, which is too broad a category to act on, so each kind is
   * shown by example instead — the reader compares what they typed against three concrete things
   * rather than against three words.
   */
  unreadableCharacters(found: string): string {
    return `Expected a name like \`Greeting\`, a value like \`"hello"\`, or a keyword like \`render\` here, `
      + `but found ${found}.`
  },

  /** unopenedBlockEnd states a closing brace that closes nothing, which has no expected token. */
  unopenedBlockEnd(found: string): string {
    return `Expected an open block for this ${found} to close, but none is open here.`
  },
}

type MismatchedToken = Parameters<AbstractParserErrorMessageProvider['buildMismatchTokenMessage']>[0]
type RedundantInput = Parameters<AbstractParserErrorMessageProvider['buildNotAllInputParsedMessage']>[0]
type NoViableAlternative = Parameters<AbstractParserErrorMessageProvider['buildNoViableAltMessage']>[0]
type MissingIteration = Parameters<AbstractParserErrorMessageProvider['buildEarlyExitMessage']>[0]
type LexedToken = Parameters<DefaultLexerErrorMessageProvider['buildUnableToPopLexerModeMessage']>[0]
type FoundToken = MismatchedToken['actual']

/** TaoParserErrorMessageProvider words each of Chevrotain's four parser errors as a Tao sentence. */
export class TaoParserErrorMessageProvider extends AbstractParserErrorMessageProvider {
  override buildMismatchTokenMessage({ expected, actual }: MismatchedToken): string {
    return SyntaxMessages.expected(tokenWord(expected), foundWord(actual))
  }

  override buildNotAllInputParsedMessage({ firstRedundant }: RedundantInput): string {
    return SyntaxMessages.expected('the end of the file', foundWord(firstRedundant))
  }

  override buildNoViableAltMessage(
    { expectedPathsPerAlt, actual, customUserDescription, ruleName }: NoViableAlternative,
  ): string {
    const paths = expectedPathsPerAlt.flat()
    return SyntaxMessages.expected(expectation(paths, customUserDescription, ruleName), foundWord(actual[0]))
  }

  override buildEarlyExitMessage(
    { expectedIterationPaths, actual, customUserDescription, ruleName }: MissingIteration,
  ): string {
    const expectedHere = expectation(expectedIterationPaths, customUserDescription, ruleName)
    return SyntaxMessages.expected(expectedHere, foundWord(actual[0]))
  }
}

/** TaoLexerErrorMessageProvider words each of Chevrotain's two lexer errors as a Tao sentence. */
export class TaoLexerErrorMessageProvider extends DefaultLexerErrorMessageProvider {
  override buildUnexpectedCharactersMessage(fullText: string, startOffset: number, length: number): string {
    const skipped = fullText.slice(startOffset, startOffset + Math.max(length, 1))
    return SyntaxMessages.unreadableCharacters(asWritten(skipped))
  }

  override buildUnableToPopLexerModeMessage(token: LexedToken): string {
    return SyntaxMessages.unopenedBlockEnd(asWritten(token.image))
  }
}

/**
 * expectation names what could stand at the failing position: Chevrotain's own description when
 * the grammar supplies one, a short list of the tokens that could start an alternative, or the
 * construct being parsed when that list is too long to read.
 */
function expectation(
  paths: readonly (readonly TokenSpelling[])[],
  customUserDescription: string,
  ruleName: string,
): string {
  if (customUserDescription) {
    return customUserDescription
  }
  const words = firstTokenWords(paths)
  return words.length > 0 && words.length <= NAMED_TOKEN_LIMIT ? listed(words) : withArticle(constructWords(ruleName))
}

/** firstTokenWords spells the distinct tokens that could open one of the expected alternatives. */
function firstTokenWords(paths: readonly (readonly TokenSpelling[])[]): string[] {
  const words = new Set<string>()
  for (const path of paths) {
    const first = path[0]
    if (first !== undefined) {
      words.add(tokenWord(first))
    }
  }
  return [...words]
}

/** listed joins spelled tokens into the one clause a reader scans. */
function listed(words: readonly string[]): string {
  const last = words.at(-1) ?? ''
  if (words.length <= 1) {
    return last
  }
  const leading = words.slice(0, -1).join(', ')
  return words.length === 2 ? `${leading} or ${last}` : `${leading}, or ${last}`
}

/** foundWord spells what the parser actually met, which at the end of a file is no token at all. */
function foundWord(token: FoundToken | undefined): string {
  const image = token?.image ?? ''
  return image === '' ? 'the end of the file' : asWritten(image)
}
