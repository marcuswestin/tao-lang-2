import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'
import { isAgentCommandsList } from './agent-commands-validator'
import { FunctionsValidator } from './functions-validator'

const messages = {
  binaryBoolean: (operator: string) => `Operator '${operator}' requires boolean values on both sides.`,
  binaryComparable: (operator: string) => `Operator '${operator}' requires number values on both sides.`,
  binaryCompatible: (operator: string) => `Operator '${operator}' requires compatible values on both sides.`,
  binaryNumeric: (operator: string) => `Operator '${operator}' requires number values on both sides.`,
  actionGuardRetired:
    '`guard` in an action is retired: use `check <condition>` to stop the action, or `if` to branch. `guard` stays the view-side construct.',
  checkCondition: '`check` requires a boolean condition.',
  checkPlacement:
    '`check` stops its whole action, so it belongs in the action itself, not inside an `if`, `guard`, or `when do` block.',
  bareGuardSubject:
    "A bare `guard` sends its subject's exceptional cases to the read net, so its subject must be an entity or a query.",
  emptyGuardCases: 'A `guard` case block names at least one case; to send every case to the read net, drop the braces.',
  appGuardCase: (name: string) =>
    `App guard handles only loading, missing, unauthorized, and error; '${name}' is not one of them.`,
  retiredGuardDefault: '`guard default` moved into the app: write `guard { ... }` inside an app block.',
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
  subjectCases: '`when` and `guard` subjects must be text, list, query, entity, enum, or boolean values.',
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
          ctx.error(expression, messages.unaryBoolean)
        }
        return
      }
      // Negating a unit value is negating its magnitude, so the family passes through.
      if (!isPrimitive(operand, 'number') && !Type.unitFamilyOf(operand)) {
        ctx.error(expression, messages.unaryNumber)
      }
    },
    [AST.CaseTestExpression.$type]: validateCaseTestExpression,
    [AST.WhenExpression.$type]: (expression, ctx) => {
      validateWhenBranches(expression.subject, expression.branches, ctx)
      validateCompatibleBranches(AST.whenExpressionOutcomes(expression).values, ctx)
      validateCompactWhen(expression, ctx)
    },
    [AST.StringInterpolation.$type]: (interpolation, ctx) => {
      const type = Type.ofExpression(interpolation.expression)
      const supported = isSupportedInterpolationType(type)
      if (type.kind !== 'unresolved' && !supported) {
        ctx.error(interpolation.expression, messages.interpolationPart)
      }
    },
    [AST.ListLiteral.$type]: validateList,
    [AST.WhenRenderStatement.$type]: (statement, ctx) => {
      validateWhenBranches(statement.subject, statement.branches, ctx)
      validateRenderControlPlacement(statement, ctx)
    },
    [AST.GuardRenderStatement.$type]: (statement, ctx) => {
      validateSubjectCases(statement.subject, ASTUtils.guardBranches(statement), ctx)
      validateReadNetReach(statement, ctx)
      validateRenderControlPlacement(statement, ctx)
    },
    [AST.AppGuardStatement.$type]: validateAppGuard,
    [AST.GuardDefaultStatement.$type]: (statement, ctx) => ctx.error(statement, messages.retiredGuardDefault),
    [AST.GuardActionStatement.$type]: (statement, ctx) => {
      validateSubjectCases(statement.subject, ASTUtils.guardBranches(statement), ctx)
      // §8 keeps `guard` for views; an action stops with `check`. Retired with a warning for now.
      ctx.warning(statement, messages.actionGuardRetired)
    },
    [AST.IfActionStatement.$type]: (statement, ctx) => {
      validateIfCondition(statement.condition, ctx)
    },
    [AST.CheckStatement.$type]: validateCheck,
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
        ctx.error(statement.collection, messages.forCollection)
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
      ctx.error(expression, messages.binaryBoolean(expression.operator))
    }
    return
  }
  if (['<', '<=', '>', '>='].includes(expression.operator)) {
    if (comparesUnitValues(expression, left, right)) {
      return
    }
    if (!isPrimitive(left, 'number') || !isPrimitive(right, 'number')) {
      ctx.error(expression, messages.binaryComparable(expression.operator))
    }
    return
  }
  if (expression.operator === '==' || expression.operator === '!=') {
    if (comparesUnitValues(expression, left, right)) {
      return
    }
    if (!Type.isAssignable(left, right) && !Type.isAssignable(right, left)) {
      ctx.error(expression, messages.binaryCompatible(expression.operator))
    }
    return
  }
  if (expression.operator === '+' && isPrimitive(left, 'text') && isPrimitive(right, 'text')) {
    return
  }
  // A shortcut reads as its modifiers followed by one key, so `+` chains a modifier onto a key.
  if (expression.operator === '+' && isPrimitive(left, 'shortcut') && isPrimitive(right, 'text')) {
    return
  }
  // A unit value on either side makes this dimensional analysis rather than plain arithmetic.
  if (Type.unitFamilyOf(left) || Type.unitFamilyOf(right) || isPrimitive(left, 'time') || isPrimitive(right, 'time')) {
    if (!Type.dimensionalResult(left, expression.operator, right)) {
      ctx.error(
        expression,
        messages.dimensional(dimensionName(left), expression.operator, dimensionName(right)),
      )
    }
    return
  }
  if (!isPrimitive(left, 'number') || !isPrimitive(right, 'number')) {
    ctx.error(expression, messages.binaryNumeric(expression.operator))
  }
}

