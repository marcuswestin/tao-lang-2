import Formatter from '@formatter'
import { AST } from '@parser'
import { Errors } from '@shared'
import { assertNoSyntaxErrors } from '../source-actions-utils'
import type {
  StudioMoveRenderRequest,
  StudioRemoveRenderPatchRequest,
  StudioRenderGap,
  StudioWorkspaceDesignContext,
  StudioWrapRenderContainer,
  StudioWrapRenderPatchRequest,
} from './studio-contract'
import {
  directViewRenderStatement,
  renderIdFor,
  renderStatementIndex,
  requireLocalRenderId,
  requireRenderById,
} from './studio-render-occurrences'
import {
  applySourceEdits,
  blockCloseBraceOffset,
  type BlockStatementSlice,
  blockStatementSlices,
  indentSnippet,
  lineIndentAt,
  requireExactKeys,
  type SourceEdit,
  sourceEditsOverlap,
} from './studio-source-text'
import { ensureUiNamesImported } from './studio-use-imports'

/**
 * wrapRender wraps a rendered node in a Studio-owned Stack() container. The wrapper is a stdlib
 * element like any palette insertion, so the file's `use … from @tao/ui` gains it when it is missing;
 * otherwise the wrap compiles into "No view named 'Stack' is in scope.".
 */
export async function wrapRender(
  document: AST.Document,
  request: StudioWrapRenderPatchRequest,
  context: StudioWorkspaceDesignContext = {},
): Promise<string> {
  assertNoSyntaxErrors(document)
  requireLocalRenderId(document, request.renderId, 'wrap renders')
  if (request.wrapper !== 'Col' && request.wrapper !== 'Row' && request.wrapper !== 'Stack') {
    Errors.throwUserInput(`Unsupported Studio wrapper: ${String(request.wrapper)}`)
  }
  const file = document.parseResult.value
  const render = requireRenderById(file, request.renderId)
  // Resolve namespace ownership before constructing an edit. A same-spelled local or foreign import
  // would otherwise turn a valid source tree into an ambiguous or validator-invalid one.
  ensureUiNamesImported(document.textDocument.getText(), file, [request.wrapper], context.files)
  return await Formatter.formatCode(ensureUiNamesImported(
    wrapRenderSource(document.textDocument.getText(), render, request.wrapper),
    file,
    [request.wrapper],
    context.files,
  ))
}

function wrapRenderSource(source: string, render: AST.Render, wrapper: StudioWrapRenderContainer): string {
  const cstNode = render.$cstNode
  if (cstNode === undefined) {
    Errors.throwUserInput('Cannot wrap a render without source coordinates.')
  }
  const indent = lineIndentAt(source, cstNode.offset)
  const childIndent = `${indent}   `
  if (AST.isRenderStatement(render) && render.injection !== undefined) {
    Errors.throwUserInput('Cannot wrap an injected root render.')
  }
  const tag = AST.attachedTag(render)
  const statement = directViewRenderStatement(render)
  const slice = tag !== undefined && statement !== undefined && AST.isBlock(statement.$container)
    ? blockStatementSlices(source, statement.$container).find(candidate => candidate.statement === statement)
    : undefined
  const editStart = slice?.start ?? cstNode.offset
  const selectedSource = source.slice(editStart, cstNode.end).trimEnd()
  const normalizedSource = editStart === cstNode.offset
    ? selectedSource
    : selectedSource.split('\n').map(line => line.startsWith(indent) ? line.slice(indent.length) : line).join('\n')
  const childSource = AST.isRenderStatement(render)
    ? normalizedSource.replace(/^render\s+/, '')
    : normalizedSource
  const rootPrefix = AST.isRenderStatement(render) ? 'render ' : ''
  return applySourceEdits(source, [{
    end: cstNode.end,
    replacement: `${editStart === cstNode.offset ? '' : indent}${rootPrefix}${wrapper}() [gap 8, pad 8] {\n${
      indentSnippet(childSource, childIndent)
    }\n${indent}}`,
    start: editStart,
  }])
}

