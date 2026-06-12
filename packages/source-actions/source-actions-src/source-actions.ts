import Formatter from '@formatter'
import { type AST, Parser } from '@parser'
import { Assert } from '@shared'
import { canonicalizeTopLevel } from './files-actions'
import { assemblePieces, statementSlices, trimBlankLines } from './text-slices'
import { removeUnusedImportNames } from './use-actions'
import { moveViewRendersLast } from './views-actions'

/** organizeSource returns the document with canonical statement order and an organized import section. */
async function organizeSource(document: AST.Document): Promise<string | undefined> {
  if (hasSyntaxErrors(document)) {
    return undefined
  }
  return await formattedWhenChanged(document, canonicalizeTopLevel(document))
}

/** removeUnusedImports returns the document with unused imported names dropped, keeping statement order. */
async function removeUnusedImports(document: AST.Document): Promise<string | undefined> {
  if (hasSyntaxErrors(document)) {
    return undefined
  }
  const text = document.textDocument.getText()
  const file = document.parseResult.value
  const { slices, end } = statementSlices(text, file.statements)
  const pieces = removeUnusedImportNames(file, slices)
  pieces.push({ text: trimBlankLines(text.slice(end)), blankBefore: true })
  return await formattedWhenChanged(document, assemblePieces(pieces))
}

/** moveRendersLast returns the document with each view body's single render statement moved to the end. */
async function moveRendersLast(document: AST.Document): Promise<string | undefined> {
  if (hasSyntaxErrors(document)) {
    return undefined
  }
  const moved = moveViewRendersLast(document)
  if (moved === undefined) {
    return undefined
  }
  return await formattedWhenChanged(document, moved)
}

/** fixSource returns the fully canonical source: renders last, organized imports, formatted. */
async function fixSource(document: AST.Document): Promise<string> {
  Assert(!hasSyntaxErrors(document), 'Tao source without syntax errors when applying source fixes', {
    firstError: firstSyntaxError(document),
  })
  const moved = moveViewRendersLast(document)
  const movedDocument = moved === undefined ? document : (await Parser.parseCode(moved)).document
  return await Formatter.formatCode(canonicalizeTopLevel(movedDocument))
}

async function formattedWhenChanged(document: AST.Document, reassembled: string): Promise<string | undefined> {
  const formatted = await Formatter.formatCode(reassembled)
  return formatted === document.textDocument.getText() ? undefined : formatted
}

function hasSyntaxErrors(document: AST.Document): boolean {
  return firstSyntaxError(document) !== undefined
}

function firstSyntaxError(document: AST.Document): string | undefined {
  return document.parseResult.lexerErrors[0]?.message ?? document.parseResult.parserErrors[0]?.message
}

/** SourceActions exposes Tao source canonicalization transforms. */
const SourceActions = {
  fixSource,
  moveRendersLast,
  organizeSource,
  removeUnusedImports,
}

export default SourceActions
