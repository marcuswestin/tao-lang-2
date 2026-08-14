import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'

const messages = {
  binaryBoolean: (operator: string) => `Operator '${operator}' requires boolean values on both sides.`,
  binaryComparable: (operator: string) => `Operator '${operator}' requires number values on both sides.`,
  binaryCompatible: (operator: string) => `Operator '${operator}' requires compatible values on both sides.`,
  binaryNumeric: (operator: string) => `Operator '${operator}' requires number values on both sides.`,
  conditionalBranch: '`when` branches must produce compatible value types.',
  duplicateCase: (name: string) => `Case '${name}' is declared more than once for this subject.`,
  emptySubject: '`is empty` accepts text, list, or query values.',
  enumPlacement: 'Enums must be declared at file level.',
  duplicateEnumCase: (enumName: string, caseName: string) =>
    `Enum '${enumName}' declares case '${caseName}' more than once.`,
  duplicateParameter: (name: string) => `Parameter '${name}' is declared more than once in this function.`,
  forCollection: '`loop` requires a list value before `/`.',
  functionMissingArgument: (name: string, parameter: string) =>
    `Function '${name}' is missing argument for parameter '${parameter}'.`,
  functionUnmatchedArgument: (name: string) =>
    `Function '${name}' has an argument that does not match any unbound parameter by type.`,
  functionAmbiguousArgument: (name: string, parameters: readonly AST.ParameterDeclaration[]) =>
    `Function '${name}' has an argument that matches multiple parameters by type: ${
      parameters.map(Type.parameterName).join(', ')
    }.`,
  functionAmbiguousParameter: (name: string, parameter: string) =>
    `Function '${name}' has multiple arguments that match parameter '${parameter}' by type.`,
  functionDuplicateParameterType: (name: string, parameter: string) =>
    `Function '${name}' has more than one parameter with the same type near '${parameter}'.`,
  functionDuplicateArgumentType: (name: string) =>
    `Function '${name}' has more than one argument with the same exact type.`,
  functionUnknownLabel: (name: string, label: string) =>
    `Function '${name}' has no parameter named '${label}'; labels resolve only the invoked owner's parameters, not visible types.`,
  functionDuplicateLabel: (name: string, label: string) =>
    `Function '${name}' receives parameter '${label}' more than once.`,
  functionLabelType: (name: string, label: string, expected: string, actual: string) =>
    `Labeled argument '${label}:' of function '${name}' expects ${expected}, got ${actual}.`,
  functionPlacement: 'Pure functions must be declared at file level.',
  functionReturn: (name: string, expected: string, actual: string) =>
    `Function '${name}' returns ${expected}, but its expression produces ${actual}.`,
  interpolationPart: 'String interpolation accepts text, number, boolean, or none values.',
  ifCondition: '`if` requires a boolean condition.',
  invalidCase: (name: string, subject: string) => `Case '${name}' is not valid for ${subject}.`,
  invalidCasePayload: "Only an 'error -> Name' case may introduce an error-message value.",
  listElement: 'List elements must have compatible types.',
  renderControlPlacement: '`when`, `guard`, `if`, and `for` rendering must be nested inside a render child block.',
  subjectCases: '`when` and `guard` subjects must be text, list, query, entity, or boolean values.',
  unaryBoolean: "Unary 'not' requires a boolean value.",
  unaryNumber: "Unary '-' requires a number value.",
} as const

/** FunctionalCoreValidator validates pure expressions, functions, and render control flow. */
export const FunctionalCoreValidator = {
  checks: {
    [AST.EnumDeclaration.$type]: validateEnum,
    [AST.FunctionDeclaration.$type]: validateFunction,
    [AST.FunctionCallExpression.$type]: validateFunctionCall,
    [AST.BinaryExpression.$type]: validateBinary,
    [AST.UnaryExpression.$type]: (expression, ctx) => {
      const operand = Type.ofExpression(expression.operand)
      const expected = expression.operator === 'not' ? 'boolean' : 'number'
      if (!isPrimitive(operand, expected)) {
        ctx.error(expression.operator === 'not' ? messages.unaryBoolean : messages.unaryNumber, expression)
      }
    },
    [AST.CaseTestExpression.$type]: validateCaseTestExpression,
    [AST.WhenExpression.$type]: (expression, ctx) => {
      validateSubjectCases(expression.subject, expression.branches, ctx)
      validateCompatibleBranches(
        [...expression.branches.map(branch => branch.value), expression.otherwise.value],
        ctx,
      )
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
  const resolved = ASTUtils.resolveFunctionInvocation(call)
  const fn = resolved.function
  if (!fn) {
    return
  }
  for (const diagnostic of resolved.diagnostics) {
    Switch.kind(diagnostic, {
      'missing-argument': diagnostic => {
        ctx.error(messages.functionMissingArgument(fn.name, Type.parameterName(diagnostic.parameter)), call)
      },
      'unmatched-argument': diagnostic => {
        ctx.error(messages.functionUnmatchedArgument(fn.name), diagnostic.argument)
      },
      'ambiguous-argument': diagnostic => {
        ctx.error(messages.functionAmbiguousArgument(fn.name, diagnostic.parameters), diagnostic.argument)
      },
      'ambiguous-parameter': diagnostic => {
        ctx.error(messages.functionAmbiguousParameter(fn.name, Type.parameterName(diagnostic.parameter)), call)
      },
      'duplicate-argument-type': diagnostic => {
        ctx.error(messages.functionDuplicateArgumentType(fn.name), diagnostic.argument)
      },
      'duplicate-parameter-type': diagnostic => {
        ctx.error(messages.functionDuplicateParameterType(fn.name, Type.parameterName(diagnostic.parameter)), call)
      },
      'unknown-named-argument': diagnostic => {
        ctx.error(messages.functionUnknownLabel(fn.name, diagnostic.name), diagnostic.argument)
      },
      'duplicate-named-argument': diagnostic => {
        ctx.error(
          messages.functionDuplicateLabel(fn.name, Type.parameterName(diagnostic.parameter)),
          diagnostic.argument,
        )
      },
      'named-argument-type': diagnostic => {
        ctx.error(
          messages.functionLabelType(
            fn.name,
            Type.parameterName(diagnostic.parameter),
            Type.displayName(Type.ofParameter(diagnostic.parameter)),
            Type.displayName(Type.ofArgument(diagnostic.argument)),
          ),
          diagnostic.argument,
        )
      },
    })
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

type SubjectCaseBranch = AST.WhenBranch | AST.WhenRenderBranch | AST.GuardActionBranch | AST.GuardRenderBranch

function validateEnum(declaration: AST.EnumDeclaration, ctx: ValidationContext): void {
  if (!AST.isTaoFile(declaration.$container)) {
    ctx.error(messages.enumPlacement, declaration)
  }
  const seen = new Set<string>()
  for (const enumCase of declaration.block.cases) {
    if (seen.has(enumCase.name)) {
      ctx.error(messages.duplicateEnumCase(declaration.name, enumCase.name), enumCase)
    }
    seen.add(enumCase.name)
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
  if (AST.isEnumCase(declaredCase)) {
    const owner = AST.enumOwningCase(declaredCase)
    if (type.kind !== 'enum' || type.declaration !== owner) {
      ctx.error(messages.invalidCase(declaredCase.name, Type.displayName(type)), expression)
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
