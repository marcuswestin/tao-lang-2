import { ASTUtils } from '@ast-utils'
import Formatter from '@formatter'
import { AST } from '@parser'
import { Errors } from '@shared'
import { assertNoSyntaxErrors } from '../source-actions-utils'
import type {
  StudioLayoutAlignment,
  StudioLayoutContentTerm,
  StudioLayoutEntry,
  StudioLayoutSpacingSide,
  StudioLayoutTermValue,
  StudioSetLayoutEntryPatchRequest,
} from './studio-contract'
import { requireLocalRenderId, requireRenderById } from './studio-render-occurrences'
import { applySourceEdits, type SourceEdit } from './studio-source-text'

/** setLayoutEntry sets or replaces one layout entry on a rendered node. */
export async function setLayoutEntry(
  document: AST.Document,
  request: StudioSetLayoutEntryPatchRequest,
): Promise<string> {
  assertNoSyntaxErrors(document)
  requireLocalRenderId(document, request.renderId, 'edit layout for renders')
  const entry = formatLayoutEntry(requireSupportedLayoutEntry(request.entry))
  const render = requireRenderById(document.parseResult.value, request.renderId)
  if (AST.isRenderStatement(render) && render.injection !== undefined) {
    Errors.throwUserInput('Cannot add a Tao layout clause to an injected root render.')
  }
  requireCompatibleLayoutEntry(render, layoutEntryHead(entry))
  return await Formatter.formatCode(setRenderLayoutEntrySource(document.textDocument.getText(), render, entry))
}

export function setRenderLayoutEntrySource(source: string, render: AST.Render, entry: string): string {
  return applySourceEdits(source, setRenderLayoutEntryEdits(source, render, entry))
}

export function setRenderLayoutEntryEdits(source: string, render: AST.Render, entry: string): readonly SourceEdit[] {
  const layoutClause = render.layoutClause
  if (layoutClause === undefined) {
    const insertionOffset = renderLayoutInsertionOffset(render)
    return [{
      end: insertionOffset,
      replacement: ` [${entry}]`,
      start: insertionOffset,
    }]
  }
  return setLayoutClauseEntryEdits(source, layoutClause, entry)
}

export function setLayoutClauseEntrySource(source: string, layoutClause: AST.LayoutClause, entry: string): string {
  return applySourceEdits(source, setLayoutClauseEntryEdits(source, layoutClause, entry))
}

function setLayoutClauseEntryEdits(
  source: string,
  layoutClause: AST.LayoutClause,
  entry: string,
): readonly SourceEdit[] {
  const slot = layoutEntrySlot(entry.split(/\s+/))
  const existingIndex = layoutClause.entries.findLastIndex(candidate =>
    layoutEntrySlot(ASTUtils.layoutEntryValues(candidate)) === slot
  )
  const existingEntry = layoutClause.entries[existingIndex]
  if (existingEntry !== undefined) {
    if (existingIndex < layoutClause.entries.length - 1) {
      const nextEntry = layoutClause.entries[existingIndex + 1]!
      const closeBracket = source.lastIndexOf(']', layoutClause.$cstNode!.end - 1)
      const insertionOffset = closeBracket === -1 ? layoutClause.$cstNode!.end : closeBracket
      return [{
        end: nextEntry.$cstNode!.offset,
        replacement: '',
        start: existingEntry.$cstNode!.offset,
      }, {
        end: insertionOffset,
        replacement: `, ${entry}`,
        start: insertionOffset,
      }]
    }
    return [{
      end: existingEntry.$cstNode!.end,
      replacement: entry,
      start: existingEntry.$cstNode!.offset,
    }]
  }
  const closeBracket = source.lastIndexOf(']', layoutClause.$cstNode!.end - 1)
  const insertionOffset = closeBracket === -1 ? layoutClause.$cstNode!.end : closeBracket
  return [{
    end: insertionOffset,
    replacement: layoutClause.entries.length === 0 ? entry : `, ${entry}`,
    start: insertionOffset,
  }]
}

/** setLayoutClauseEntryEdit replaces the entry in place when its slot exists and appends it otherwise. */
export function setLayoutClauseEntryEdit(source: string, layoutClause: AST.LayoutClause, entry: string): SourceEdit {
  const slot = layoutEntrySlot(entry.split(/\s+/))
  const existingEntry = layoutClause.entries.findLast(candidate =>
    layoutEntrySlot(ASTUtils.layoutEntryValues(candidate)) === slot
  )
  if (existingEntry?.$cstNode !== undefined) {
    return {
      end: existingEntry.$cstNode.end,
      replacement: entry,
      start: existingEntry.$cstNode.offset,
    }
  }
  const closeBracket = source.lastIndexOf(']', layoutClause.$cstNode!.end - 1)
  const insertionOffset = closeBracket === -1 ? layoutClause.$cstNode!.end : closeBracket
  return {
    end: insertionOffset,
    replacement: layoutClause.entries.length === 0 ? entry : `, ${entry}`,
    start: insertionOffset,
  }
}

