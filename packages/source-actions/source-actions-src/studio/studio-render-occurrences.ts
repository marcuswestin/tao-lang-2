import { Type } from '@ast-utils'
import { AST } from '@parser'
import { Errors, Switch } from '@shared'
import {
  StudioSourceOccurrenceConflictError,
  type StudioSourceOccurrencePrecondition,
  type StudioSourcePatchRequest,
} from './studio-contract'
import type { BlockStatementSlice } from './studio-source-text'

/** RenderId is the parsed form of a Studio render locator: `<sourcePath>:<start>:<end>`. */
export type RenderId = {
  end: number
  sourcePath: string
  start: number
}

function parseRenderId(value: string): RenderId {
  const endSeparator = value.lastIndexOf(':')
  const startSeparator = value.lastIndexOf(':', endSeparator - 1)
  const sourcePath = value.slice(0, startSeparator)
  const start = Number(value.slice(startSeparator + 1, endSeparator))
  const end = Number(value.slice(endSeparator + 1))
  if (
    sourcePath === ''
    || !Number.isInteger(start)
    || !Number.isInteger(end)
    || start < 0
    || end < start
  ) {
    Errors.throwUserInput(`Invalid render id: ${value}`)
  }
  return { end, sourcePath, start }
}

export function requireLocalRenderId(document: AST.Document, value: string, operation: string): RenderId {
  const renderId = parseRenderId(value)
  if (renderId.sourcePath !== document.uri.fsPath) {
    Errors.throwUserInput(`Can only ${operation} inside the edited Tao source file.`)
  }
  return renderId
}

function renderIdFor(render: AST.Render): string {
  const document = AST.getDocument(render)
  const cstNode = render.$cstNode
  return `${document.uri.fsPath}:${cstNode?.offset ?? 0}:${cstNode?.end ?? 0}`
}

export function requireRenderById(file: AST.TaoFile, id: string): AST.Render {
  const render = AST.streamAllContents(file)
    .filter(AST.isRender)
    .find(candidate => renderIdFor(candidate) === id)
  if (render === undefined) {
    Errors.throwUserInput(`Render expression no longer exists: ${id}`)
  }
  return render
}

export function directViewRenderStatement(render: AST.Render): AST.ViewRender | undefined {
  return AST.isViewRender(render) && AST.isBlock(render.$container) ? render : undefined
}

export function renderStatementIndex(slices: readonly BlockStatementSlice[], renderId: string): number {
  return slices.findIndex(slice => statementContainsRenderId(slice.statement, renderId))
}

function renderIdForStatement(statement: AST.Statement): string | undefined {
  return AST.isRender(statement) ? renderIdFor(statement) : undefined
}

function statementContainsRenderId(statement: AST.Statement, renderId: string): boolean {
  return renderIdForStatement(statement) === renderId
    || AST.streamAllContents(statement).filter(AST.isRender).some(render => renderIdFor(render) === renderId)
}

/** validateOccurrencePrecondition refuses a patch whose target render changed identity since Studio located it. */
export function validateOccurrencePrecondition(
  document: AST.Document,
  request: StudioSourcePatchRequest,
  precondition: StudioSourceOccurrencePrecondition | undefined,
): void {
  if (precondition === undefined) {
    return
  }
  const targetId = occurrenceTargetRenderId(request)
  if (targetId === undefined) {
    Errors.throwUserInput(`Studio source action does not target a render occurrence: ${request.kind}`)
  }
  const render = requireRenderById(document.parseResult.value, targetId)
  const actualNodeKind = 'render'
  if (precondition.nodeKind !== actualNodeKind) {
    throw new StudioSourceOccurrenceConflictError(
      'node-kind-mismatch',
      targetId,
      precondition.nodeKind,
      actualNodeKind,
    )
  }
  const actualOwner = AST.findOwningView(render)?.name
  if (precondition.renderOwner !== actualOwner) {
    throw new StudioSourceOccurrenceConflictError(
      'render-owner-mismatch',
      targetId,
      precondition.renderOwner,
      actualOwner,
    )
  }
}

function occurrenceTargetRenderId(request: StudioSourcePatchRequest): string | undefined {
  return Switch.kind(request, {
    'add-sketch-entity-parameter': () => undefined,
    'append-scenario-steps': () => undefined,
    'bind-sketch-field': action => action.renderId,
    'bind-text': action => action.renderId,
    'insert-captured-fixture': () => undefined,
    'insert-component': action => action.beforeId ?? action.afterId,
    'insert-project-view': action => action.beforeId ?? action.afterId,
    'insert-separator': action => action.afterId,
    'insert-spacer': action => action.afterId,
    'move-render': action => action.draggedId,
    'remove-render': action => action.renderId,
    'set-design-entry': () => undefined,
    'set-layout-entry': action => action.renderId,
    'set-scenario-arguments': () => undefined,
    'set-style-entry': action => action.renderId,
    'set-text-content': action => action.renderId,
    'snap-sketch-to-flow': () => undefined,
    'toggle-flow-direction': action => action.renderId,
    'unsnap-sketch-from-flow': () => undefined,
    'wrap-render': action => action.renderId,
  })
}

/** StudioLexicalValue is one named value a render or insertion gap can read: a parameter, loop item, or local. */
export type StudioLexicalValue =
  | AST.ParameterDeclaration
  | AST.ForStatement
  | ReturnType<typeof AST.valueDeclarationsOwnedByBlock>[number]

/** visibleInsertionValues lists the lexical values visible at one offset inside a block, innermost first. */
export function visibleInsertionValues(
  block: AST.Block,
  insertionOffset: number,
): ReadonlyMap<string, StudioLexicalValue> {
  const values = new Map<string, StudioLexicalValue>()
  const blocks = [block, ...AST.ancestorBlocks(block)]
  for (const candidateBlock of blocks) {
    const local = AST.valueDeclarationsOwnedByBlock(candidateBlock)
      .filter(declaration => (declaration.$cstNode?.offset ?? Number.MAX_SAFE_INTEGER) < insertionOffset)
      .toSorted((left, right) => (right.$cstNode?.offset ?? 0) - (left.$cstNode?.offset ?? 0))
    for (const declaration of local) {
      addVisibleInsertionValue(values, declaration)
    }
    const loop = AST.forBindingOwnedByBlock(candidateBlock)
    if (loop !== undefined) {
      addVisibleInsertionValue(values, loop)
    }
  }
  const owner = AST.findOwningView(block)
  for (const parameter of owner === undefined ? [] : AST.parametersOf(owner)) {
    addVisibleInsertionValue(values, parameter)
  }
  return values
}

function addVisibleInsertionValue(values: Map<string, StudioLexicalValue>, declaration: StudioLexicalValue): void {
  const name = Type.declarationName(declaration)
  if (!values.has(name)) {
    values.set(name, declaration)
  }
}

/** visibleRenderValues lists the lexical values a render may read, root renders seeing only parameters. */
export function visibleRenderValues(render: AST.Render): ReadonlyMap<string, StudioLexicalValue> {
  const statement = directViewRenderStatement(render)
  if (statement !== undefined && AST.isBlock(statement.$container)) {
    return visibleInsertionValues(statement.$container, statement.$cstNode?.offset ?? 0)
  }
  const values = new Map<string, StudioLexicalValue>()
  const owner = AST.findOwningView(render)
  for (const parameter of owner === undefined ? [] : AST.parametersOf(owner)) {
    addVisibleInsertionValue(values, parameter)
  }
  return values
}
