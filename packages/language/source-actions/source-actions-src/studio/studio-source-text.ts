import Formatter from '@formatter'
import { AST, Parser } from '@parser'
import { Errors } from '@shared'
import { assertNoSyntaxErrors, parseSourceText } from '../source-actions-utils'
import type { StudioSourceTextEdit } from './studio-contract'

/** SourceEdit is one exact replacement of a source range, applied from the end of the file backward. */
export type SourceEdit = {
  end: number
  replacement: string
  start: number
}

/** BlockStatementSlice is one block statement with the source lines it owns, tag statements grouped in. */
export type BlockStatementSlice = {
  end: number
  source: string
  start: number
  statement: AST.Statement
}

export function applySourceEdits(source: string, edits: readonly SourceEdit[]): string {
  return edits.toSorted((left, right) => right.start - left.start)
    .reduce(
      (nextSource, edit) => `${nextSource.slice(0, edit.start)}${edit.replacement}${nextSource.slice(edit.end)}`,
      source,
    )
}

export function sourceEditsOverlap(left: SourceEdit, right: SourceEdit): boolean {
  return left.start < right.end && right.start < left.end
}

export function blockStatementSlices(source: string, block: AST.Block): BlockStatementSlice[] {
  const contentStart = block.$cstNode!.offset + 1
  const starts = block.statements.map((statement, index) => {
    const statementStart = statement.$cstNode!.offset
    const previousEnd = block.statements[index - 1]?.$cstNode?.end ?? contentStart
    const lineStart = lineStartAt(source, statementStart)
    return lineStart < previousEnd ? statementStart : leadingCommentStart(source, lineStart, previousEnd)
  })
  const slices = block.statements.map((statement, index) => {
    const start = starts[index]!
    const end = starts[index + 1] ?? blockCloseBraceOffset(source, block)
    return {
      end,
      source: source.slice(start, end),
      start,
      statement,
    }
  })
  const grouped: BlockStatementSlice[] = []
  for (let index = 0; index < slices.length; index += 1) {
    const slice = slices[index]!
    const next = slices[index + 1]
    if (
      AST.isTagStatement(slice.statement)
      && next !== undefined
      && (AST.isRender(next.statement) || AST.isForStatement(next.statement))
    ) {
      grouped.push({
        end: next.end,
        source: source.slice(slice.start, next.end),
        start: slice.start,
        statement: next.statement,
      })
      index += 1
    } else {
      grouped.push(slice)
    }
  }
  return grouped
}

/** A contiguous comment block immediately before a statement documents that statement, not its predecessor. */
function leadingCommentStart(source: string, statementLineStart: number, previousEnd: number): number {
  let start = statementLineStart
  while (start > previousEnd) {
    const previousLineEnd = start - 1
    const previousLineStart = lineStartAt(source, previousLineEnd)
    if (previousLineStart < previousEnd || !source.slice(previousLineStart, previousLineEnd).trim().startsWith('//')) {
      break
    }
    start = previousLineStart
  }
  return start
}

export function blockCloseBraceOffset(text: string, block: AST.Block): number {
  const blockEnd = block.$cstNode!.end
  const closeOffset = text.lastIndexOf('}', blockEnd - 1)
  return closeOffset === -1 ? blockEnd : closeOffset
}

export function blockOpenBraceOffset(text: string, block: AST.Block): number {
  const blockStart = block.$cstNode!.offset
  const openOffset = text.indexOf('{', blockStart)
  return openOffset === -1 ? blockStart : openOffset + 1
}

export function lineIndentAt(source: string, offset: number): string {
  const lineStart = lineStartAt(source, offset)
  const line = source.slice(lineStart, offset)
  return /^[ \t]*/.exec(line)?.[0] ?? ''
}

function lineStartAt(source: string, offset: number): number {
  return source.lastIndexOf('\n', offset - 1) + 1
}

export function indentSnippet(snippet: string, indent: string): string {
  return snippet.split('\n').map(line => line === '' ? line : `${indent}${line}`).join('\n')
}

export function fullDocumentEdit(source: string, content: string): readonly StudioSourceTextEdit[] {
  return source === content
    ? []
    : [{
      end: source.length,
      replacement: content,
      start: 0,
    }]
}

export async function formatAndReparse(document: AST.Document, source: string): Promise<string> {
  const formatted = await Formatter.formatCode(source)
  assertNoSyntaxErrors(await parseSourceText(document, formatted))
  return formatted
}

export function taoStringLiteral(value: string): string {
  let source = '"'
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!
    const escaped = taoStringEscapes[character]
    if (escaped !== undefined) {
      source += escaped
      continue
    }
    const codeUnit = value.charCodeAt(index)
    source += codeUnit <= 0x1f || (codeUnit >= 0xd800 && codeUnit <= 0xdfff)
      ? `\\u${codeUnit.toString(16).padStart(4, '0')}`
      : character
  }
  return `${source}"`
}

const taoStringEscapes: Readonly<Record<string, string>> = {
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\f': '\\f',
  '\r': '\\r',
  '"': '\\"',
  '\\': '\\\\',
  '{': '\\{',
}

export function requireIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    Errors.throwUserInput(`Studio ${label} name is invalid: ${value}`)
  }
}

/**
 * requireDesignValueName refuses a name Studio would write for a new color, size, or style a render
 * names. Those names are lowercase, because a Capitalized design name is either a compile error or an
 * element default no clause list may name (Decisions §13), and none may be a Tao keyword, which the
 * lexer would never read as a name.
 */
export function requireDesignValueName(value: string, label: string): void {
  requireIdentifier(value, label)
  if (/^[A-Z]/.test(value)) {
    const lowercase = `${value[0]!.toLowerCase()}${value.slice(1)}`
    Errors.throwUserInput(
      `Studio ${label} names start with a lowercase letter; use '${lowercase}' instead of '${value}'.`,
    )
  }
  const tokens = Parser.lexCode(value).tokens
  if (tokens.length !== 1 || tokens[0]!.tokenType.name !== 'ID') {
    Errors.throwUserInput(`Studio ${label} name '${value}' is a Tao keyword; choose another name.`)
  }
}

export function requireExactKeys(value: object, allowed: readonly string[], label: string): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) {
    Errors.throwUserInput(`${label} contains unsupported fields.`)
  }
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** contentVersion returns the patch protocol's deterministic text version token. */
export function contentVersion(text: string): string {
  let fnvHash = 0x811c9dc5
  let mixedHash = 0x9e3779b9
  for (let index = 0; index < text.length; index += 1) {
    const codeUnit = text.charCodeAt(index)
    fnvHash ^= codeUnit
    fnvHash = Math.imul(fnvHash, 0x01000193) >>> 0
    mixedHash = Math.imul(mixedHash ^ codeUnit, 0x85ebca6b) >>> 0
  }
  return `text-v1:${text.length}:${fnvHash.toString(36).padStart(7, '0')}${mixedHash.toString(36).padStart(7, '0')}`
}
