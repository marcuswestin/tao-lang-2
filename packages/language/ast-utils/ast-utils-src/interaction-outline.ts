import { AST } from '@parser'
import { design } from './design'
import { guardBranches } from './guards'
import { type ResolvedRenderInvocation, resolveRenderInvocation } from './invocations'
import { renderTargetIsNav, renderTargetName, resolveRenderTarget } from './render-targets'
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
  /** description supplements the name; it never substitutes for one. */
  description?: string
  /** A dynamic name may be valid at runtime, but cannot be proven from this render site. */
  nameStatus: 'known' | 'uncertain' | 'missing'
  role: 'action' | 'input'
  /** view identifies the rendered declaration, not a name shown to assistive technology. */
  view: string
}

/**
 * OutlineSiblingRegionDescriptor identifies the wrapper-free subtree beside a rendered nav. Its
 * concrete roots all carry this one descriptor and the runtime coalesces their registrations.
 */
export type OutlineSiblingRegionDescriptor = {
  /** label is the first statically derived label anywhere in the sibling subtree. */
  label?: string
  /** members are the stable declaration names of the concrete views rendered in the region. */
  members: readonly string[]
  /** nav names the rendered navigator this subtree sits beside. */
  nav: string
  /** roots are the concrete render sites that begin the non-nav sibling subtree. */
  roots: readonly AST.Render[]
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
  const actionBindings = new Set([
    ...invocation.eventPairs.map(pair => Type.parameterName(pair.parameter)),
    ...invocation.pairs.flatMap(pair => {
      const type = Type.ofParameter(pair.parameter)
      return type.kind === 'primitive' && type.primitive === 'action'
        ? [Type.parameterName(pair.parameter)]
        : []
    }),
  ])
  const valueBound = invocation.pairs.some(pair => Type.parameterName(pair.parameter) === 'Value')
  const visible = visibleTextName(render, new Set(), new Map())
  const label = literalLabel(invocation) ?? visible.label
  const description = literalParameter(invocation, 'Description')
  const dynamicName = controlLabelParameters.some(name => {
    const value = invocation.pairs.find(pair => Type.parameterName(pair.parameter) === name)?.argument.value
    return value !== undefined && !AST.isStringLiteral(value)
  }) || visible.dynamic
  const nameStatus = label ? 'known' : dynamicName ? 'uncertain' : 'missing'
  const view = invocation.view.name
  if (valueBound && (invocation.implicitChange !== undefined || actionBindings.has('Change'))) {
    return {
      ...(label === undefined ? {} : { label }),
      ...(description ? { description } : {}),
      nameStatus,
      role: 'input',
      view,
    }
  }
  if (actionBindings.has('Press') || actionBindings.has('Submit')) {
    return {
      ...(label === undefined ? {} : { label }),
      ...(description ? { description } : {}),
      nameStatus,
      role: 'action',
      view,
    }
  }
  return undefined
}

/** outlineSiblingRegionDescriptor derives the non-nav sibling subtree of a view's rendered nav. */
export function outlineSiblingRegionDescriptor(view: AST.ViewDeclaration): OutlineSiblingRegionDescriptor | undefined {
  const renderedNav = AST.streamAllContents(view.block ?? view).filter(AST.isRender).find(render => {
    const target = resolveRenderTarget(render)
    return target !== undefined && renderTargetIsNav(target)
  })
  const block = renderedNav?.$container
  if (!renderedNav || !AST.isBlock(block)) {
    return undefined
  }
  const roots = siblingRootRenders(block.statements, renderedNav)
  if (roots.length === 0) {
    return undefined
  }
  const target = resolveRenderTarget(renderedNav)
  if (!target) {
    return undefined
  }
  const label = roots.map(root => firstDerivedLabel(root, new Set())).find(candidate => candidate !== undefined)
  const members = siblingMemberDeclarations(roots).map(member => member.name)
  return {
    ...(label === undefined ? {} : { label }),
    members,
    nav: renderTargetName(target),
    roots,
  }
}

/** outlineSiblingRegionForRender returns the wrapper-free sibling region rooted at `render`. */
export function outlineSiblingRegionForRender(render: AST.Render): OutlineSiblingRegionDescriptor | undefined {
  const owner = AST.findOwningView(render)
  const descriptor = owner ? outlineSiblingRegionDescriptor(owner) : undefined
  return descriptor?.roots.includes(render) ? descriptor : undefined
}

/** outlineSiblingRegionMemberDeclarations returns the exact view identities the runtime descriptor names. */
export function outlineSiblingRegionMemberDeclarations(view: AST.ViewDeclaration): readonly AST.ViewDeclaration[] {
  const descriptor = outlineSiblingRegionDescriptor(view)
  return descriptor ? siblingMemberDeclarations(descriptor.roots) : []
}

