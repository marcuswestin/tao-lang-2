import { ASTUtils, Operators, Type } from '@ast-utils'
import { AST } from '@parser'
import type { ValidationProblem } from 'typir'
import { type TaoSpecifics, type TaoTypirServices, TypeSystemHelpers } from './TypeSystemHelpers'
import type { ValidationContext } from './validation'

type TaoSpecificsForProblems = TaoSpecifics

/** expressionValidationMessages declares operator and conditional diagnostics. */
const expressionValidationMessages = {
  operandType: (operator: string, expected: string, actual: string) =>
    `Operator '${operator}' expects ${expected} operands, got ${actual}.`,
  additionOperands: (left: string, right: string) =>
    `Operator '+' adds two numbers or joins two texts, got ${left} and ${right}.`,
  comparisonOperands: (operator: string, left: string, right: string) =>
    `Operator '${operator}' compares two values of the same type, got ${left} and ${right}.`,
  whenCondition: (actual: string) => `A \`when\` condition must be boolean, got ${actual}.`,
  whenBranchType: (expected: string, actual: string) =>
    `All \`when\` branches must produce the same type; expected ${expected}, got ${actual}.`,
} as const

/** ExpressionsValidator validates and inspects Tao expression types. */
export const ExpressionsValidator = {
  messages: expressionValidationMessages,
  inferExpressionType,
  validate,
  validateTypirProblems,
}

/** validate reports operator and conditional type diagnostics for one file. */
function validate(file: AST.TaoFile, ctx: ValidationContext): void {
  for (const node of AST.streamAllContents(file)) {
    if (AST.isBinaryExpression(node)) {
      validateBinaryExpression(node, ctx)
      continue
    }
    if (AST.isUnaryOperation(node)) {
      validateUnaryOperation(node, ctx)
      continue
    }
    if (AST.isWhenExpression(node)) {
      validateWhenExpression(node, ctx)
    }
  }
}

function validateBinaryExpression(binary: AST.BinaryExpression, ctx: ValidationContext): void {
  const left = Type.ofExpression(binary.left)
  const right = Type.ofExpression(binary.right)
  if (left.kind === 'unresolved' || right.kind === 'unresolved') {
    return
  }

  if (Operators.isLogical(binary.operator)) {
    requirePrimitive(binary.operator, 'boolean', left, binary.left, ctx)
    requirePrimitive(binary.operator, 'boolean', right, binary.right, ctx)
    return
  }

  if (Operators.isOrdering(binary.operator)) {
    requirePrimitive(binary.operator, 'number', left, binary.left, ctx)
    requirePrimitive(binary.operator, 'number', right, binary.right, ctx)
    return
  }

  if (Operators.isComparison(binary.operator)) {
    if (!Type.isCastCompatible(left, right)) {
      ctx.error(
        expressionValidationMessages.comparisonOperands(
          binary.operator,
          Type.displayName(left),
          Type.displayName(right),
        ),
        binary,
      )
    }
    return
  }

  if (binary.operator === '+') {
    if (isPrimitive(left, 'text') && isPrimitive(right, 'text')) {
      return
    }
    if (!isPrimitive(left, 'number') || !isPrimitive(right, 'number')) {
      ctx.error(
        expressionValidationMessages.additionOperands(Type.displayName(left), Type.displayName(right)),
        binary,
      )
    }
    return
  }

  requirePrimitive(binary.operator, 'number', left, binary.left, ctx)
  requirePrimitive(binary.operator, 'number', right, binary.right, ctx)
}

function validateUnaryOperation(unary: AST.UnaryOperation, ctx: ValidationContext): void {
  const operand = Type.ofExpression(unary.operand)
  if (operand.kind === 'unresolved') {
    return
  }
  requirePrimitive(unary.operator, unary.operator === 'not' ? 'boolean' : 'number', operand, unary.operand, ctx)
}

function validateWhenExpression(when: AST.WhenExpression, ctx: ValidationContext): void {
  for (const branch of when.branches) {
    const condition = Type.ofExpression(branch.condition)
    if (condition.kind !== 'unresolved' && !isPrimitive(condition, 'boolean')) {
      ctx.error(expressionValidationMessages.whenCondition(Type.displayName(condition)), branch.condition)
    }
  }

  const results = [...when.branches.map(branch => branch.value), when.otherwise]
  const expected = results.map(Type.ofExpression).find(type => type.kind !== 'unresolved')
  if (!expected) {
    return
  }
  for (const result of results) {
    const actual = Type.ofExpression(result)
    if (actual.kind === 'unresolved' || Type.isCastCompatible(actual, expected)) {
      continue
    }
    ctx.error(
      expressionValidationMessages.whenBranchType(Type.displayName(expected), Type.displayName(actual)),
      result,
    )
  }
}

function requirePrimitive(
  operator: string,
  expected: 'number' | 'boolean' | 'text',
  actual: ASTUtils.TaoType,
  node: AST.Node,
  ctx: ValidationContext,
): void {
  if (!isPrimitive(actual, expected)) {
    ctx.error(
      expressionValidationMessages.operandType(operator, expected, Type.displayName(actual)),
      node,
    )
  }
}

function isPrimitive(type: ASTUtils.TaoType, primitive: 'number' | 'boolean' | 'text'): boolean {
  return type.kind === 'primitive' && type.primitive === primitive
}

/** inferExpressionType returns the Typir-inferred type name for a Tao expression. */
function inferExpressionType(
  expression: AST.Expression,
  typir: TaoTypirServices,
): string | undefined {
  return TypeSystemHelpers.safeInferType(typir, expression)?.getName()
}

/** validateTypirProblems reports Typir validation problems as Tao validator diagnostics. */
function validateTypirProblems(
  file: AST.TaoFile,
  typir: TaoTypirServices,
  ctx: ValidationContext,
): void {
  for (const problem of collectTypirProblems(file, typir)) {
    const node = AST.isNode(problem.languageNode) ? problem.languageNode : file
    ctx.error(problem.message, node)
  }
}

function collectTypirProblems(
  file: AST.TaoFile,
  typir: TaoTypirServices,
): ValidationProblem<TaoSpecificsForProblems>[] {
  return [
    ...typir.validation.Collector.validateBefore(file),
    ...AST.streamAllContents(file).flatMap(node => typir.validation.Collector.validate(node)),
    ...typir.validation.Collector.validateAfter(file),
  ]
}
