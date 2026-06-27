import { Langium, Parser, type ParseResult } from '@parser'
import { Assert } from '@shared'
import { applyTextEdits, taoTabSize } from './formatting'
import { TaoFormatter } from './langium-formatting'

export { TaoFormatter } from './langium-formatting'

/** FormatterSession reuses parser services while formatting multiple independent Tao sources. */
export type FormatterSession = {
  formatCode(code: string): Promise<string>
  formatFile(path: string): Promise<string>
}

/** formatCode formats Tao source code and returns the formatted text. */
async function formatCode(code: string): Promise<string> {
  return await Formatter.createSession().formatCode(code)
}

/** formatFile formats the Tao file at `path` and returns the formatted text without writing it. */
async function formatFile(path: string): Promise<string> {
  return await Formatter.createSession().formatFile(path)
}

/** createSession creates a reusable formatter context for batch formatting. */
function createSession(): FormatterSession {
  const parserContext = Parser.createContext()
  return {
    async formatCode(code: string): Promise<string> {
      return await formatParsed(await Parser.parseSource(parserContext, code, { validation: false }))
    },
    async formatFile(path: string): Promise<string> {
      return await formatParsed(
        await Parser.parse(parserContext, Langium.URI.file(path), {
          validation: false,
        }),
      )
    },
  }
}

/** formatParsed formats an existing parser result and returns the formatted text. */
async function formatParsed(parsed: ParseResult): Promise<string> {
  assertFormattable(parsed)
  const document = parsed.entry.document
  const edits = await new TaoFormatter().formatDocument(document, {
    textDocument: { uri: document.textDocument.uri },
    options: { tabSize: taoTabSize, insertSpaces: true },
  })
  return applyTextEdits(document, edits)
}

function assertFormattable(parsed: ParseResult): void {
  const { lexerErrors, parserErrors } = parsed.entry.document.parseResult
  const firstError = lexerErrors[0]?.message ?? parserErrors[0]?.message
  Assert(firstError === undefined, 'Tao source without syntax errors when formatting', { firstError })
}

/** Formatter exposes Tao source formatting functions. */
const Formatter = {
  createSession,
  formatCode,
  formatFile,
  formatParsed,
}

export default Formatter
