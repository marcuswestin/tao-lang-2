import { type ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'
import { FunctionsValidator } from './functions-validator'

const messages = {
  binaryBoolean: (operator: string) => `Operator '${operator}' requires boolean values on both sides.`,
  binaryComparable: (operator: string) => `Operator '${operator}' requires number values on both sides.`,
  binaryCompatible: (operator: string) => `Operator '${operator}' requires compatible values on both sides.`,
  binaryNumeric: (operator: string) => `Operator '${operator}' requires number values on both sides.`,
  conditionalBranch: '`when` branches must produce compatible value types.',
  compactWhenSubject: 'The compact `when Subject Value / label Value` form requires a yes/no subject.',
  compactWhenLabel: (label: string, expected: string) =>
    `'${label}' is not this subject's no-pole label; use '${expected}'.`,
  duplicateCase: (name: string) => `Case '${name}' is declared more than once for this subject.`,
  emptySubject: '`is empty` accepts text, list, or query values.',
  enumPlacement: 'Enums must be declared at file level.',
  duplicateEnumCase: (enumName: string, caseName: string) =>
    `Enum '${enumName}' declares case '${caseName}' more than once.`,
  ...FunctionsValidator.messages,
  forCollection: '`loop` requires a list value before `/`.',
  interpolationPart: 'String interpolation accepts text, number, boolean, or none values.',
  ifCondition: '`if` requires a boolean condition.',
  invalidCase: (name: string, subject: string) => `Case '${name}' is not valid for ${subject}.`,
  invalidCasePayload: "Only an 'error -> Name' case may introduce an error-message value.",
  listElement: 'List elements must have compatible types.',
  renderControlPlacement: '`when`, `guard`, `if`, and `for` rendering must be nested inside a render child block.',
  subjectCases: '`when` and `guard` subjects must be text, list, query, entity, or boolean values.',
  unaryBoolean: "Unary 'not' requires a boolean value.",
  unaryNumber: "Unary '-' requires a number value.",
  dimensional: (left: string, operator: string, right: string) =>
    `Operator '${operator}' does not apply to ${left} and ${right}.`,
} as const

/** FunctionalCoreValidator validates pure expressions, functions, and render control flow. */
export const FunctionalCoreValidator = {
  checks: {
    [AST.TypeDeclaration.$type]: validateEnum,
    ...FunctionsValidator.checks,
    [AST.BinaryExpression.$type]: validateBinary,
    [AST.UnaryExpression.$type]: (expression, ctx) => {
      const operand = Type.ofExpression(expression.operand)
      if (expression.operator === 'not') {
        if (!isPrimitive(operand, 'boolean')) {
          ctx.error(messages.unaryBoolean, expression)
        }
        return
      }
      // Negating a unit value is negating its magnitude, so the family passes through.
      if (!isPrimitive(operand, 'number') && !Type.unitFamilyOf(operand)) {
        ctx.error(messages.unaryNumber, expression)
      }
    },
    [AST.CaseTestExpression.$type]: validateCaseTestExpression,
    [AST.WhenExpression.$type]: (expression, ctx) => {
      validateSubjectCases(expression.subject, expression.branches, ctx)
      validateCompatibleBranches(AST.whenExpressionOutcomes(expression).values, ctx)
      validateCompactWhen(expression, ctx)
    },
    [AST.StringInterpolation.$type]: (interpolation, ctx) => {
      const type = Type.ofExpression(interpolation.expression)
      const supported = type.kind === 'primitive'
        && ['text', 'number', 'boolean', 'none'].includes(type.primitive)
      if (type.kind !== 'unresolved' && !supported) {
        ctx.error(messages.interpolationPart, interpolation.expression)
      }
    },
    [AST.ListLiteral.$type]: validateList,
    [AST.WhenRenderStatement.$type]: (statement, ctx) => {
      validateSubjectCases(statement.subject, statement.branches, ctx)
      validateRenderControlPlacement(statement, ctx)
    },
    [AST.GuardRenderStatement.$type]: (statement, ctx) => {
      validateSubjectCases(statement.subject, guardRenderBranches(statement), ctx)
      validateRenderControlPlacement(statement, ctx)
    },
    [AST.GuardActionStatement.$type]: (statement, ctx) => {
      validateSubjectCases(statement.subject, guardActionBranches(statement), ctx)
    },
    [AST.IfActionStatement.$type]: (statement, ctx) => {
      validateIfCondition(statement.condition, ctx)
    },
    [AST.IfFunctionStatement.$type]: (statement, ctx) => {
      validateIfCondition(statement.condition, ctx)
    },
    [AST.IfRenderStatement.$type]: (statement, ctx) => {
      validateIfCondition(statement.condition, ctx)
      validateRenderControlPlacement(statement, ctx)
    },
    [AST.ForStatement.$type]: (statement, ctx) => {
      const collection = Type.ofExpression(statement.collection)
      if (collection.kind !== 'unresolved' && collection.kind !== 'list') {
        ctx.error(messages.forCollection, statement.collection)
      }
      validateRenderControlPlacement(statement, ctx)
    },
  } satisfies NodeValidationChecks,
  messages,
} as const

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
    if (comparesUnitValues(expression, left, right)) {
      return
    }
    if (!isPrimitive(left, 'number') || !isPrimitive(right, 'number')) {
      ctx.error(messages.binaryComparable(expression.operator), expression)
    }
    return
  }
  if (expression.operator === '==' || expression.operator === '!=') {
    if (comparesUnitValues(expression, left, right)) {
      return
    }
    if (!Type.isAssignable(left, right) && !Type.isAssignable(right, left)) {
      ctx.error(messages.binaryCompatible(expression.operator), expression)
    }
    return
  }
  if (expression.operator === '+' && isPrimitive(left, 'text') && isPrimitive(right, 'text')) {
    return
  }
  // A unit value on either side makes this dimensional analysis rather than plain arithmetic.
  if (Type.unitFamilyOf(left) || Type.unitFamilyOf(right) || isPrimitive(left, 'time') || isPrimitive(right, 'time')) {
    if (!Type.dimensionalResult(left, expression.operator, right)) {
      ctx.error(
        messages.dimensional(dimensionName(left), expression.operator, dimensionName(right)),
        expression,
      )
    }
    return
  }
  if (!isPrimitive(left, 'number') || !isPrimitive(right, 'number')) {
    ctx.error(messages.binaryNumeric(expression.operator), expression)
  }
}