/** moveRender moves a rendered source node between sibling render positions. */
export async function moveRender(document: AST.Document, request: StudioMoveRenderRequest): Promise<string> {
  assertNoSyntaxErrors(document)
  requireLocalRenderId(document, request.draggedId, 'move render expressions')
  if (request.afterId === undefined && request.beforeId === undefined) {
    Errors.throwUserInput('A render move requires at least one drop-gap anchor.')
  }
  if (request.afterId !== undefined) {
    requireLocalRenderId(document, request.afterId, 'move render expressions')
  }
  if (request.beforeId !== undefined) {
    requireLocalRenderId(document, request.beforeId, 'move render expressions')
  }
  return await Formatter.formatCode(
    moveRenderSource(document.textDocument.getText(), document.parseResult.value, request),
  )
}

function moveRenderSource(source: string, file: AST.TaoFile, request: StudioMoveRenderRequest): string {
  const dragged = requireRenderById(file, request.draggedId)
  const after = request.afterId === undefined ? undefined : requireRenderById(file, request.afterId)
  const before = request.beforeId === undefined ? undefined : requireRenderById(file, request.beforeId)
  const owner = AST.findOwningView(dragged)
  if (
    owner === undefined
    || (after !== undefined && AST.findOwningView(after) !== owner)
    || (before !== undefined && AST.findOwningView(before) !== owner)
  ) {
    Errors.throwUserInput('Can only move between render expressions in the same view definition.')
  }
  const draggedStatement = directViewRenderStatement(dragged)
  const afterStatement = after === undefined ? undefined : directViewRenderStatement(after)
  const beforeStatement = before === undefined ? undefined : directViewRenderStatement(before)
  const targetStatement = afterStatement ?? beforeStatement
  if (
    draggedStatement === undefined
    || targetStatement === undefined
    || !AST.isBlock(draggedStatement.$container)
    || !AST.isBlock(targetStatement.$container)
    || (afterStatement !== undefined && afterStatement.$container !== targetStatement.$container)
    || (beforeStatement !== undefined && beforeStatement.$container !== targetStatement.$container)
  ) {
    Errors.throwUserInput('Can only move direct child view renders between render blocks.')
  }
  return moveRenderBetweenBlocksSource(source, draggedStatement.$container, targetStatement.$container, request)
}

function moveRenderBetweenBlocksSource(
  source: string,
  draggedBlock: AST.Block,
  targetBlock: AST.Block,
  request: StudioMoveRenderRequest,
): string {
  const draggedSlices = blockStatementSlices(source, draggedBlock)
  const targetSlices = draggedBlock === targetBlock ? draggedSlices : blockStatementSlices(source, targetBlock)
  const draggedIndex = renderStatementIndex(draggedSlices, request.draggedId)
  if (draggedIndex === -1) {
    Errors.throwUserInput('Dragged render is not a direct block statement.')
  }
  const draggedSlice = draggedSlices[draggedIndex]!
  if (draggedBlock === targetBlock) {
    return moveRenderInsideBlockSource(source, draggedBlock, draggedSlices, draggedIndex, request)
  }
  if (sliceContainsBlock(draggedSlice, targetBlock)) {
    Errors.throwUserInput('Cannot move a render expression into its own contents.')
  }
  const removeEdit = removeStatementEdit(source, draggedBlock, draggedSlices, draggedIndex)
  const insertEdit = insertStatementEdit(source, targetBlock, targetSlices, draggedSlice.source, request)
  if (sourceEditsOverlap(removeEdit, insertEdit)) {
    Errors.throwUserInput('Cannot move render expressions across overlapping block edits.')
  }
  return applySourceEdits(source, [removeEdit, insertEdit])
}

function moveRenderInsideBlockSource(
  source: string,
  block: AST.Block,
  slices: BlockStatementSlice[],
  draggedIndex: number,
  request: StudioMoveRenderRequest,
): string {
  const draggedSlice = slices[draggedIndex]!
  const remaining = slices.filter((_, index) => index !== draggedIndex)
  const beforeIndex = requireOrderedTargetIndex(remaining, request, draggedIndex)
  remaining.splice(beforeIndex, 0, draggedSlice)
  return applySourceEdits(source, [replaceBlockStatementsEdit(source, block, slices, remaining)])
}

