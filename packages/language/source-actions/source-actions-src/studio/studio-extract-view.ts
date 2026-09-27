import { ASTUtils, Type } from '@ast-utils'
import Formatter from '@formatter'
import { AST, Langium } from '@parser'
import { Errors } from '@shared'
import { assertNoSyntaxErrors } from '../source-actions-utils'
import type {
  StudioCopyViewPatchRequest,
  StudioExtractViewPatchRequest,
  StudioGroupRendersPatchRequest,
  StudioWorkspaceDesignContext,
} from './studio-contract'
import {
  directViewRenderStatement,
  requireLocalRenderId,
  requireRenderById,
  type StudioLexicalValue,
  visibleInsertionValues,
} from './studio-render-occurrences'
import {
  applySourceEdits,
  blockStatementSlices,
  indentSnippet,
  lineIndentAt,
  requireExactKeys,
  requireIdentifier,
} from './studio-source-text'
import { ensureUiNamesImported } from './studio-use-imports'

/** SiblingSelection is a run of adjacent child renders in one block, in source order. */
type SiblingSelection = Readonly<{
  block: AST.Block
  /** The selected source from the first render's line to the last render's end, dedented to column zero. */
  body: string
  end: number
  indent: string
  renders: readonly AST.ViewRender[]
  start: number
}>

/**
 * groupRenders wraps adjacent sibling renders in one new Row, Col or Stack in place: the canvas's
 * "wrap inline" grouping. The wrapper takes no clauses, so the group's children keep their own.
 */
export async function groupRenders(
  document: AST.Document,
  request: StudioGroupRendersPatchRequest,
  context: StudioWorkspaceDesignContext = {},
): Promise<string> {
  assertNoSyntaxErrors(document)
  requireExactKeys(request, ['kind', 'renderIds', 'wrapper'], 'Group renders request')
  if (request.wrapper !== 'Col' && request.wrapper !== 'Row' && request.wrapper !== 'Stack') {
    Errors.throwUserInput(`Unsupported Studio wrapper: ${String(request.wrapper)}`)
  }
  const file = document.parseResult.value
  const source = document.textDocument.getText()
  const selection = requireSiblingSelection(document, request.renderIds, 'group')
  ensureUiNamesImported(source, file, [request.wrapper], context.files)
  const grouped = applySourceEdits(source, [{
    end: selection.end,
    replacement: `${selection.indent}${request.wrapper}() {\n${
      indentSnippet(selection.body, `${selection.indent}   `)
    }\n${selection.indent}}`,
    start: selection.start,
  }])
  return await Formatter.formatCode(ensureUiNamesImported(grouped, file, [request.wrapper], context.files))
}

/**
 * extractView turns adjacent sibling renders into a new view declared right after the view that owned
 * them, and renders it in their place. Every value the selection reads from outside itself becomes a
 * parameter of the same name, passed by name at the call site. Several renders are grouped under a
 * Col, since a view renders one root. State, actions and commands are refused rather than guessed at,
 * because passing them changes who owns a write.
 */
export async function extractView(
  document: AST.Document,
  request: StudioExtractViewPatchRequest,
  context: StudioWorkspaceDesignContext = {},
): Promise<string> {
  assertNoSyntaxErrors(document)
  requireExactKeys(request, ['kind', 'name', 'renderIds'], 'Make view request')
  const file = document.parseResult.value
  const name = request.name ?? nextFreeViewName(file, context.files)
  requireNewViewName(file, name, context.files)
  const source = document.textDocument.getText()
  const selection = requireSiblingSelection(document, request.renderIds, 'make a view from')
  const owner = AST.findOwningView(selection.block)
  if (owner?.$cstNode === undefined) {
    Errors.throwUserInput('Can only make a view from elements a view renders.')
  }
  const parameters = selectionParameters(selection)
  const body = selection.renders.length === 1
    ? selection.body
    : `Col() {\n${indentSnippet(selection.body, '   ')}\n}`
  const declaration = `view ${name}(${parameters.map(parameter => parameter.declaration).join(', ')}) {\n${
    indentSnippet(`render ${body}`, '   ')
  }\n}`
  const call = `${name}(${parameters.map(parameter => `${parameter.name}: ${parameter.name}`).join(', ')})`
  const extracted = applySourceEdits(source, [
    { end: selection.end, replacement: `${selection.indent}${call}`, start: selection.start },
    { end: owner.$cstNode.end, replacement: `\n\n${declaration}`, start: owner.$cstNode.end },
  ])
  return await Formatter.formatCode(
    selection.renders.length === 1 ? extracted : ensureUiNamesImported(extracted, file, ['Col'], context.files),
  )
}

