import { Type } from '@ast-utils'
import { AST } from '@parser'
import type { ValidationContext } from './validation'

const messages = {
  binaryBoolean: (operator: string) => `Operator '${operator}' requires boolean values on both sides.`,
  binaryComparable: (operator: string) => `Operator '${operator}' requires number values on both sides.`,
  binaryCompatible: (operator: string) => `Operator '${operator}' requires compatible values on both sides.`,
  binaryNumeric: (operator: string) => `Operator '${operator}' requires number values on both sides.`,
  conditionalBranch: '`if … then … else …` branches must produce compatible value types.',
  conditionBoolean: 'An if condition must be boolean.',
  duplicateParameter: (name: string) => `Parameter '${name}' is declared more than once in this function.`,
  forCollection: '`for` requires a list value after `in`.',
  functionArgumentCount: (name: string, expected: number, actual: number) =>
    `Function '${name}' expects ${expected} argument${expected === 1 ? '' : 's'}, got ${actual}.`,
  functionArgumentType: (name: string, index: number, expected: string, actual: string) =>
    `Argument ${index + 1} of function '${name}' expects ${expected}, got ${actual}.`,
  functionPlacement: 'Pure functions must be declared at file level.',
  functionReturn: (name: string, expected: string, actual: string) =>
    `Function '${name}' returns ${expected}, but its expression produces ${actual}.`,
  interpolationPart: '`interpolate` accepts text, number, boolean, or none values.',
  listElement: 'List elements must have compatible types.',
  renderControlPlacement: '`if` and `for` rendering must be nested inside a render child block.',
  unaryBoolean: "Unary 'not' requires a boolean value.",
  unaryNumber: "Unary '-' requires a number value.",
} as const

/** FunctionalCoreValidator validates pure expressions, functions, and render control flow. */
export const FunctionalCoreValidator = {
  messages,
  validate,
} as const

function validate(file: AST.TaoFile, ctx: ValidationContext): void {
  for (const fn of AST.streamAllContents(file).filter(AST.isFunctionDeclaration)) {
    validateFunction(fn, ctx)
  }
  for (const call of AST.streamAllContents(file).filter(AST.isFunctionCallExpression)) {
    validateFunctionCall(call, ctx)
  }
  for (const expression of AST.streamAllContents(file).filter(AST.isBinaryExpression)) {
    validateBinary(expression, ctx)
  }
  for (const expression of AST.streamAllContents(file).filter(AST.isUnaryExpression)) {
    const operand = Type.ofExpression(expression.operand)
    const expected = expression.operator === 'not' ? 'boolean' : 'number'
    if (!isPrimitive(operand, expected)) {
      ctx.error(expression.operator === 'not' ? messages.unaryBoolean : messages.unaryNumber, expression)
    }
  }
  for (const expression of AST.streamAllContents(file).filter(AST.isConditionalExpression)) {
    validateCondition(expression.condition, ctx)
    validateCompatibleBranches(expression.whenTrue, expression.whenFalse, expression, ctx)
  }
  for (const expression of AST.streamAllContents(file).filter(AST.isInterpolationExpression)) {
    for (const part of expression.parts) {
      const type = Type.ofExpression(part)
      if (type.kind !== 'unresolved' && (type.kind !== 'primitive' || type.primitive === 'action')) {
        ctx.error(messages.interpolationPart, part)
      }
    }
  }
  for (const list of AST.streamAllContents(file).filter(AST.isListLiteral)) {
    validateList(list, ctx)
  }
  for (const statement of AST.streamAllContents(file).filter(AST.isIfStatement)) {
    validateCondition(statement.condition, ctx)
    validateRenderControlPlacement(statement, ctx)
  }
  for (const statement of AST.streamAllContents(file).filter(AST.isForStatement)) {
    const collection = Type.ofExpression(statement.collection)
    if (collection.kind !== 'unresolved' && collection.kind !== 'list') {
      ctx.error(messages.forCollection, statement.collection)
    }
    validateRenderControlPlacement(statement, ctx)
  }
}

function validateFunction(fn: AST.FunctionDeclaration, ctx: ValidationContext): void {
  if (!AST.isTaoFile(fn.$container)) {
    ctx.error(messages.functionPlacement, fn)
  }
  const seen = new Set<string>()
  for (const parameter of AST.parametersOf(fn)) {
    const name = Type.parameterName(parameter)
    if (seen.has(name)) {
      ctx.error(messages.duplicateParameter(name), parameter)
    }
    seen.add(name)
  }
  const expected = Type.ofReference(fn.returnType)
  const actual = Type.ofExpression(fn.value)
  if (expected.kind !== 'unresolved' && actual.kind !== 'unresolved' && !Type.isAssignable(actual, expected)) {
    ctx.error(messages.functionReturn(fn.name, Type.displayName(expected), Type.displayName(actual)), fn.value)
  }
}

