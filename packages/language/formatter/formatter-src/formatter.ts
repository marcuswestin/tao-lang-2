import { Langium, Parser, type ParseResult } from '@parser'
import { Assert, type Diagnostic, Diagnostics } from '@shared'
import { applyTextEdits, taoTabSize } from './formatting'
import { TaoFormatter } from './langium-formatting'

export { TaoFormatter } from './langium-formatting'

/** FormatAttempt is one file's formatted text, or the diagnostics of a parse that cannot be formatted. */
export type FormatAttempt = {
  /** diagnostics are the parsed file's own syntax errors, in report order; empty once it formatted. */
  diagnostics: readonly Diagnostic[]
  /** formatted is the formatted source, absent exactly when `diagnostics` is not. */
  formatted?: string
}

/** FormatterSession reuses parser services while formatting multiple independent Tao sources. */
export type FormatterSession = {
  formatCode(code: string): Promise<string>
  formatFile(path: string): Promise<string>
  /**
   * tryFormatFile formats the file at `path`, reporting the syntax errors of a file it cannot format
   * where `formatFile` raises the formatter's own invariant instead. A caller that renders
   * diagnostics — `tao fmt` — names the file, position, and source line the way `tao check` does.
   */
  tryFormatFile(path: string): Promise<FormatAttempt>
}

/** formatCode formats Tao source code and returns the formatted text. */
async function formatCode(code: string): Promise<string> {
  return await sharedSession().formatCode(code)
}

/** formatFile formats the Tao file at `path` and returns the formatted text without writing it. */
async function formatFile(path: string): Promise<string> {
  return await sharedSession().formatFile(path)
}

let processSession: FormatterSession | undefined

/**
 * sharedSession is the one parser context every ad-hoc format call in this process reuses. Building a
 * context means building the grammar, so a session per call made `tao fix` and every Studio source
 * action pay that price per file. The session's document store holds one synthetic document per
 * parse, so calls run one at a time on it; a caller formatting many sources in a batch may still
 * hold its own `createSession()`.
 */
function sharedSession(): FormatterSession {
  if (processSession === undefined) {
    const session = createSession()
    let queue: Promise<unknown> = Promise.resolve()
    const serialized = <T>(work: () => Promise<T>): Promise<T> => {
      const next = queue.then(work, work)
      queue = next.catch(() => undefined)
      return next
    }
    processSession = {
      formatCode: code => serialized(() => session.formatCode(code)),
      formatFile: path => serialized(() => session.formatFile(path)),
      tryFormatFile: path => serialized(() => session.tryFormatFile(path)),
    }
  }
  return processSession
}

/** createSession creates a reusable formatter context for batch formatting. */
function createSession(): FormatterSession {
  const parserContext = Parser.createContext()
  const parseFile = async (path: string): Promise<ParseResult> =>
    await Parser.parse(parserContext, Langium.URI.file(path), {
      validation: false,
    })
  return {
    async formatCode(code: string): Promise<string> {
      return formattedText(await tryFormatParsed(await Parser.parseSource(parserContext, code, { validation: false })))
    },
    async formatFile(path: string): Promise<string> {
      return formattedText(await tryFormatParsed(await parseFile(path)))
    },
    async tryFormatFile(path: string): Promise<FormatAttempt> {
      return await tryFormatParsed(await parseFile(path))
    },
  }
}

/** tryFormatParsed formats an existing parser result, or reports the syntax errors that stop it. */
async function tryFormatParsed(parsed: ParseResult): Promise<FormatAttempt> {
  const syntaxErrors = entrySyntaxErrors(parsed)
  if (syntaxErrors.length > 0) {
    return { diagnostics: syntaxErrors }
  }
  const document = parsed.entry.document
  const edits = await new TaoFormatter().formatDocument(document, {
    textDocument: { uri: document.textDocument.uri },
    options: { tabSize: taoTabSize, insertSpaces: true },
  })
  return { diagnostics: [], formatted: applyTextEdits(document, edits) }
}

/**
 * entrySyntaxErrors returns the formatted file's own lexer and parser errors. A parse reaches the
 * files the entry imports, and their syntax is not what stops this file's text from being rewritten.
 */
function entrySyntaxErrors(parsed: ParseResult): readonly Diagnostic[] {
  return Diagnostics.errors(parsed.diagnostics, 'lexer', 'parser').filter(
    diagnostic => diagnostic.filePath === parsed.entry.path,
  )
}

/**
 * formattedText unwraps an attempt for a caller that has nowhere to report diagnostics. A direct
 * `Formatter.formatCode` or `formatFile` call — Studio source actions, the language service — hands
 * the formatter source it has already parsed, so source it cannot parse is that caller's invariant.
 */
function formattedText(attempt: FormatAttempt): string {
  const { formatted } = attempt
  Assert.defined(formatted, 'Tao source without syntax errors when formatting', {
    firstError: attempt.diagnostics[0]?.message,
  })
  return formatted
}

/** Formatter exposes Tao source formatting functions. */
const Formatter = {
  createSession,
  formatCode,
  formatFile,
}

export default Formatter