function removeStatementEdit(
  source: string,
  block: AST.Block,
  slices: BlockStatementSlice[],
  draggedIndex: number,
): SourceEdit {
  return replaceBlockStatementsEdit(source, block, slices, slices.filter((_, index) => index !== draggedIndex))
}

function insertStatementEdit(
  source: string,
  block: AST.Block,
  slices: BlockStatementSlice[],
  draggedSource: string,
  request: StudioMoveRenderRequest,
): SourceEdit {
  const insertIndex = requireOrderedTargetIndex(slices, request)
  const next = [...slices]
  const targetSlice = slices[insertIndex] ?? slices[slices.length - 1]
  const insertionOffset = targetSlice === undefined
    ? blockCloseBraceOffset(source, block)
    : insertIndex === slices.length
    ? targetSlice.end
    : targetSlice.start
  next.splice(insertIndex, 0, {
    end: insertionOffset,
    source: draggedSource,
    start: insertionOffset,
    statement: targetSlice?.statement ?? throwEmptyMoveTarget(),
  })
  return replaceBlockStatementsEdit(source, block, slices, next)
}

/**
 * The slice index a move lands at. Anchors are renders, so adjacency and the edges are counted over
 * the statements that render: a `state` line or event handler between two renders, or above the
 * first, is not a place anyone dropped anything. When such statements sit inside the gap, the render
 * stays on the side of them it came from, crossing no more of them than the move needs; one step up
 * never lifts a render above the `state` it reads unless that `state` sat between it and its
 * neighbour. `draggedIndex` is where the render sat in this block, when the move stays in it.
 */
function requireOrderedTargetIndex(
  slices: BlockStatementSlice[],
  request: StudioMoveRenderRequest,
  draggedIndex?: number,
): number {
  const afterIndex = request.afterId === undefined ? undefined : renderStatementIndex(slices, request.afterId)
  const beforeIndex = request.beforeId === undefined ? undefined : renderStatementIndex(slices, request.beforeId)
  if (afterIndex === -1 || beforeIndex === -1) {
    Errors.throwUserInput('Drop target is no longer between the requested render expressions.')
  }
  const rendering = renderingSliceIndexes(slices)
  if (afterIndex !== undefined && beforeIndex !== undefined) {
    if (rendering.indexOf(beforeIndex) !== rendering.indexOf(afterIndex) + 1) {
      Errors.throwUserInput('Drop-gap anchors are no longer adjacent render expressions.')
    }
    return draggedIndex !== undefined && draggedIndex <= afterIndex ? afterIndex + 1 : beforeIndex
  }
  if (beforeIndex !== undefined) {
    if (beforeIndex !== rendering[0]) {
      Errors.throwUserInput('A before-only drop anchor must be the first render expression.')
    }
    return beforeIndex
  }
  if (afterIndex !== undefined) {
    if (afterIndex !== rendering.at(-1)) {
      Errors.throwUserInput('An after-only drop anchor must be the last render expression.')
    }
    return afterIndex + 1
  }
  Errors.throwUserInput('A render move requires at least one drop-gap anchor.')
}

/** The indexes of the slices that put something on screen: a render, or a loop or branch of them. */
function renderingSliceIndexes(slices: readonly BlockStatementSlice[]): number[] {
  return slices.flatMap((slice, index) =>
    AST.isRender(slice.statement) || AST.streamAllContents(slice.statement).some(AST.isRender) ? [index] : []
  )
}

/**
 * The moves one step up and one step down among a render's siblings, or none where it is already
 * first or last, is not a direct child of a render block, or its neighbour is a loop or branch that
 * no anchor can name. Each is the drop gap the canvas would send for the same step, so a move button
 * and a drag are the same edit.
 */