/**
 * A dimensional mismatch is about families, so the message names the family rather than the nominal
 * type a parameter or declaration happens to carry.
 */
/**
 * The compact form is the two-outcome sibling of the block form, so its subject is a yes/no value
 * and the mandatory label before the second branch is `not` or the subject's own no-pole alias.
 */
function validateCompactWhen(expression: AST.WhenExpression, ctx: ValidationContext): void {
  if (!expression.positive) {
    return
  }
  const subject = Type.ofExpression(expression.subject)
  if (subject.kind !== 'unresolved' && !isPrimitive(subject, 'boolean')) {
    ctx.error(messages.compactWhenSubject, expression)
    return
  }
  const label = expression.negativeLabel
  if (label === undefined || label === 'not') {
    return
  }
  const alias = negativePoleAlias(expression.subject)
  if (label !== alias) {
    ctx.error(messages.compactWhenLabel(label, alias ?? 'not'), expression)
  }
}

/** negativePoleAlias returns the name a yes/no type gives its no pole, when it declares one. */
function negativePoleAlias(subject: AST.Expression): string | undefined {
  const field = AST.isMemberAccessExpression(subject) ? Type.dataFieldOfMemberAccess(subject) : undefined
  if (field?.negativeName) {
    return field.negativeName
  }
  const declaration = AST.isValueReference(subject) ? subject.target.ref : undefined
  return AST.isEntityDataField(declaration) ? declaration.negativeName : undefined
}