function siblingRootRenders(statements: readonly AST.Statement[], renderedNav: AST.Render): AST.Render[] {
  const roots: AST.Render[] = []
  for (const statement of statements) {
    if (statement === renderedNav || AST.isTagStatement(statement)) {
      continue
    }
    if (AST.isRender(statement)) {
      const target = resolveRenderTarget(statement)
      if (!target || !renderTargetIsNav(target)) {
        roots.push(statement)
      }
    } else if (AST.isRenderSlotUse(statement) && statement.render) {
      roots.push(statement.render)
    } else if (AST.isWhenRenderStatement(statement)) {
      for (const branch of [...statement.branches, ...(statement.otherwise ? [statement.otherwise] : [])]) {
        roots.push(...siblingRootRenders(branch.block.statements, renderedNav))
      }
    } else if (AST.isGuardRenderStatement(statement)) {
      for (const branch of guardBranches(statement)) {
        roots.push(...siblingRootRenders(branch.block?.statements ?? [], renderedNav))
      }
    } else if (AST.isIfRenderStatement(statement) || AST.isForStatement(statement)) {
      roots.push(...siblingRootRenders(statement.block.statements, renderedNav))
    }
  }
  return roots
}

/** Stable declaration identities, not display labels, let validators distinguish same-named views. */
function siblingMemberDeclarations(roots: readonly AST.Render[]): AST.ViewDeclaration[] {
  const members = new Set<AST.ViewDeclaration>()
  for (const root of roots) {
    const target = resolveRenderTarget(root)
    if (target?.kind === 'view') {
      members.add(target.view)
    }
  }
  return [...members]
}

function firstDerivedLabel(render: AST.Render, seen: Set<AST.ViewDeclaration>): string | undefined {
  const control = outlineControlDescriptor(render)
  if (control?.label) {
    return control.label
  }
  const invocation = resolveRenderInvocation(render)
  const value = invocation.pairs.find(pair => Type.parameterName(pair.parameter) === 'Value')?.argument.value
  const element = design.standardElementName(render)
  if (element && textElements.has(element) && value && AST.isStringLiteral(value)) {
    return value.value
  }
  for (const child of AST.statementsOf(render.block).filter(AST.isRender)) {
    const label = firstDerivedLabel(child, seen)
    if (label) {
      return label
    }
  }
  const view = invocation.view
  if (!view || seen.has(view)) {
    return undefined
  }
  seen.add(view)
  for (const child of AST.streamAllContents(view.block ?? view).filter(AST.isRender)) {
    const label = firstDerivedLabel(child, seen)
    if (label) {
      return label
    }
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
    const label = literalParameter(invocation, name)
    if (label) {
      return label
    }
  }
  return undefined
}

function literalParameter(invocation: ResolvedRenderInvocation, name: string): string | undefined {
  const value = invocation.pairs.find(candidate => Type.parameterName(candidate.parameter) === name)?.argument.value
  return value && AST.isStringLiteral(value) && value.value.trim() ? value.value : undefined
}

/** Read only unconditional visible text; conditional content cannot guarantee a control name. */
function visibleTextName(
  render: AST.Render,
  seen: Set<AST.ViewDeclaration>,
  bindings: ReadonlyMap<AST.ParameterDeclaration, AST.Expression>,
): { label?: string; dynamic: boolean } {
  const invocation = resolveRenderInvocation(render)
  const element = design.standardElementName(render)
  if (element && textElements.has(element)) {
    const value = invocation.pairs.find(pair => Type.parameterName(pair.parameter) === 'Value')?.argument.value
    const literal = value ? boundLiteral(value, bindings) : undefined
    if (literal !== undefined) {
      return literal.trim() ? { label: literal, dynamic: false } : { dynamic: false }
    }
    return { dynamic: value !== undefined }
  }
  let dynamic = false
  for (const child of AST.statementsOf(render.block).filter(AST.isRender)) {
    const found = visibleTextName(child, seen, bindings)
    if (found.label) {
      return found
    }
    dynamic ||= found.dynamic
  }
  const view = invocation.view
  if (view && !seen.has(view)) {
    seen.add(view)
    const viewBindings = new Map(bindings)
    for (const pair of invocation.pairs) {
      viewBindings.set(pair.parameter, pair.argument.value)
    }
    for (const child of AST.statementsOf(view.block).filter(AST.isRender)) {
      const found = visibleTextName(child, seen, viewBindings)
      if (found.label) {
        return found
      }
      dynamic ||= found.dynamic
    }
  }
  return { dynamic }
}

function boundLiteral(
  expression: AST.Expression,
  bindings: ReadonlyMap<AST.ParameterDeclaration, AST.Expression>,
  seen = new Set<AST.Expression>(),
): string | undefined {
  if (AST.isStringLiteral(expression)) {
    return expression.value
  }
  if (!AST.isValueReference(expression) || seen.has(expression)) {
    return undefined
  }
  seen.add(expression)
  const target = expression.target.ref
  return AST.isParameterDeclaration(target) && bindings.has(target)
    ? boundLiteral(bindings.get(target)!, bindings, seen)
    : undefined
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
  const element = design.standardElementName(render)
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