export function renderSiblingMoves(
  render: AST.Render,
): Readonly<{ down?: StudioMoveRenderRequest; up?: StudioMoveRenderRequest }> {
  const statement = directViewRenderStatement(render)
  if (statement === undefined || !AST.isBlock(statement.$container)) {
    return {}
  }
  const source = AST.getDocument(render).textDocument.getText()
  const slices = blockStatementSlices(source, statement.$container)
  const siblings = renderingSliceIndexes(slices).map(index => slices[index]!.statement)
  const position = siblings.indexOf(statement)
  const anchor = (sibling: AST.Statement | undefined): string | null | undefined =>
    sibling === undefined ? undefined : AST.isRender(sibling) ? renderIdFor(sibling) : null
  const step = (direction: -1 | 1): StudioMoveRenderRequest | undefined => {
    const neighbour = anchor(siblings[position + direction])
    const beyond = anchor(siblings[position + 2 * direction])
    if (position < 0 || typeof neighbour !== 'string' || beyond === null) {
      return undefined
    }
    const [afterId, beforeId] = direction === -1 ? [beyond, neighbour] : [neighbour, beyond]
    return {
      ...(afterId === undefined ? {} : { afterId }),
      ...(beforeId === undefined ? {} : { beforeId }),
      draggedId: renderIdFor(render),
    }
  }
  const up = step(-1)
  const down = step(1)
  return { ...(down === undefined ? {} : { down }), ...(up === undefined ? {} : { up }) }
}

function throwEmptyMoveTarget(): never {
  Errors.throwUserInput('Cannot move a render into an empty target block without an anchor.')
}

function replaceBlockStatementsEdit(
  source: string,
  block: AST.Block,
  oldSlices: BlockStatementSlice[],
  nextSlices: BlockStatementSlice[],
): SourceEdit {
  const start = oldSlices[0]?.start ?? blockCloseBraceOffset(source, block)
  return {
    end: blockCloseBraceOffset(source, block),
    replacement: nextSlices.map(slice => slice.source).join(''),
    start,
  }
}

function sliceContainsBlock(slice: BlockStatementSlice, block: AST.Block): boolean {
  const cstNode = block.$cstNode
  return cstNode !== undefined && slice.start <= cstNode.offset && cstNode.end <= slice.end
}

/**
 * removeRender deletes one direct child render statement and the tag attached to it. A render a
 * sketch snapped in, and the last child of a container, stay: the first owns Unsnap's marker and the
 * second would leave an empty block behind.
 */
export async function removeRender(document: AST.Document, request: StudioRemoveRenderPatchRequest): Promise<string> {
  assertNoSyntaxErrors(document)
  requireExactKeys(request, ['kind', 'renderId'], 'Remove render request')
  requireLocalRenderId(document, request.renderId, 'remove renders')
  const render = requireRenderById(document.parseResult.value, request.renderId)
  const statement = directViewRenderStatement(render)
  if (statement === undefined || !AST.isBlock(statement.$container)) {
    Errors.throwUserInput('Studio can remove only a direct child render; the root render stays.')
  }
  const block = statement.$container
  const source = document.textDocument.getText()
  const slices = blockStatementSlices(source, block)
  const tag = AST.attachedTag(render)
  // A `#studio_rect_` tag is the private marker that ties this render back to its sketch rectangle.
  // Deleting the render would take the marker with it and leave Unsnap with nothing to undo.
  const snapped = [render, ...AST.streamAllContents(render).filter(AST.isRender)]
    .some(candidate => AST.attachedTag(candidate)?.tag.startsWith('#studio_rect_') === true)
  if (snapped) {
    Errors.throwUserInput(
      'Studio cannot remove a render snapped in from a sketch; Unsnap the sketch first.',
    )
  }
  if (block.statements.every(candidate => candidate === statement || candidate === tag)) {
    Errors.throwUserInput(
      "Studio cannot remove a container's only child; remove the container instead.",
    )
  }
  const removed = slices.filter(slice =>
    slice.statement === statement || (tag !== undefined && slice.statement === tag)
  )
  return await Formatter.formatCode(applySourceEdits(
    source,
    removed.map(slice => ({ end: slice.end, replacement: '', start: slice.start })),
  ))
}

/** StudioInsertionTarget is the block and offset a render gap resolves to. */
type StudioInsertionTarget = Readonly<{ block: AST.Block; offset: number }>