export function removeLayoutClauseEntryEdit(source: string, render: AST.Render, entry: AST.LayoutEntry): SourceEdit {
  const layoutClause = render.layoutClause!
  const entries = layoutClause.entries
  const index = entries.indexOf(entry)
  if (entries.length === 1) {
    let start = layoutClause.$cstNode!.offset
    while (start > 0 && (source[start - 1] === ' ' || source[start - 1] === '\t')) {
      start -= 1
    }
    return { end: layoutClause.$cstNode!.end, replacement: '', start }
  }
  if (index === entries.length - 1) {
    return { end: entry.$cstNode!.end, replacement: '', start: entries[index - 1]!.$cstNode!.end }
  }
  return { end: entries[index + 1]!.$cstNode!.offset, replacement: '', start: entry.$cstNode!.offset }
}

export function layoutEntrySlot(values: readonly StudioLayoutTermValue[]): string {
  const head = String(values[0])
  if ((ASTUtils.design.visualHeads as readonly string[]).includes(head)) {
    return `visual:${ASTUtils.design.canonicalVisualHead(head)}`
  }
  // LayoutValidator currently grants the independent maximum slot only to `width max`.
  // Extend this alongside that validator when another dimension gains a maximum constraint.
  return head === 'width' && values[1] === 'max' ? 'width:max' : head
}

const studioLayoutHeads = new Set<string>(ASTUtils.design.layoutHeads)

export function isStudioLayoutEntry(entry: readonly StudioLayoutTermValue[]): boolean {
  return typeof entry[0] === 'string' && studioLayoutHeads.has(entry[0])
}

export function isInlineDesignExploration(entry: readonly StudioLayoutTermValue[]): boolean {
  return ASTUtils.design.isInlineDesignExploration(entry)
}

function renderLayoutInsertionOffset(render: AST.Render): number {
  return render.block?.$cstNode?.offset ?? render.$cstNode!.end
}

export function layoutEntryHead(entry: string): StudioLayoutTermValue {
  const head = entry.split(/\s+/, 1)[0]
  if (head === undefined || head === '') {
    Errors.throwUserInput('Layout entry must have a head term.')
  }
  return head
}

export function formatLayoutEntry(values: StudioLayoutEntry): string {
  if (values.length === 0) {
    Errors.throwUserInput('Layout entry cannot be empty.')
  }
  return values.map(formatLayoutTermValue).join(' ')
}

export function requireSupportedLayoutEntry(values: StudioLayoutEntry): StudioLayoutEntry {
  if (!Array.isArray(values) || values.length === 0 || typeof values[0] !== 'string') {
    throw invalidLayoutEntry(values)
  }
  const head = values[0]
  if (bareLayoutHeads.has(head)) {
    if (values.length !== 1) {
      throw invalidLayoutEntry(values)
    }
    return values
  }
  if (head === 'claim') {
    requirePositiveLayoutNumber(values, 1, 2)
    return values
  }
  if (head === 'gap') {
    requirePositiveLayoutSize(values, 1, 2)
    return values
  }
  if (head === 'aligned') {
    if (values.length !== 2 || typeof values[1] !== 'string' || !alignmentTerms.has(values[1])) {
      throw invalidLayoutEntry(values)
    }
    return values
  }
  if (head === 'content') {
    requireContentLayoutEntry(values)
    return values
  }
  if (head === 'width' || head === 'height') {
    requireDimensionLayoutEntry(values, head)
    return values
  }
  if (head === 'margin' || head === 'pad') {
    requireSpacingLayoutEntry(values)
    return values
  }
  Errors.throwUserInput(`Unsupported Studio layout entry: ${formatLayoutValues(values)}`)
}

const alignmentTerms = new Set<StudioLayoutAlignment>(['baseline', 'bottom', 'center', 'left', 'right', 'top'])
const contentTerms = new Set<StudioLayoutContentTerm>([
  ...alignmentTerms,
  'spread',
  'spread-balanced',
  'spread-inset',
  'stretch',
])
const spacingSides = new Set<StudioLayoutSpacingSide>([
  'bottom',
  'horizontal',
  'left',
  'right',
  'top',
  'vertical',
])
const bareLayoutHeads = new Set(['centered', 'compress', 'fill', 'hug', 'rigid'])

function requireContentLayoutEntry(values: readonly StudioLayoutTermValue[]): void {
  const terms = values.slice(1)
  if (
    (terms.length !== 1 && terms.length !== 2)
    || terms.some(term => typeof term !== 'string' || !contentTerms.has(term as StudioLayoutContentTerm))
  ) {
    throw invalidLayoutEntry(values)
  }
  const slots = new Set<string>()
  for (const term of terms as StudioLayoutContentTerm[]) {
    const slot = contentTermSlot(term)
    if (slots.has(slot)) {
      throw invalidLayoutEntry(values)
    }
    slots.add(slot)
  }
}

