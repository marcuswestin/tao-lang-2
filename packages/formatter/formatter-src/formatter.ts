import { Parser, type ParseResult } from '@parser'
import { Assert } from '@shared'
import { reindentInjectionFences } from './formatters/injections-formatter'
import { applyTextEdits } from './formatting'
import { TaoFormatter } from './langium-formatting'

export { TaoFormatter } from './langium-formatting'

/** FormatOptions declares Tao source formatting options. */
export type FormatOptions = {
  tabSize?: number
}

const defaultTabSize = 4

/** formatCode formats Tao source code and returns the formatted text. */
async function formatCode(code: string, opts: FormatOptions = {}): Promise<string> {
  return await formatParsed(await Parser.parseCode(code), opts)
}

/** formatFile formats the Tao file at `path` and returns the formatted text without writing it. */
async function formatFile(path: string, opts: FormatOptions = {}): Promise<string> {
  return await formatParsed(await Parser.parseFile(path), opts)
}

/** formatParsed formats an existing parser result and returns the formatted text. */
async function formatParsed(parsed: ParseResult, opts: FormatOptions = {}): Promise<string> {
  assertFormattable(parsed)
  const tabSize = opts.tabSize ?? defaultTabSize
  const edits = await new TaoFormatter().formatDocument(parsed.document, {
    textDocument: { uri: parsed.document.textDocument.uri },
    options: { tabSize, insertSpaces: true },
  })
  const formatted = applyTextEdits(parsed.document, edits)
  return finalizeFormattedText(reindentInjectionFences(formatted, ' '.repeat(tabSize)))
}

function assertFormattable(parsed: ParseResult): void {
  const { lexerErrors, parserErrors } = parsed.document.parseResult
  const firstError = lexerErrors[0]?.message ?? parserErrors[0]?.message
  Assert(firstError === undefined, 'Tao source without syntax errors when formatting', { firstError })
}

function finalizeFormattedText(text: string): string {
  return `${text.replace(/^\s+/, '').replace(/[ \t]+$/gm, '').replace(/\s+$/, '')}\n`
}

/** Formatter exposes Tao source formatting functions. */
const Formatter = {
  formatCode,
  formatFile,
  formatParsed,
}

export default Formatter
