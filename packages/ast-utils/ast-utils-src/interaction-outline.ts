import { AST } from '@parser'
import { standardDesignElementName } from './design'
import { type ResolvedRenderInvocation, resolveRenderInvocation } from './invocations'
import { type TaoType, Type } from './Type'

/** OutlineTextPath is the member path one row-bound text reads from the row value. */
export type OutlineTextPath = readonly string[]

/**
 * OutlineLoopDescriptor is what the compiler knows statically about every row of one loop: what
 * the row iterates, how its label ranks, and which native root, if any, can carry that label.
 */
export type OutlineLoopDescriptor = {
  /** collection names the collection expression when it is a name or a path, as a person reads it. */
  collection?: string
  /** entity is the singular entity name when the loop iterates entity rows. */
  entity?: string
  /** name is the loop's singular binder, the noun a row falls back to when nothing else names it. */
  name: string
  /** root is `single` when one unconditional direct render is the row root, `multiple` otherwise. */
  root: 'multiple' | 'single'
  /** selectable marks a loop with `on select`, which makes every row an action control. */
  selectable: boolean
  /** texts lists the unconditional row-bound text paths in rank order; the first is the label. */
  texts: readonly OutlineTextPath[]
}

/** OutlineControlDescriptor classifies one render occurrence that wires an event as a control. */
export type OutlineControlDescriptor = {
  /** label is the literal text the call site hands the control as its title or label. */
  label?: string
  role: 'action' | 'input'
  /** view is the rendered view's name, the label of last resort for a control the site left unnamed. */
  view: string
}

/** The stdlib elements that render one text value; their `Value` argument is what a row reads as. */
const textElements: ReadonlySet<string> = new Set(['Text', 'TextFrame', 'TextMultiline'])

/** The parameters whose literal argument names a control to a person. */
const controlLabelParameters: readonly string[] = ['Title', 'Label']

type RowBinder = AST.ForStatement | AST.ParameterDeclaration

/**
 * outlineLoopDescriptor derives a loop's outline descriptor. The label ranking is static: the first
 * unconditional `Text` in the row subtree whose `Value` is a member path on the row binder,
 * preferring the entity's `(title)` field when the row renders it. Descent follows a bound
 * parameter one level into a rendered view; a function-wrapped or interpolated value is opaque.
 */
export function outlineLoopDescriptor(loop: AST.ForStatement): OutlineLoopDescriptor {
  const rowType = Type.ofValueDeclaration(loop)
  const entity = rowType.kind === 'entity' ? rowType.entity : undefined
  const texts: OutlineTextPath[] = []
  walkStatements(AST.statementsOf(loop.block), loop, [], true, texts)
  const collection = collectionName(loop.collection)
  return {
    ...(collection === undefined ? {} : { collection }),
    ...(entity ? { entity: Type.dataEntityName(entity) } : {}),
    name: loop.name,
    root: AST.loopRowRoot(loop) ? 'single' : 'multiple',
    selectable: AST.loopSelectHandlers(loop).length > 0,
    texts: preferTitle(texts, entity),
  }
}

/**
 * outlineControlDescriptor classifies a render as a control from its wiring alone: a bound `Value`
 * with a change binding is an input; a bound `Press` or `Submit` is an action. Anything else is
 * content.
 */
export function outlineControlDescriptor(render: AST.Render): OutlineControlDescriptor | undefined {
  const invocation = resolveRenderInvocation(render)
  if (!invocation.view) {
    return undefined
  }
  const events = new Set(invocation.eventPairs.map(pair => Type.parameterName(pair.parameter)))
  const valueBound = invocation.pairs.some(pair => Type.parameterName(pair.parameter) === 'Value')
  const label = literalLabel(invocation)
  const view = invocation.view.name
  if (valueBound && (invocation.implicitChange !== undefined || events.has('Change'))) {
    return { ...(label === undefined ? {} : { label }), role: 'input', view }
  }
  if (events.has('Press') || events.has('Submit')) {
    return { ...(label === undefined ? {} : { label }), role: 'action', view }
  }
  return undefined
}

