import { Type } from '@ast-utils'
import { AST } from '@parser'
import type { ValidationProblemAcceptor } from 'typir'
import { DeclarationOrder } from './DeclarationOrder'
import { type TaoSpecifics, type TaoTypirServices, TypeSystemHelpers } from './TypeSystemHelpers'
import type { ValidationContext } from './validation'

const stateValidationMessages = {
  usedBeforeDeclaration: (name: string) => `Name '${name}' is used before it is declared.`,
  setTypeMismatch: (state: string, expected: string, actual: string) =>
    `State '${state}' expects ${expected}, got ${actual}.`,
  stateActionType: (state: string) => `State '${state}' cannot store an action value in this MVP.`,
  compoundStateType: (state: string, operator: AST.SetOperator, actual: string) =>
    `Compound set '${operator}' requires state '${state}' to be number, got ${actual}.`,
} as const

/** StateValidator groups state validation and diagnostics. */
export const StateValidator = {
  messages: stateValidationMessages,
  registerTypeValidation,
  validate,
}

function validate(file: AST.TaoFile, ctx: ValidationContext): void {
  reportStateReferenceOrder(allStates(file), ctx)
  reportSetTargetReferenceOrder(file, ctx)
}

function registerTypeValidation(typir: TaoTypirServices): void {
  typir.validation.Collector.addValidationRulesForAstNodes({
    SetStatement: (setStatement, accept, services) => {
      validateSetStatementTypes(setStatement, accept, services as TaoTypirServices)
    },
    StateDeclaration: (state, accept, services) => {
      validateStateDeclarationTypes(state, accept, services as TaoTypirServices)
    },
  })
}

function allStates(file: AST.TaoFile): AST.StateDeclaration[] {
  return AST.streamAllContents(file).filter(AST.isStateDeclaration)
}

function reportStateReferenceOrder(states: readonly AST.StateDeclaration[], ctx: ValidationContext): void {
  for (const state of states) {
    for (const reference of DeclarationOrder.valueReferences(state.value)) {
      const target = reference.target.ref
      if (isInvalidStateInitializerReferenceOrder(target, state)) {
        ctx.error(stateValidationMessages.usedBeforeDeclaration(valueDeclarationName(target)), reference)
      }
    }
  }
}

function valueDeclarationName(declaration: AST.ValueDeclaration | undefined): string {
  return declaration ? Type.declarationName(declaration) : '<unresolved>'
}

function reportSetTargetReferenceOrder(file: AST.TaoFile, ctx: ValidationContext): void {
  for (const setStatement of AST.streamAllContents(file).filter(AST.isSetStatement)) {
    const target = setStatement.target.ref
    if (isInvalidSetTargetReferenceOrder(target, setStatement)) {
      ctx.error(stateValidationMessages.usedBeforeDeclaration(target.name), setStatement)
    }
  }
}

function isInvalidStateInitializerReferenceOrder(
  declaration: AST.ValueDeclaration | undefined,
  state: AST.StateDeclaration,
): declaration is AST.ValueDeclaration {
  return declaration !== undefined
    && (
      DeclarationOrder.isViewOwnedValueDeclaration(declaration)
      || AST.findOwningView(state) === undefined
    )
    && DeclarationOrder.isUsedBeforeDeclaration(declaration, state)
}

function isInvalidSetTargetReferenceOrder(
  target: AST.StateDeclaration | undefined,
  setStatement: AST.SetStatement,
): target is AST.StateDeclaration {
  return target !== undefined
    && DeclarationOrder.isViewOwnedValueDeclaration(target)
    && DeclarationOrder.isUsedBeforeDeclaration(target, setStatement)
}

function validateSetStatementTypes(
  setStatement: AST.SetStatement,
  accept: ValidationProblemAcceptor<TaoSpecifics>,
  services: TaoTypirServices,
): void {
  const state = setStatement.target.ref
  if (!state) {
    return
  }

  const stateType = TypeSystemHelpers.safeInferType(services, state)
  const underlying = TypeSystemHelpers.underlyingPrimitiveName(stateType)
  if (!underlying) {
    validateSemanticSetStatementTypes(setStatement, state, accept)
    return
  }

  if (setStatement.operator !== '=' && underlying !== 'number') {
    accept({
      languageNode: setStatement,
      message: stateValidationMessages.compoundStateType(
        state.name,
        setStatement.operator,
        stateType?.getName() ?? 'unknown',
      ),
      severity: 'error',
    })
  }

  const expected = TypeSystemHelpers.taoPrimitiveType(underlying, services)
  services.validation.Constraints.ensureNodeIsAssignable(setStatement.value, expected, accept, actual => ({
    languageNode: setStatement.value,
    message: stateValidationMessages.setTypeMismatch(state.name, underlying, actual.name),
  }))
}

function validateSemanticSetStatementTypes(
  setStatement: AST.SetStatement,
  state: AST.StateDeclaration,
  accept: ValidationProblemAcceptor<TaoSpecifics>,
): void {
  const expected = Type.ofExpression(state.value)
  const actual = Type.ofExpression(setStatement.value)
  if (expected.kind === 'unresolved' || actual.kind === 'unresolved') {
    return
  }

  if (setStatement.operator !== '=') {
    accept({
      languageNode: setStatement,
      message: stateValidationMessages.compoundStateType(state.name, setStatement.operator, Type.displayName(expected)),
      severity: 'error',
    })
    return
  }

  if (!Type.isAssignable(actual, expected)) {
    accept({
      languageNode: setStatement.value,
      message: stateValidationMessages.setTypeMismatch(
        state.name,
        Type.displayName(expected),
        Type.displayName(actual),
      ),
      severity: 'error',
    })
  }
}

function validateStateDeclarationTypes(
  state: AST.StateDeclaration,
  accept: ValidationProblemAcceptor<TaoSpecifics>,
  services: TaoTypirServices,
): void {
  const semanticType = Type.ofExpression(state.value)
  if (semanticType.kind === 'primitive' && semanticType.primitive === 'action') {
    accept({
      languageNode: state.value,
      message: stateValidationMessages.stateActionType(state.name),
      severity: 'error',
    })
    return
  }

  const valueType = TypeSystemHelpers.safeInferType(services, state.value)
  if (TypeSystemHelpers.underlyingPrimitiveName(valueType) !== 'action') {
    return
  }

  accept({
    languageNode: state.value,
    message: stateValidationMessages.stateActionType(state.name),
    severity: 'error',
  })
}
