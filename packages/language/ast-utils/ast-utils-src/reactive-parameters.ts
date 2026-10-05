import { AST } from '@parser'
import { resolveArgumentBindings } from './argument-bindings'
import { Type } from './Type'

/** parameterRequiresWritable reports whether a parameter shares caller-owned writable storage. */
export function parameterRequiresWritable(
  parameter: AST.ParameterDeclaration,
  seen: ReadonlySet<AST.ParameterDeclaration> = new Set(),
): boolean {
  if (parameter.copy || seen.has(parameter)) {
    return false
  }
  if (parameter.mutable) {
    return true
  }
  const nextSeen = new Set(seen).add(parameter)
  const owner = parameterOwner(parameter)
  if (!owner || AST.isFunctionDeclaration(owner)) {
    return false
  }
  for (const node of AST.streamAllContents(owner)) {
    if ((AST.isSetStatement(node) || AST.isToggleStatement(node)) && node.target.ref === parameter) {
      return true
    }
    if (
      AST.isParameterDeclaration(node)
      && node.defaultValue
      && expressionReferencesParameter(node.defaultValue, parameter)
      && parameterRequiresWritable(node, nextSeen)
    ) {
      return true
    }
    const forwarding = forwardedParameters(node, parameter)
    if (forwarding.some(target => parameterRequiresWritable(target, nextSeen))) {
      return true
    }
    if (AST.isDoStatement(node) && dynamicActionForwardsWritableParameter(node, parameter)) {
      return true
    }
  }
  return false
}

/** writableExpression reports whether an expression names storage that an action may mutate. */
export function writableExpression(expression: AST.Expression): boolean {
  const target = writableExpressionTarget(expression)
  const writableRoot = AST.isStateDeclaration(target)
    || (AST.isParameterDeclaration(target) && (target.copy || parameterRequiresWritable(target)))
  return writableRoot
    && (!AST.isMemberAccessExpression(expression) || ordinaryWritableItemPath(target, expression.members))
}

/** literalExpression reports values which may receive occurrence-owned writable view storage. */
export function literalExpression(expression: AST.Expression): boolean {
  return AST.isStringLiteral(expression)
    || AST.isNumberLiteral(expression)
    || AST.isBooleanLiteral(expression)
    || AST.isNoneLiteral(expression)
    || (AST.isListLiteral(expression) && expression.elements.every(literalExpression))
    || (AST.isTypedConstructor(expression) && literalConstructorValue(expression.value))
}

function parameterOwner(parameter: AST.ParameterDeclaration): AST.ParameterizedDeclaration | undefined {
  const parent = parameter.$container?.$container
  return parent && AST.isParameterizedDeclaration(parent) ? parent : undefined
}

function writableExpressionTarget(expression: AST.Expression): AST.ValueDeclaration | undefined {
  if (AST.isValueReference(expression) || AST.isMemberAccessExpression(expression)) {
    const target = expression.target.ref
    return AST.isValueDeclaration(target) ? target : undefined
  }
  return undefined
}

function forwardedParameters(
  node: AST.Node,
  source: AST.ParameterDeclaration,
): readonly AST.ParameterDeclaration[] {
  if (AST.isRender(node)) {
    const target = node.view?.ref
    return AST.isViewDeclaration(target) ? forwardedParametersOf(target, node, source) : []
  }
  if ((AST.isDoStatement(node) || AST.isCommandDoClause(node)) && AST.isValueReference(node.action)) {
    const target = node.action.target.ref
    return AST.isActionDeclaration(target) || AST.isCommandDeclaration(target)
      ? forwardedParametersOf(target, node, source)
      : []
  }
  if (AST.isContextualPresentStatement(node) || AST.isViewBinding(node)) {
    const target = node.view.ref
    return AST.isViewDeclaration(target) ? forwardedParametersOf(target, node, source) : []
  }
  return []
}

function dynamicActionForwardsWritableParameter(
  invocation: AST.DoStatement,
  source: AST.ParameterDeclaration,
): boolean {
  if (!AST.isValueReference(invocation.action)) {
    return false
  }
  const target = invocation.action.target.ref
  if (AST.isActionDeclaration(target) || AST.isCommandDeclaration(target)) {
    return false
  }
  const action = Type.ofExpression(invocation.action)
  if (action.kind !== 'primitive' || action.primitive !== 'action') {
    return false
  }
  return AST.argumentsOf(invocation).some((argument, index) =>
    action.parameters[index]?.writable && expressionReferencesParameter(argument.value, source)
  )
}

function forwardedParametersOf(
  declaration: AST.ParameterizedDeclaration,
  invocation: AST.Render | AST.DoStatement | AST.CommandDoClause | AST.ContextualPresentStatement | AST.ViewBinding,
  source: AST.ParameterDeclaration,
): readonly AST.ParameterDeclaration[] {
  const bindings = resolveArgumentBindings(declaration, invocation)
  const explicitChange = AST.isRender(invocation) && (
    AST.statementsOf(invocation.block).some(statement => AST.isEventHandler(statement) && statement.event === 'change')
    || bindings.pairs.some(pair => Type.parameterName(pair.parameter) === 'Change')
  )
  return bindings.pairs
    .filter(pair =>
      expressionReferencesParameter(pair.argument.value, source)
      && !(explicitChange && pair.parameter.mutable && Type.parameterName(pair.parameter) === 'Value')
    )
    .map(pair => pair.parameter)
}

function expressionReferencesParameter(expression: AST.Expression, parameter: AST.ParameterDeclaration): boolean {
  return (AST.isValueReference(expression) || AST.isMemberAccessExpression(expression))
    && expression.target.ref === parameter
}

function literalConstructorValue(value: AST.TypedConstructorValue): boolean {
  if (AST.isItemLiteral(value)) {
    return value.properties.every(property => literalExpression(property.value))
  }
  return literalExpression(value)
}

function ordinaryWritableItemPath(target: AST.ValueDeclaration | undefined, members: readonly string[]): boolean {
  if (!target) {
    return false
  }
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
