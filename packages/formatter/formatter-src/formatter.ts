import { Parser, type ParseResult } from '@parser'
import { Assert } from '@shared'
import { applyTextEdits, taoTabSize } from './formatting'
import { TaoFormatter } from './langium-formatting'

export { TaoFormatter } from './langium-formatting'

/** formatCode formats Tao source code and returns the formatted text. */
async function formatCode(code: string): Promise<string> {
  return await formatParsed(await Parser.parseCode(code))
}

/** formatFile formats the Tao file at `path` and returns the formatted text without writing it. */
async function formatFile(path: string): Promise<string> {
  return await formatParsed(await Parser.parseFile(path))
}

/** formatParsed formats an existing parser result and returns the formatted text. */
async function formatParsed(parsed: ParseResult): Promise<string> {
  assertFormattable(parsed)
  const edits = await new TaoFormatter().formatDocument(parsed.document, {
    textDocument: { uri: parsed.document.textDocument.uri },
    options: { tabSize: taoTabSize, insertSpaces: true },
  })
  return applyTextEdits(parsed.document, edits)
}

function assertFormattable(parsed: ParseResult): void {
  const { lexerErrors, parserErrors } = parsed.document.parseResult
  const firstError = lexerErrors[0]?.message ?? parserErrors[0]?.message
  Assert(firstError === undefined, 'Tao source without syntax errors when formatting', { firstError })
}

/** Formatter exposes Tao source formatting functions. */
const Formatter = {
  formatCode,
  formatFile,
  formatParsed,
}

export default Formatter
