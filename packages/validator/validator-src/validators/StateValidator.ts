import { type ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import type { ValidationProblemAcceptor } from 'typir'
import { DeclarationOrder } from '../DeclarationOrder'
import type { NodeValidationChecks } from '../node-validation'
import { type TaoSpecifics, type TaoTypirServices, TypeSystemHelpers } from '../TypeSystemHelpers'
import type { ValidationContext } from '../validation'

const stateValidationMessages = {
  usedBeforeDeclaration: (name: string) => `Name '${name}' is used before it is declared.`,
  setTypeMismatch: (state: string, expected: string, actual: string) =>
    `State '${state}' expects ${expected}, got ${actual}.`,
  stateActionType: (state: string) => `State '${state}' cannot store an action value in this MVP.`,
  compoundStateType: (state: string, operator: AST.SetOperator, actual: string) =>
    `Compound set '${operator}' requires state '${state}' to be number, got ${actual}.`,
  toggleStateType: (state: string, actual: string) =>
    `\`toggle\` requires state '${state}' to be boolean, got ${actual}.`,
  persistedOnlyInApp: (state: string) => `Persisted state '${state}' is only allowed directly inside an app.`,
  appStateMustPersist: (state: string) => `App state '${state}' must declare (persist).`,
  persistedTypeRequired: (state: string) => `Persisted state '${state}' must declare its type with 'is'.`,
  persistedTypeUnsupported: (state: string, type: string) =>
    `Persisted state '${state}' cannot use nonpersistable type '${type}'.`,
  initialTypeMismatch: (state: string, expected: string, actual: string) =>
    `State '${state}' declares ${expected}, got initial value ${actual}.`,
} as const

/** StateValidator groups state validation and diagnostics. */
export const StateValidator = {
  checks: {
    [AST.StateDeclaration.$type]: [reportStateReferenceOrder, reportStatePlacement],
    [AST.SetStatement.$type]: reportStateMutationTargetReferenceOrder,
    [AST.ToggleStatement.$type]: [reportStateMutationTargetReferenceOrder, reportToggleTarget],
  } satisfies NodeValidationChecks,
  messages: stateValidationMessages,
  registerTypeValidation,
}

function reportStatePlacement(state: AST.StateDeclaration, ctx: ValidationContext): void {
  const app = AST.isAppBlock(state.$container) && AST.isAppDeclaration(state.$container.$container)
    ? state.$container.$container
    : undefined
  if (app) {
    if (!state.persist) {
      ctx.error(stateValidationMessages.appStateMustPersist(state.name), state)
    }
    if (!state.type) {
      ctx.error(stateValidationMessages.persistedTypeRequired(state.name), state)
    } else {
      const type = Type.ofReference(state.type)
      if (type.kind !== 'unresolved' && !isPersistableType(type)) {
        ctx.error(stateValidationMessages.persistedTypeUnsupported(state.name, Type.displayName(type)), state.type)
      }
    }
    return
  }
  if (state.persist) {
    ctx.error(stateValidationMessages.persistedOnlyInApp(state.name), state)
  }
}

function isPersistableType(type: ASTUtils.TaoType): boolean {
  if (type.kind === 'primitive') {
    return ['boolean', 'duration', 'none', 'number', 'text', 'time'].includes(type.primitive)
  }
  if (type.kind === 'list') {
    return type.element === undefined || isPersistableType(type.element)
  }
  if (type.kind === 'item' && type.item) {
    return type.item.properties.every(property => isPersistableType(Type.ofProperty(property)))
  }
  if (type.kind === 'union') {
    return type.members.every(isPersistableType)
  }
  return false
}

function reportToggleTarget(toggle: AST.ToggleStatement, ctx: ValidationContext): void {
  const state = toggle.target.ref
  if (!state) {
    return
  }
  const stateType = Type.ofExpression(state.value)
  if (stateType.kind === 'unresolved') {
    return
  }
  if (stateType.kind !== 'primitive' || stateType.primitive !== 'boolean') {
    ctx.error(stateValidationMessages.toggleStateType(state.name, Type.displayName(stateType)), toggle)
  }
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

function reportStateReferenceOrder(state: AST.StateDeclaration, ctx: ValidationContext): void {
  for (const reference of DeclarationOrder.valueReferences(state.value)) {
    const target = reference.target.ref
    if (AST.isValueDeclaration(target) && isInvalidStateInitializerReferenceOrder(target, state)) {
      ctx.error(stateValidationMessages.usedBeforeDeclaration(valueDeclarationName(target)), reference)
    }
  }
}

function valueDeclarationName(declaration: AST.ValueDeclaration | undefined): string {
  return declaration ? Type.declarationName(declaration) : '<unresolved>'
}

function reportStateMutationTargetReferenceOrder(
  mutation: AST.SetStatement | AST.ToggleStatement,
  ctx: ValidationContext,
): void {
  const target = mutation.target.ref
  if (isInvalidStateMutationTargetReferenceOrder(target, mutation)) {
    ctx.error(stateValidationMessages.usedBeforeDeclaration(target.name), mutation)
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

function isInvalidStateMutationTargetReferenceOrder(
  target: AST.StateDeclaration | undefined,
  mutation: AST.SetStatement | AST.ToggleStatement,
): target is AST.StateDeclaration {
  return target !== undefined
    && DeclarationOrder.isViewOwnedValueDeclaration(target)
    && DeclarationOrder.isUsedBeforeDeclaration(target, mutation)
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
  if (state.type) {
    const expected = Type.ofReference(state.type)
    const actual = Type.ofExpression(state.value)
    if (expected.kind !== 'unresolved' && actual.kind !== 'unresolved' && !Type.isAssignable(actual, expected)) {
      accept({
        languageNode: state.value,
        message: stateValidationMessages.initialTypeMismatch(
          state.name,
          Type.displayName(expected),
          Type.displayName(actual),
        ),
        severity: 'error',
      })
      return
    }
  }
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