/** studioInsertionTarget resolves a render gap to its block and insertion offset, defaulting to the first render block. */
export function studioInsertionTarget(document: AST.Document, gap: StudioRenderGap): StudioInsertionTarget {
  const source = document.textDocument.getText()
  if (gap.afterId === undefined && gap.beforeId === undefined) {
    const block = studioInsertionRender(document.parseResult.value).block
    return { block, offset: blockCloseBraceOffset(source, block) }
  }
  if (gap.afterId !== undefined) {
    requireLocalRenderId(document, gap.afterId, 'insert renders')
  }
  if (gap.beforeId !== undefined) {
    requireLocalRenderId(document, gap.beforeId, 'insert renders')
  }
  const after = gap.afterId === undefined ? undefined : requireRenderById(document.parseResult.value, gap.afterId)
  const before = gap.beforeId === undefined ? undefined : requireRenderById(document.parseResult.value, gap.beforeId)
  const afterStatement = after === undefined ? undefined : directViewRenderStatement(after)
  const beforeStatement = before === undefined ? undefined : directViewRenderStatement(before)
  const targetStatement = afterStatement ?? beforeStatement
  if (
    targetStatement === undefined
    || !AST.isBlock(targetStatement.$container)
    || (afterStatement !== undefined && afterStatement.$container !== targetStatement.$container)
    || (beforeStatement !== undefined && beforeStatement.$container !== targetStatement.$container)
  ) {
    Errors.throwUserInput('Can only insert into a drop gap between direct child view renders.')
  }
  const block = targetStatement.$container
  const slices = blockStatementSlices(source, block)
  const edit = studioSnippetInsertionEdit(source, slices, gap, '')
  return { block, offset: edit.start }
}

/** insertStudioSnippetAtGap inserts one snippet at a render gap, or at the end of the first render block. */
export function insertStudioSnippetAtGap(document: AST.Document, snippet: string, gap: StudioRenderGap): string {
  const source = document.textDocument.getText()
  if (gap.afterId === undefined && gap.beforeId === undefined) {
    return insertStudioComponentSnippet(
      source,
      studioComponentInsertionOffset(document.parseResult.value, source),
      snippet,
    )
  }
  const { block } = studioInsertionTarget(document, gap)
  const slices = blockStatementSlices(source, block)
  return applySourceEdits(source, [studioSnippetInsertionEdit(source, slices, gap, snippet)])
}

export function studioSnippetInsertionEdit(
  source: string,
  slices: BlockStatementSlice[],
  gap: StudioRenderGap,
  snippet: string,
): SourceEdit {
  const insertIndex = insertionTargetIndex(slices, gap)
  const target = slices[insertIndex] ?? slices[slices.length - 1]!
  const indent = lineIndentAt(source, target.start)
  const inserted = `${indentSnippet(snippet, indent)}\n`
  const offset = insertIndex === slices.length ? target.end : target.start
  return { end: offset, replacement: inserted, start: offset }
}

export function insertionTargetIndex(slices: BlockStatementSlice[], gap: StudioRenderGap): number {
  const afterIndex = gap.afterId === undefined ? undefined : renderStatementIndex(slices, gap.afterId)
  const beforeIndex = gap.beforeId === undefined ? undefined : renderStatementIndex(slices, gap.beforeId)
  if (afterIndex === -1 || beforeIndex === -1) {
    Errors.throwUserInput('Drop target is no longer between the requested render expressions.')
  }
  if (afterIndex !== undefined && beforeIndex !== undefined && beforeIndex !== afterIndex + 1) {
    Errors.throwUserInput('Drop-gap anchors are no longer adjacent render expressions.')
  }
  return beforeIndex ?? (afterIndex === undefined ? slices.length : afterIndex + 1)
}

function studioComponentInsertionOffset(file: AST.TaoFile, text: string): number {
  return blockCloseBraceOffset(text, studioInsertionRender(file).block)
}

function studioInsertionRender(file: AST.TaoFile): AST.Render & { block: AST.Block } {
  const render = AST.streamAllContents(file)
    .filter(AST.isRender)
    .filter(candidate => candidate.block !== undefined)
    .sort((left, right) => left.$cstNode!.offset - right.$cstNode!.offset)[0]
  if (render?.block === undefined) {
    Errors.throwUserInput('No render block found for Studio component insertion.')
  }
  return render as AST.Render & { block: AST.Block }
}

function insertStudioComponentSnippet(source: string, offset: number, snippet: string): string {
  const indent = `${lineIndentAt(source, offset)}   `
  return `${source.slice(0, offset)}\n${indentSnippet(snippet, indent)}${source.slice(offset)}`
}