function dimensionName(type: ASTUtils.TaoType): string {
  return type.kind === 'primitive' && (Type.unitFamilyOf(type) || type.primitive === 'time')
    ? type.primitive
    : Type.displayName(type)
}

/**
 * Two values of one family compare after normalization, and a unit value compares against the bare
 * literal `0` because zero carries no unit. Every other pairing falls through to the ordinary rules.
 */
function comparesUnitValues(
  expression: AST.BinaryExpression,
  left: ASTUtils.TaoType,
  right: ASTUtils.TaoType,
): boolean {
  const leftFamily = Type.unitFamilyOf(left)
  const rightFamily = Type.unitFamilyOf(right)
  if (leftFamily && leftFamily === rightFamily) {
    return true
  }
  if (leftFamily && isZeroLiteral(expression.right)) {
    return true
  }
  return rightFamily !== undefined && isZeroLiteral(expression.left)
}

function isZeroLiteral(expression: AST.Expression): boolean {
  return AST.isNumberLiteral(expression) && expression.value === 0
}

type SubjectCaseBranch = AST.WhenBranch | AST.WhenRenderBranch | AST.GuardActionBranch | AST.GuardRenderBranch

function validateEnum(declaration: AST.TypeDeclaration, ctx: ValidationContext): void {
  if (!AST.isTaoFile(declaration.$container)) {
    ctx.error(messages.enumPlacement, declaration)
  }
  const seen = new Set<string>()
  for (const enumCase of AST.caseSetCasesOf(declaration)) {
    const caseName = AST.caseSetCaseName(enumCase)
    if (seen.has(caseName)) {
      ctx.error(messages.duplicateEnumCase(declaration.name, caseName), enumCase)
    }
    seen.add(caseName)
  }
}

function validateCaseTestExpression(expression: AST.CaseTestExpression, ctx: ValidationContext): void {
  if (expression.builtinCase) {
    const category = subjectCaseCategory(expression.value)
    if (category === 'unresolved') {
      return
    }
    if (!allowedCases(category).has(expression.builtinCase)) {
      ctx.error(
        expression.builtinCase === 'empty'
          ? messages.emptySubject
          : messages.invalidCase(expression.builtinCase, subjectCaseLabel(category)),
        expression.value,
      )
    }
    return
  }
  const declaredCase = expression.declaredCase?.ref
  if (!declaredCase) {
    return
  }
  const type = Type.ofExpression(expression.value)
  if (type.kind === 'unresolved') {
    return
  }
  if (AST.isCaseSetCase(declaredCase)) {
    const owner = AST.caseSetOwningCase(declaredCase)
    if (type.kind !== 'enum' || type.declaration !== owner) {
      ctx.error(messages.invalidCase(AST.caseSetCaseName(declaredCase), Type.displayName(type)), expression)
    }
    return
  }
  const subjectField = AST.isMemberAccessExpression(expression.value)
    ? Type.dataFieldOfMemberAccess(expression.value)
    : undefined
  if (!declaredCase.boolean || subjectField !== declaredCase) {
    ctx.error(
      messages.invalidCase(expression.declaredCase?.$refText ?? declaredCase.name, Type.displayName(type)),
      expression,
    )
  }
}

function validateIfCondition(condition: AST.Expression, ctx: ValidationContext): void {
  const type = Type.ofExpression(condition)
  if (type.kind !== 'unresolved' && !isPrimitive(type, 'boolean')) {
    ctx.error(messages.ifCondition, condition)
  }
}

