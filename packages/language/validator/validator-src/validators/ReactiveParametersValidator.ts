import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'

const reactiveParametersValidationMessages = {
  readonlyTarget: (name: string) => `Parameter '${name}' is read-only and cannot be mutated.`,
  readonlyArgument: (name: string) => `Parameter '${name}' requires writable storage.`,
  functionMutation: (name: string) => `Function parameter '${name}' cannot be mutated.`,
  nativeMutable: '`mutable` parameters are allowed only on foreign views.',
  writablePath: 'A writable field path must stay within an ordinary item value.',
} as const

/** ReactiveParametersValidator checks writable parameter contracts and mutation ownership. */
export const ReactiveParametersValidator = {
  checks: {
    [AST.ParameterDeclaration.$type]: [reportParameterModifierPlacement, reportWritableParameterDefault],
    [AST.SetStatement.$type]: reportWritableMutationTarget,
    [AST.ToggleStatement.$type]: reportWritableMutationTarget,
    [AST.Render.$type]: reportWritableRenderArguments,
    [AST.DoStatement.$type]: reportWritableActionArguments,
    [AST.ContextualPresentStatement.$type]: reportWritablePresentationArguments,
    [AST.ViewBinding.$type]: reportWritableBoundViewArguments,
    [AST.AppView.$type]: reportWritableAppViewArguments,
  } satisfies NodeValidationChecks,
  messages: reactiveParametersValidationMessages,
}

function reportParameterModifierPlacement(parameter: AST.ParameterDeclaration, ctx: ValidationContext): void {
  if (!parameter.mutable) {
    return
  }
  const owner = parameter.$container?.$container
  const inlineInjection = AST.isViewDeclaration(owner)
    && AST.streamAllContents(owner).some(AST.isInjection)
  if (!AST.isViewDeclaration(owner) || (!owner.foreign && !inlineInjection)) {
    ctx.error(parameter, reactiveParametersValidationMessages.nativeMutable)
  }
}

function reportWritableParameterDefault(parameter: AST.ParameterDeclaration, ctx: ValidationContext): void {
  if (!parameter.defaultValue || !ASTUtils.parameterRequiresWritable(parameter)) {
    return
  }
  const owner = parameter.$container?.$container
  const allowsLiteral = AST.isViewDeclaration(owner)
  reportWritableArgument(parameter, parameter.defaultValue, allowsLiteral, parameter.defaultValue, ctx)
}

function reportWritableMutationTarget(
  mutation: AST.SetStatement | AST.ToggleStatement,
  ctx: ValidationContext,
): void {
  const target = mutation.target.ref
  if (!AST.isParameterDeclaration(target)) {
    return
  }
  if (AST.isToggleStatement(mutation) && Type.ofValueDeclaration(target).kind === 'entity') {
    return
  }
  if (AST.findOwningFunction(mutation)) {
    ctx.error(mutation, reactiveParametersValidationMessages.functionMutation(Type.parameterName(target)))
    return
  }
  if (!(target.copy || ASTUtils.parameterRequiresWritable(target))) {
    ctx.error(mutation, reactiveParametersValidationMessages.readonlyTarget(Type.parameterName(target)))
  }
  // A path through a completeness member has its own, more specific diagnostic (StateValidator).
  const derived = Type.completenessMemberDepth(Type.ofValueDeclaration(target), mutation.members) !== undefined
  if (mutation.members.length > 0 && !derived && !ordinaryWritableItemPath(target, mutation.members)) {
    ctx.error(mutation, reactiveParametersValidationMessages.writablePath)
  }
}

function reportWritableRenderArguments(render: AST.Render, ctx: ValidationContext): void {
  const view = render.view?.ref
  if (!AST.isViewDeclaration(view)) {
    return
  }
  const bindings = ASTUtils.resolveArgumentBindings(view, render).pairs
  const explicitChange =
    AST.statementsOf(render.block).some(statement => AST.isEventHandler(statement) && statement.event === 'change')
    || bindings.some(pair => Type.parameterName(pair.parameter) === 'Change')
  for (const pair of bindings) {
    if (explicitChange && pair.parameter.mutable && Type.parameterName(pair.parameter) === 'Value') {
      continue
    }
    reportWritableArgument(pair.parameter, pair.argument.value, true, pair.argument, ctx)
  }
}

function reportWritableActionArguments(invocation: AST.DoStatement, ctx: ValidationContext): void {
  const action = AST.isValueReference(invocation.action) ? invocation.action.target.ref : undefined
  if (AST.isActionDeclaration(action) || AST.isCommandDeclaration(action)) {
    for (const pair of ASTUtils.resolveArgumentBindings(action, invocation).pairs) {
      reportWritableArgument(pair.parameter, pair.argument.value, false, pair.argument, ctx)
    }
    return
  }
  const actionType = Type.ofExpression(invocation.action)
  if (actionType.kind !== 'primitive' || actionType.primitive !== 'action') {
    return
  }
  for (const [index, argument] of AST.argumentsOf(invocation).entries()) {
    const parameter = actionType.parameters[index]
    if (parameter?.writable && !ASTUtils.writableExpression(argument.value)) {
      ctx.error(
        argument,
        reactiveParametersValidationMessages.readonlyArgument(parameter.name ?? `argument ${index + 1}`),
      )
    }
  }
}

/** Bound and presented views create occurrence-owned cells for literals, but cannot write aliases. */
function reportWritablePresentationArguments(
  presentation: AST.ContextualPresentStatement,
  ctx: ValidationContext,
): void {
  const view = presentation.view.ref
  if (view) {
    reportWritableViewArguments(view, presentation, ctx)
  }
}

function reportWritableBoundViewArguments(binding: AST.ViewBinding, ctx: ValidationContext): void {
  const view = binding.view.ref
  if (view) {
    reportWritableViewArguments(view, binding, ctx)
  }
}

function reportWritableAppViewArguments(root: AST.AppView, ctx: ValidationContext): void {
  const view = root.view.ref
  if (view) {
    reportWritableViewArguments(view, root, ctx)
  }
}

function reportWritableViewArguments(
  view: AST.ViewDeclaration,
  invocation: AST.ContextualPresentStatement | AST.ViewBinding | AST.AppView,
  ctx: ValidationContext,
): void {
  for (const pair of ASTUtils.resolveArgumentBindings(view, invocation).pairs) {
    reportWritableArgument(pair.parameter, pair.argument.value, true, pair.argument, ctx)
  }
}

function reportWritableArgument(
  parameter: AST.ParameterDeclaration,
  argument: AST.Expression,
  allowsLiteral: boolean,
  node: AST.Node,
  ctx: ValidationContext,
): void {
  if (!ASTUtils.parameterRequiresWritable(parameter)) {
    return
  }
  if (ASTUtils.writableExpression(argument) || (allowsLiteral && ASTUtils.literalExpression(argument))) {
    return
  }
  ctx.error(node, reactiveParametersValidationMessages.readonlyArgument(Type.parameterName(parameter)))
}

function ordinaryWritableItemPath(target: AST.MutableDeclaration, members: readonly string[]): boolean {
  let type = Type.ofValueDeclaration(target)
  for (const member of members) {
    if (type.kind !== 'item' || Type.isCompletenessMember(type, member)) {
      return false
    }
    type = Type.atMemberPath(type, [member])
    if (type.kind === 'unresolved' || type.kind === 'entity') {
      return false
    }
  }
  return true
}