function contentTermSlot(term: StudioLayoutContentTerm): string {
  if (term === 'left' || term === 'right') {
    return 'horizontal'
  }
  if (term === 'top' || term === 'bottom') {
    return 'vertical'
  }
  if (term === 'baseline' || term === 'stretch') {
    return 'cross-alignment'
  }
  if (term === 'spread' || term === 'spread-balanced' || term === 'spread-inset') {
    return 'main-distribution'
  }
  return 'center'
}

function requireDimensionLayoutEntry(values: readonly StudioLayoutTermValue[], head: 'height' | 'width'): void {
  if (values.length === 2 && values[1] === 'fill') {
    return
  }
  if (values.length === 2) {
    requirePositiveLayoutSize(values, 1, 2)
    return
  }
  if (head === 'width' && values.length === 3 && values[1] === 'max') {
    requirePositiveLayoutSize(values, 2, 3)
    return
  }
  throw invalidLayoutEntry(values)
}

function requireSpacingLayoutEntry(values: readonly StudioLayoutTermValue[]): void {
  if (values.length === 2) {
    requirePositiveLayoutSize(values, 1, 2)
    return
  }
  if (values.length < 3 || values.length > 9 || values.length % 2 === 0) {
    throw invalidLayoutEntry(values)
  }
  const physicalSides = new Set<string>()
  for (let index = 1; index < values.length; index += 2) {
    const side = values[index]
    if (typeof side !== 'string' || !spacingSides.has(side as StudioLayoutSpacingSide)) {
      throw invalidLayoutEntry(values)
    }
    requirePositiveLayoutSize(values, index + 1, values.length)
    for (const physicalSide of spacingPhysicalSides(side as StudioLayoutSpacingSide)) {
      if (physicalSides.has(physicalSide)) {
        throw invalidLayoutEntry(values)
      }
      physicalSides.add(physicalSide)
    }
  }
}

function spacingPhysicalSides(side: StudioLayoutSpacingSide): readonly string[] {
  if (side === 'horizontal') {
    return ['left', 'right']
  }
  if (side === 'vertical') {
    return ['top', 'bottom']
  }
  return [side]
}

function requirePositiveLayoutNumber(
  values: readonly StudioLayoutTermValue[],
  index: number,
  expectedLength: number,
): void {
  const value = values[index]
  if (typeof value === 'number' && !Number.isFinite(value)) {
    Errors.throwUserInput('Layout number must be finite.')
  }
  if (values.length !== expectedLength || typeof value !== 'number' || value <= 0) {
    throw invalidLayoutEntry(values)
  }
}

function requirePositiveLayoutSize(
  values: readonly StudioLayoutTermValue[],
  index: number,
  expectedLength: number,
): void {
  const value = values[index]
  if (typeof value === 'number' && !Number.isFinite(value)) {
    Errors.throwUserInput('Layout number must be finite.')
  }
  if (values.length !== expectedLength || !isPositiveLayoutSize(value)) {
    throw invalidLayoutEntry(values)
  }
}

function isPositiveLayoutSize(value: StudioLayoutTermValue | undefined): boolean {
  return typeof value === 'number'
    ? Number.isFinite(value) && value > 0
    : typeof value === 'string' && designValuePath.test(value)
}

function invalidLayoutEntry(values: unknown): Errors.UserInputError {
  return new Errors.UserInputError(`Invalid Studio layout entry: ${formatLayoutValues(values)}`)
}

export function formatLayoutValues(values: unknown): string {
  return Array.isArray(values) ? values.map(String).join(' ') : String(values)
}

function requireCompatibleLayoutEntry(render: AST.Render, nextHead: StudioLayoutTermValue): void {
  const entries = render.layoutClause?.entries ?? []
  const heads = entries.map(entry => String(ASTUtils.layoutEntryValues(entry)[0]))
  const replacementIndex = heads.findLastIndex(head => head === nextHead)
  if (replacementIndex === -1) {
    heads.push(String(nextHead))
  } else {
    heads[replacementIndex] = String(nextHead)
  }
  const growth = heads.findLast(head => head === 'claim' || head === 'fill' || head === 'hug')
  const shrink = heads.findLast(head => head === 'compress' || head === 'rigid')
  if (growth === 'claim' && shrink === 'rigid') {
    Errors.throwUserInput("Studio layout action would leave incompatible 'claim' and 'rigid' entries.")
  }
}

export function formatLayoutTermValue(value: StudioLayoutTermValue): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      Errors.throwUserInput('Layout number must be finite.')
    }
    return String(value)
  }
  if (/^[A-Za-z_]\w*(?:-[A-Za-z_]\w*)*$/.test(value) || designValuePath.test(value)) {
    return value
  }
  if (cssHexColor.test(value)) {
    return value
  }
  Errors.throwUserInput(`Invalid layout word: ${value}`)
}

const designValuePath = /^[A-Za-z_]\w*(?:\.(?:[A-Za-z_]\w*|\d+))*$/

export const cssHexColor = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