function validateSubjectCases(
  subject: AST.Expression,
  branches: readonly SubjectCaseBranch[],
  ctx: ValidationContext,
): void {
  const category = subjectCaseCategory(subject)
  if (category === 'unresolved') {
    return
  }
  if (category === 'unsupported') {
    ctx.error(messages.subjectCases, subject)
  }
  const allowed = allowedCases(category)
  const seen = new Set<string>()
  for (const branch of branches) {
    if (seen.has(branch.case)) {
      ctx.error(messages.duplicateCase(branch.case), branch)
    }
    seen.add(branch.case)
    if (!allowed.has(branch.case)) {
      ctx.error(messages.invalidCase(branch.case, subjectCaseLabel(category)), branch)
    }
    if ('payload' in branch && branch.payload && branch.case !== 'error') {
      ctx.error(messages.invalidCasePayload, branch.payload)
    }
  }
}

type SubjectCaseCategory = 'boolean' | 'entity' | 'list' | 'query' | 'text' | 'unresolved' | 'unsupported'

function subjectCaseCategory(subject: AST.Expression): SubjectCaseCategory {
  if (
    AST.isValueReference(subject)
    && AST.isEntityQueryDeclaration(subject.target.ref)
  ) {
    return 'query'
  }
  const type = Type.ofExpression(subject)
  return Switch.kind(type, {
    unresolved: () => 'unresolved',
    primitive: type => type.primitive === 'text' || type.primitive === 'boolean' ? type.primitive : 'unsupported',
    list: () => 'list',
    item: () => 'unsupported',
    entity: () => 'entity',
    enum: () => 'unsupported',
    union: () => 'unsupported',
  })
}

function allowedCases(category: SubjectCaseCategory): ReadonlySet<string> {
  return Switch(category, {
    boolean: () => new Set(['true', 'false']),
    entity: () => new Set(['loading', 'missing', 'unauthorized', 'error']),
    list: () => new Set(['empty']),
    query: () => new Set(['empty', 'loading', 'error']),
    text: () => new Set(['empty']),
    unresolved: () => new Set<string>(),
    unsupported: () => new Set<string>(),
  })
}

function subjectCaseLabel(category: SubjectCaseCategory): string {
  if (category === 'unsupported') {
    return 'this subject type'
  }
  return category === 'entity' ? 'an entity subject' : `a ${category} subject`
}

function guardActionBranches(statement: AST.GuardActionStatement): AST.GuardActionBranch[] {
  return statement.caseBlock?.branches ?? (statement.single ? [statement.single] : [])
}

function guardRenderBranches(statement: AST.GuardRenderStatement): AST.GuardRenderBranch[] {
  return statement.caseBlock?.branches ?? (statement.single ? [statement.single] : [])
}

function validateCompatibleBranches(
  values: readonly AST.Expression[],
  ctx: ValidationContext,
): void {
  const resolvedValues = values
    .map(value => ({ value, type: Type.ofExpression(value) }))
    .filter(({ type }) => type.kind !== 'unresolved')
  const incompatible = firstValueWithoutCommonType(resolvedValues)
  if (incompatible) {
    ctx.error(messages.conditionalBranch, incompatible.value)
  }
}

function validateList(list: AST.ListLiteral, ctx: ValidationContext): void {
  const resolvedElements = list.elements
    .map(element => ({ element, type: Type.ofExpression(element) }))
    .filter(({ type }) => type.kind !== 'unresolved')
  const incompatible = firstValueWithoutCommonType(resolvedElements)
  if (incompatible) {
    ctx.error(messages.listElement, incompatible.element)
  }
}

function firstValueWithoutCommonType<ValueT extends { type: ReturnType<typeof Type.ofExpression> }>(
  values: readonly ValueT[],
): ValueT | undefined {
  const prefix = []
  for (const value of values) {
    prefix.push(value.type)
    if (prefix.length > 1 && !Type.commonType(prefix)) {
      return value
    }
  }
  return undefined
}

function validateRenderControlPlacement(
  node: AST.WhenRenderStatement | AST.GuardRenderStatement | AST.IfRenderStatement | AST.ForStatement,
  ctx: ValidationContext,
): void {
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