/**
 * copyView duplicates a declared view under a new name, right after the original: how the Draw canvas
 * detaches a render rectangle into a view of its own.
 */
export async function copyView(
  document: AST.Document,
  request: StudioCopyViewPatchRequest,
  context: StudioWorkspaceDesignContext = {},
): Promise<string> {
  assertNoSyntaxErrors(document)
  const file = document.parseResult.value
  const matches = file.statements.filter(AST.isViewDeclaration).filter(statement => statement.name === request.view)
  if (matches.length !== 1 || matches[0]?.$cstNode === undefined) {
    Errors.throwUserInput(`Studio view is not uniquely declared in this source file: ${request.view}`)
  }
  requireNewViewName(file, request.name, context.files)
  const cstNode = matches[0]!.$cstNode!
  const nameNode = Langium.GrammarUtils.findNodeForProperty(cstNode, 'name')
  if (nameNode === undefined) {
    Errors.throwUserInput(`Studio cannot find the declared name of view: ${request.view}`)
  }
  const originalText = cstNode.text
  const nameStart = nameNode.offset - cstNode.offset
  const nameEnd = nameNode.end - cstNode.offset
  const copyText = `${originalText.slice(0, nameStart)}${request.name}${originalText.slice(nameEnd)}`
  const source = document.textDocument.getText()
  return await Formatter.formatCode(
    applySourceEdits(source, [{
      end: cstNode.end,
      replacement: `${originalText}\n\n${copyText}`,
      start: cstNode.offset,
    }]),
  )
}

function requireNewViewName(file: AST.TaoFile, name: unknown, files: readonly AST.TaoFile[] = [file]): void {
  if (typeof name !== 'string') {
    Errors.throwUserInput('Studio view name must be a string.')
  }
  requireIdentifier(name, 'view')
  if (!/^[A-Z]/.test(name)) {
    Errors.throwUserInput(`Studio view names start with a capital letter: ${name}`)
  }
  if (viewNameTaken(file, name, files)) {
    Errors.throwUserInput(`A declaration named ${name} is already visible here; choose another view name.`)
  }
}

/** nextFreeViewName numbers an unnamed view the way the canvas numbers a drawn one: View1, View2, … */
function nextFreeViewName(file: AST.TaoFile, files: readonly AST.TaoFile[] = [file]): string {
  let index = 1
  while (viewNameTaken(file, `View${index}`, files)) {
    index += 1
  }
  return `View${index}`
}

function viewNameTaken(file: AST.TaoFile, name: string, files: readonly AST.TaoFile[]): boolean {
  return [file, ...files].some(candidate =>
    candidate.statements.some(statement =>
      (AST.isDeclaration(statement) && statement.name === name)
      || (AST.isUseStatement(statement) && statement.importedDeclarations.some(item => item.$refText === name))
    )
  )
}