function isSupportedInterpolationType(type: ASTUtils.TaoType): boolean {
  if (type.kind === 'unresolved') {
    return true
  }
  if (type.kind === 'union') {
    return type.members.every(isSupportedInterpolationType)
  }
  return type.kind === 'primitive'
    && ['text', 'number', 'boolean', 'none'].includes(type.primitive)
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
  if (!expression.positive || !expression.subject) {
    return
  }
  const subject = Type.ofExpression(expression.subject)
  if (subject.kind !== 'unresolved' && !isPrimitive(subject, 'boolean')) {
    ctx.error(expression, messages.compactWhenSubject)
    return
  }
  const label = expression.negativeLabel
  if (label === undefined || label === 'not') {
    return
  }
  const alias = negativePoleAlias(expression.subject)
  if (label !== alias) {
    ctx.error(expression, messages.compactWhenLabel(label, alias ?? 'not'))
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
    ctx.error(declaration, messages.enumPlacement)
  }
  const seen = new Set<string>()
  for (const enumCase of AST.caseSetCasesOf(declaration)) {
    const caseName = AST.caseSetCaseName(enumCase)
    if (seen.has(caseName)) {
      ctx.error(enumCase, messages.duplicateEnumCase(declaration.name, caseName))
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
    if (!allowedCases(category).has(AST.canonicalSubjectCase(expression.builtinCase))) {
      ctx.error(
        expression.value,
        expression.builtinCase === 'empty'
          ? messages.emptySubject
          : messages.invalidCase(expression.builtinCase, subjectCaseLabel(category)),
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
      ctx.error(expression, messages.invalidCase(AST.caseSetCaseName(declaredCase), Type.displayName(type)))
    }
    return
  }
  const subjectField = AST.isMemberAccessExpression(expression.value)
    ? Type.dataFieldOfMemberAccess(expression.value)
    : undefined
  if (!declaredCase.boolean || subjectField !== declaredCase) {
    ctx.error(
      expression,
      messages.invalidCase(expression.declaredCase?.$refText ?? declaredCase.name, Type.displayName(type)),
    )
  }
}

function validateIfCondition(condition: AST.Expression, ctx: ValidationContext): void {
  const type = Type.ofExpression(condition)
  if (type.kind !== 'unresolved' && !isPrimitive(type, 'boolean')) {
    ctx.error(condition, messages.ifCondition)
  }
}

/**
 * A false check returns from the callback that owns its block. An `if` block, a `guard` case, or a
 * `when do` outcome compiles to a nested callback, so a check there would skip only that sub-block
 * while the action carried on.
 */
function validateCheck(statement: AST.CheckStatement, ctx: ValidationContext): void {
  const type = Type.ofExpression(statement.condition)
  if (type.kind !== 'unresolved' && !isPrimitive(type, 'boolean')) {
    ctx.error(statement.condition, messages.checkCondition)
  }
  const owner = statement.$container.$container
  if (AST.isIfActionStatement(owner) || AST.isGuardActionBranch(owner) || AST.isWhenDoOutcome(owner)) {
    ctx.error(statement, messages.checkPlacement)
  }
}

function validateWhenBranches(
  subject: AST.Expression | undefined,
  branches: readonly (AST.WhenBranch | AST.WhenRenderBranch)[],
  ctx: ValidationContext,
): void {
  if (subject) {
    validateSubjectCases(subject, branches, ctx)
    return
  }
  for (const branch of branches) {
    if (branch.condition) {
      validateIfCondition(branch.condition, ctx)
    }
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
    ctx.error(subject, messages.subjectCases)
  }
  const subjectType = Type.ofExpression(subject)
  const allowed = subjectType.kind === 'enum'
    ? new Set(AST.caseSetCasesOf(subjectType.declaration).map(AST.caseSetCaseName))
    : allowedCases(category)
  const seen = new Set<string>()
  for (const branch of branches) {
    if (branch.case === undefined) {
      continue
    }
    const name = AST.canonicalSubjectCase(branch.case)
    if (seen.has(name)) {
      ctx.error(branch, messages.duplicateCase(branch.case))
    }
    seen.add(name)
    if (!allowed.has(name)) {
      ctx.error(branch, messages.invalidCase(branch.case, subjectCaseLabel(category)))
    }
    if (
      'payload' in branch && branch.payload && branch.case !== 'error'
      && !(AST.isGuardRenderBranch(branch) && readNetCaseNames.has(name))
    ) {
      ctx.error(branch.payload, messages.invalidCasePayload)
    }
  }
}

/**
 * A bare guard hands its subject's exceptional cases to the read net, so a subject that has none — a
 * text, list, or yes/no value, whose cases are content — would guard nothing. An empty case block is
 * the same guard spelled with braces it does not need.
 */
function validateReadNetReach(statement: AST.GuardRenderStatement, ctx: ValidationContext): void {
  if (statement.caseBlock) {
    if (statement.caseBlock.branches.length === 0) {
      ctx.error(statement.caseBlock, messages.emptyGuardCases)
    }
    return
  }
  if (statement.single) {
    return
  }
  const category = subjectCaseCategory(statement.subject)
  if (category !== 'unresolved' && category !== 'unsupported' && readNetCases(category).size === 0) {
    ctx.error(statement.subject, messages.bareGuardSubject)
  }
}

/** The read net's cases: the exceptional ones, which are exactly those carrying no content. */
const readNetCaseNames: ReadonlySet<string> = new Set(['loading', 'missing', 'unauthorized', 'error'])

function readNetCases(category: SubjectCaseCategory): ReadonlySet<string> {
  return new Set([...allowedCases(category)].filter(caseName => readNetCaseNames.has(caseName)))
}

/**
 * An app guard overrides exceptional read cases for its app; any named case can bind ReadContext.
 */
function validateAppGuard(statement: AST.AppGuardStatement, ctx: ValidationContext): void {
  const seen = new Set<string>()
  for (const branch of statement.branches) {
    if (seen.has(branch.case)) {
      ctx.error(branch, messages.duplicateCase(branch.case))
    }
    seen.add(branch.case)
    if (!readNetCaseNames.has(branch.case)) {
      ctx.error(branch, messages.appGuardCase(branch.case))
    }
  }
}

type SubjectCaseCategory = 'enum' | 'boolean' | 'entity' | 'list' | 'query' | 'text' | 'unresolved' | 'unsupported'

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
    enum: () => 'enum',
    union: () => 'unsupported',
  })
}