/** A collection written as a name or a path reads as that name; any other expression has none. */
function collectionName(expression: AST.Expression): string | undefined {
  if (AST.isValueReference(expression)) {
    return expression.target.$refText
  }
  if (AST.isMemberAccessExpression(expression)) {
    return expression.members.at(-1)
  }
  return undefined
}

function literalLabel(invocation: ResolvedRenderInvocation): string | undefined {
  for (const name of controlLabelParameters) {
    const pair = invocation.pairs.find(candidate => Type.parameterName(candidate.parameter) === name)
    const value = pair?.argument.value
    if (value && AST.isStringLiteral(value)) {
      return value.value
    }
  }
  return undefined
}

/** A rendered `(title)` field outranks whatever text the row happens to render first. */
function preferTitle(
  texts: readonly OutlineTextPath[],
  entity: AST.EntityDataDeclaration | undefined,
): OutlineTextPath[] {
  const title = entity ? Type.dataEntityTitleField(entity) : undefined
  const index = title ? texts.findIndex(path => path.length === 1 && path[0] === title.name) : -1
  if (index <= 0) {
    return [...texts]
  }
  const preferred = texts[index]!
  return [preferred, ...texts.filter(path => path !== preferred)]
}

function walkStatements(
  statements: readonly AST.Statement[],
  binder: RowBinder,
  prefix: OutlineTextPath,
  descend: boolean,
  texts: OutlineTextPath[],
): void {
  for (const statement of statements) {
    if (AST.isRender(statement)) {
      visitRender(statement, binder, prefix, descend, texts)
    } else if (AST.isRenderSlotUse(statement) && statement.render) {
      visitRender(statement.render, binder, prefix, descend, texts)
    }
    // A `when`, `if`, or `guard` branch renders conditionally and a nested loop renders other rows:
    // neither is a text this row always shows.
  }
}

function visitRender(
  render: AST.Render,
  binder: RowBinder,
  prefix: OutlineTextPath,
  descend: boolean,
  texts: OutlineTextPath[],
): void {
  const element = standardDesignElementName(render)
  const invocation = resolveRenderInvocation(render)
  if (element !== undefined && textElements.has(element)) {
    const pair = invocation.pairs.find(candidate => Type.parameterName(candidate.parameter) === 'Value')
    const path = pair ? pathOnBinder(pair.argument.value, binder, isText) : undefined
    if (path) {
      texts.push([...prefix, ...path])
    }
    return
  }
  walkStatements(AST.statementsOf(render.block), binder, prefix, descend, texts)
  if (!descend || !invocation.view || element !== undefined) {
    return
  }
  // One level into a rendered view: each parameter bound to the row (or to a path on it) becomes
  // the binder the view's own root render is read against.
  const root = invocation.view.block?.statements.find(AST.isRenderStatement)
  if (!root || root.injection) {
    return
  }
  for (const pair of invocation.pairs) {
    const path = pathOnBinder(pair.argument.value, binder, isRowLike)
    if (path) {
      visitRender(root, pair.parameter, [...prefix, ...path], false, texts)
    }
  }
}

/**
 * pathOnBinder returns the member path an expression reads from the binder, or none when the
 * expression is anything else: a function call, an interpolation, a literal, or another value.
 */
function pathOnBinder(
  expression: AST.Expression,
  binder: RowBinder,
  accepts: (type: TaoType) => boolean,
): OutlineTextPath | undefined {
  if (AST.isValueReference(expression)) {
    return expression.target.ref === binder && accepts(Type.ofExpression(expression)) ? [] : undefined
  }
  if (AST.isMemberAccessExpression(expression)) {
    return expression.target.ref === binder && accepts(Type.ofExpression(expression))
      ? [...expression.members]
      : undefined
  }
  return undefined
}

function isText(type: TaoType): boolean {
  return type.kind === 'primitive' && type.primitive === 'text'
}

function isRowLike(type: TaoType): boolean {
  return type.kind === 'entity' || type.kind === 'item'
}