function requireSiblingSelection(document: AST.Document, renderIds: unknown, operation: string): SiblingSelection {
  if (!Array.isArray(renderIds) || renderIds.length === 0 || !renderIds.every(id => typeof id === 'string')) {
    Errors.throwUserInput(`Studio needs at least one selected element to ${operation}.`)
  }
  if (new Set(renderIds).size !== renderIds.length) {
    Errors.throwUserInput(`Studio selection names an element twice.`)
  }
  const file = document.parseResult.value
  const source = document.textDocument.getText()
  const selected = renderIds.map(id => {
    requireLocalRenderId(document, id, `${operation} elements`)
    const statement = directViewRenderStatement(requireRenderById(file, id))
    if (statement === undefined) {
      Errors.throwUserInput(`Can only ${operation} elements inside a container, not a view's root render.`)
    }
    if (AST.attachedTag(statement) !== undefined) {
      Errors.throwUserInput(`Unsnap the sketch first; Studio cannot ${operation} a snapped sketch element.`)
    }
    return statement
  })
  const block = selected[0]!.$container
  if (!AST.isBlock(block) || selected.some(render => render.$container !== block)) {
    Errors.throwUserInput(`Can only ${operation} elements that share one container.`)
  }
  const slices = blockStatementSlices(source, block)
  const indexes = selected.map(render => slices.findIndex(slice => slice.statement === render)).toSorted((a, b) =>
    a - b
  )
  if (indexes.some((index, position) => index !== indexes[0]! + position)) {
    Errors.throwUserInput(`Can only ${operation} adjacent elements; move them next to each other first.`)
  }
  const renders = indexes.map(index => slices[index]!.statement as AST.ViewRender)
  const first = renders[0]!.$cstNode!
  const last = renders.at(-1)!.$cstNode!
  const indent = lineIndentAt(source, first.offset)
  const start = first.offset - indent.length
  const body = source.slice(start, last.end).split('\n')
    .map(line => line.startsWith(indent) ? line.slice(indent.length) : line.trimStart())
    .join('\n')
  return { block, body, end: last.end, indent, renders, start }
}

type ExtractedParameter = Readonly<{ declaration: string; name: string }>

/** selectionParameters lists the outside values the selection reads, in first-read order. */
function selectionParameters(selection: SiblingSelection): readonly ExtractedParameter[] {
  const visible = visibleInsertionValues(selection.block, selection.renders[0]!.$cstNode!.offset)
  const names = new Map<AST.Node, string>([...visible].map(([name, value]) => [value, name]))
  const read = new Map<string, StudioLexicalValue>()
  for (const render of selection.renders) {
    for (const node of [render, ...AST.streamAllContents(render)]) {
      for (const reference of AST.streamReferences(node)) {
        const target = 'ref' in reference.reference ? reference.reference.ref : undefined
        const name = target === undefined ? undefined : names.get(target)
        if (name !== undefined && !read.has(name)) {
          read.set(name, visible.get(name)!)
        }
      }
    }
  }
  return [...read].map(([name, value]) => ({ declaration: parameterDeclaration(name, value), name }))
}

function parameterDeclaration(name: string, value: StudioLexicalValue): string {
  if (AST.isParameterDeclaration(value)) {
    const text = value.$cstNode?.text
    if (text === undefined) {
      Errors.throwUserInput(`Cannot copy parameter ${name} without its source.`)
    }
    return text
  }
  if (AST.isStateDeclaration(value) || AST.isActionDeclaration(value) || AST.isCommandDeclaration(value)) {
    Errors.throwUserInput(
      `Studio cannot make a view that reads ${name} yet: state, actions and commands stay in the view that owns them.`,
    )
  }
  const type = sourceTypeName(Type.ofValueDeclaration(value))
  if (type === undefined) {
    Errors.throwUserInput(`Studio cannot name the type of ${name}; give it an explicit type, then make the view.`)
  }
  return `${name} ${type}`
}

/** sourceTypeName spells a resolved type as a parameter type, or nothing where no plain spelling exists. */
function sourceTypeName(type: ASTUtils.TaoType): string | undefined {
  if (type.kind === 'unresolved' || type.kind === 'item' || type.kind === 'union') {
    return undefined
  }
  if (type.kind === 'primitive' && type.primitive === 'action') {
    return undefined
  }
  if (type.kind === 'list' && (type.element === undefined || sourceTypeName(type.element) === undefined)) {
    return undefined
  }
  const name = Type.displayName(type)
  return name.includes('.') ? undefined : name
}