function allowedCases(category: SubjectCaseCategory): ReadonlySet<string> {
  return Switch(category, {
    enum: () => new Set<string>(),
    boolean: () => new Set(['true', 'false']),
    entity: () => new Set(['loading', 'missing', 'unauthorized', 'error']),
    list: () => new Set(['empty']),
    query: () => new Set(['empty', 'loading', 'refreshing', 'stale', 'error']),
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

function validateCompatibleBranches(
  values: readonly AST.Expression[],
  ctx: ValidationContext,
): void {
  const resolvedValues = values
    .map(value => ({ value, type: Type.ofExpression(value) }))
    .filter(({ type }) => type.kind !== 'unresolved')
  const incompatible = firstValueWithoutCommonType(resolvedValues)
  if (incompatible) {
    ctx.error(incompatible.value, messages.conditionalBranch)
  }
}

function validateList(list: AST.ListLiteral, ctx: ValidationContext): void {
  if (isAgentCommandsList(list)) {
    return
  }
  const resolvedElements = list.elements
    .map(element => ({ element, type: Type.ofExpression(element) }))
    .filter(({ type }) => type.kind !== 'unresolved')
  const incompatible = firstValueWithoutCommonType(resolvedElements)
  if (incompatible) {
    ctx.error(incompatible.element, messages.listElement)
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
    if (AST.isViewDeclaration(current)) {
      break
    }
    current = current.$container
  }
  ctx.error(node, messages.renderControlPlacement)
}

function isPrimitive(type: ReturnType<typeof Type.ofExpression>, primitive: string): boolean {
  return type.kind === 'primitive' && type.primitive === primitive
}
