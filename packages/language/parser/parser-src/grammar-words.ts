/**
 * grammar-words spells a Langium grammar name — a cross-reference type, a lexer token, a parser
 * rule — in the words a Tao author writes. Every one of those names is internal: `RenderTarget`,
 * `USE_IMPORT_PATH`, and `AppBlockDiagnosticStatement` name nothing a Tao program contains, and
 * `packages/AGENTS.md` keeps an internal name out of a diagnostic the author reads. An unlisted
 * name falls back to its spaced-out lowercase spelling, so a grammar addition still reads as words
 * rather than as a symbol.
 */

/**
 * DECLARATION_WORDS spells each grammar cross-reference type in the word a Tao author writes. A
 * reference that does not resolve is the most common mistake a newcomer makes, and Langium's own
 * message names the grammar type it was looking for — `RenderTarget`, `EntityDataField`.
 */
const DECLARATION_WORDS: Readonly<Record<string, string>> = {
  ActionDeclaration: 'action',
  AppDeclaration: 'app',
  AppValueDeclaration: 'app or alias',
  CaseDeclaration: 'case',
  CaseSetCase: 'case',
  CommandDeclaration: 'command',
  ConstructorDeclaration: 'type',
  Declaration: 'declaration',
  EntityDataDeclaration: 'data entity',
  EntityDataField: 'field',
  FixtureAccountDeclaration: 'fixture account',
  FixtureDeclaration: 'fixture',
  FixtureValueDeclaration: 'fixture value',
  FunctionDeclaration: 'function',
  ListedDeclaration: 'data entity or value',
  MutableDeclaration: 'state or parameter',
  NamedDeclaration: 'declaration',
  RefinementBaseDeclaration: 'type or value',
  RenderSlotContract: 'render slot',
  // A scene is a view and a nav is a scene, so one word covers every render target.
  RenderTarget: 'view',
  ScenarioSubjectDeclaration: 'app or view',
  StateDeclaration: 'state',
  TypeDeclaration: 'type',
  UsePackageStatement: 'package',
  ValueDeclaration: 'value',
  ViewDeclaration: 'view',
}

/**
 * TOKEN_WORDS spells each Tao terminal as the thing an author writes in its place. A keyword or a
 * punctuation token needs no entry: it is named by its own text, and a Tao grammar keyword never
 * starts with a capital letter, so an uppercase letter in a token name is what tells a terminal
 * from a keyword.
 */
const TOKEN_WORDS: Readonly<Record<string, string>> = {
  EOF: 'the end of the file',
  ID: 'a name',
  INTERPOLATED_STRING_START: 'a quoted string',
  INTERPOLATION_START: 'an interpolation',
  NUMBER: 'a number',
  STRING: 'a quoted string',
  STRING_END: 'the end of a quoted string',
  STRING_TEXT: 'text inside a quoted string',
  TS_CODE_BLOCK: 'a TypeScript code block',
  TagOrHexColor: 'a tag or a hex color',
  USE_IMPORT_PATH: 'an import path',
}

/**
 * CONSTRUCT_WORDS names the construct a parser rule is parsing, for the rules whose own name reads
 * as grammar bookkeeping rather than as Tao. `ParsedStatement` and `AppBlockDiagnosticStatement`
 * are both just "a declaration" to the author, and the body of a view holds members rather than
 * statements. Every other rule keeps its spaced-out spelling, which is already Tao's vocabulary:
 * `ArgumentList` reads as "argument list" and `DesignColorEntry` as "design color entry".
 */
const CONSTRUCT_WORDS: Readonly<Record<string, string>> = {
  ActionBlock: 'action step',
  AppBlock: 'app member',
  AppBlockDiagnosticStatement: 'declaration',
  AppStatement: 'app member',
  Block: 'view member',
  Declaration: 'declaration',
  Expression: 'value',
  FunctionBlock: 'function step',
  GuardActionCaseBlock: 'guard case',
  GuardDefaultStatement: 'guard default case',
  GuardRenderCaseBlock: 'guard case',
  ParsedStatement: 'declaration',
  TypeExpression: 'type',
  ViewBlock: 'view member',
  ViewStatement: 'view member',
  WhenExpression: 'when branch',
  WhenRenderStatement: 'when branch',
}

/**
 * VALUE_LADDER_RULES matches the rungs of the expression precedence ladder. The grammar spells one
 * rule per operator so that `1 + 2 * 3` groups correctly, but an author never wrote a
 * "multiplication expression": every rung is simply the place a value goes.
 */
const VALUE_LADDER_RULES =
  /^(DeclarationSlot)?(Addition|And|Binary|CaseTest|Comparison|Equality|Multiplication|Or|Postfix|Primary|Unary)Expression$/

/** Langium suffixes a keyword whose text collides with a terminal name; the author still writes the text. */
const keywordSuffix = ':KW'

/** TokenSpelling declares the part of a Chevrotain token type a diagnostic spells out. */
export type TokenSpelling = { name: string }

/** declarationWord returns the Tao word for a grammar cross-reference type. */
export function declarationWord(referenceType: string): string {
  return DECLARATION_WORDS[referenceType] ?? grammarNameWords(referenceType)
}

/**
 * tokenWord returns the Tao spelling of one lexer token: a keyword or punctuation token as the
 * text the author types, a terminal as the thing it stands for.
 */
export function tokenWord(token: TokenSpelling): string {
  const name = token.name.endsWith(keywordSuffix) ? token.name.slice(0, -keywordSuffix.length) : token.name
  if (!/[A-Z]/.test(name)) {
    return asWritten(name)
  }
  return TOKEN_WORDS[name] ?? withArticle(grammarNameWords(name))
}

/** constructWords names, without an article, the construct a parser rule is parsing. */
export function constructWords(ruleName: string): string {
  // Langium marks its rule names with a separator character that is not part of the name itself.
  const name = ruleName.replaceAll(/[^A-Za-z0-9_]/g, '')
  if (VALUE_LADDER_RULES.test(name)) {
    return 'value'
  }
  return CONSTRUCT_WORDS[name] ?? grammarNameWords(name)
}

/**
 * withArticle prefixes a noun phrase with the article a reader expects in front of it. A leading
 * `u` takes `a`, because every u-word in Tao's grammar vocabulary — union, unary, update, use —
 * is sounded that way.
 */
export function withArticle(words: string): string {
  return `${/^[aeio]/.test(words) ? 'an' : 'a'} ${words}`
}

/** asWritten quotes a fragment of Tao source so it reads as source inside a sentence. */
export function asWritten(text: string): string {
  return '`' + text + '`'
}

/** grammarNameWords spells a PascalCase or SCREAMING_SNAKE grammar name as lowercase words. */
function grammarNameWords(name: string): string {
  const spaced = name.replaceAll('_', ' ')
  const split = /[a-z]/.test(spaced) ? spaced.replaceAll(/(?<!^|\s)([A-Z])/g, ' $1') : spaced
  return split.toLowerCase()
}