function validateFunctionCall(call: AST.FunctionCallExpression, ctx: ValidationContext): void {
  const fn = call.function.ref
  if (!fn) {
    return
  }
  const parameters = AST.parametersOf(fn)
  const arguments_ = AST.argumentsOf(call)
  if (parameters.length !== arguments_.length) {
    ctx.error(messages.functionArgumentCount(fn.name, parameters.length, arguments_.length), call)
  }
  for (let index = 0; index < Math.min(parameters.length, arguments_.length); index++) {
    const parameter = parameters[index]!
    const argument = arguments_[index]!
    const expected = Type.ofParameter(parameter)
    const actual = Type.ofArgument(argument)
    if (expected.kind !== 'unresolved' && actual.kind !== 'unresolved' && !Type.isAssignable(actual, expected)) {
      ctx.error(
        messages.functionArgumentType(fn.name, index, Type.displayName(expected), Type.displayName(actual)),
        argument,
      )
    }
  }
}

function validateBinary(expression: AST.BinaryExpression, ctx: ValidationContext): void {
  const left = Type.ofExpression(expression.left)
  const right = Type.ofExpression(expression.right)
  if (left.kind === 'unresolved' || right.kind === 'unresolved') {
    return
  }
  if (expression.operator === 'and' || expression.operator === 'or') {
    if (!isPrimitive(left, 'boolean') || !isPrimitive(right, 'boolean')) {
      ctx.error(messages.binaryBoolean(expression.operator), expression)
    }
    return
  }
  if (['<', '<=', '>', '>='].includes(expression.operator)) {
    if (!isPrimitive(left, 'number') || !isPrimitive(right, 'number')) {
      ctx.error(messages.binaryComparable(expression.operator), expression)
    }
    return
  }
  if (expression.operator === '==' || expression.operator === '!=') {
    if (!Type.isAssignable(left, right) && !Type.isAssignable(right, left)) {
      ctx.error(messages.binaryCompatible(expression.operator), expression)
    }
    return
  }
  if (expression.operator === '+' && isPrimitive(left, 'text') && isPrimitive(right, 'text')) {
    return
  }
  if (!isPrimitive(left, 'number') || !isPrimitive(right, 'number')) {
    ctx.error(messages.binaryNumeric(expression.operator), expression)
  }
}

function validateCondition(condition: AST.Expression, ctx: ValidationContext): void {
  const type = Type.ofExpression(condition)
  if (type.kind !== 'unresolved' && !isPrimitive(type, 'boolean')) {
    ctx.error(messages.conditionBoolean, condition)
  }
}

function validateCompatibleBranches(
  whenTrue: AST.Expression,
  whenFalse: AST.Expression,
  node: AST.Node,
  ctx: ValidationContext,
): void {
  const trueType = Type.ofExpression(whenTrue)
  const falseType = Type.ofExpression(whenFalse)
  if (
    trueType.kind !== 'unresolved'
    && falseType.kind !== 'unresolved'
    && !Type.isAssignable(trueType, falseType)
    && !Type.isAssignable(falseType, trueType)
  ) {
    ctx.error(messages.conditionalBranch, node)
  }
}

function validateList(list: AST.ListLiteral, ctx: ValidationContext): void {
  const first = list.elements[0]
  if (!first) {
    return
  }
  const expected = Type.ofExpression(first)
  if (expected.kind === 'unresolved') {
    return
  }
  for (const element of list.elements.slice(1)) {
    const actual = Type.ofExpression(element)
    if (
      actual.kind !== 'unresolved'
      && !Type.isAssignable(actual, expected)
      && !Type.isAssignable(expected, actual)
    ) {
      ctx.error(messages.listElement, element)
    }
  }
}

function validateRenderControlPlacement(node: AST.IfStatement | AST.ForStatement, ctx: ValidationContext): void {
  let current: AST.Node | undefined = node.$container
  while (current) {
    if (AST.isRender(current)) {
      return
    }
    if (AST.isRenderableDeclaration(current)) {
      break
    }
    current = current.$container
  }
  ctx.error(messages.renderControlPlacement, node)
}

function isPrimitive(type: ReturnType<typeof Type.ofExpression>, primitive: string): boolean {
  return type.kind === 'primitive' && type.primitive === primitive
}
