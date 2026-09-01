import { type ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { DeclarationOrder } from '../DeclarationOrder'
import type { NodeValidationChecks } from '../node-validation'
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
  typeChecks: {
    [AST.SetStatement.$type]: reportSetStatementTypes,
    [AST.StateDeclaration.$type]: reportStateDeclarationTypes,
  } satisfies NodeValidationChecks,
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

function isPersistableType(
  type: ASTUtils.TaoType,
  seen: ReadonlySet<AST.TypeDefinition> = new Set(),
): boolean {
  const nominal = persistableNominal(type)
  if (nominal && seen.has(nominal)) {
    return false
  }
  const nextSeen = nominal ? new Set([...seen, nominal]) : seen
  if (type.kind === 'primitive') {
    return ['boolean', 'duration', 'none', 'number', 'text', 'time'].includes(type.primitive)
  }
  if (type.kind === 'list') {
    return type.element === undefined || isPersistableType(type.element, nextSeen)
  }
  if (type.kind === 'item') {
    return type.item !== undefined
      && type.item.properties.every(property => isPersistableType(Type.ofProperty(property), nextSeen))
  }
  if (type.kind === 'enum') {
    return true
  }
  if (type.kind === 'union') {
    return type.members.every(member => isPersistableType(member, nextSeen))
  }
  return false
}

function persistableNominal(type: ASTUtils.TaoType): AST.TypeDefinition | undefined {
  return type.kind === 'primitive' || type.kind === 'list' || type.kind === 'item'
    ? type.nominal
    : undefined
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

/** reportSetStatementTypes requires `set` values to match the target state's type. */
function reportSetStatementTypes(setStatement: AST.SetStatement, ctx: ValidationContext): void {
  const state = setStatement.target.ref
  if (!state) {
    return
  }

  const expected = Type.ofValueDeclaration(state)
  const actual = Type.ofExpression(setStatement.value)
  if (expected.kind === 'unresolved' || actual.kind === 'unresolved') {
    return
  }

  // A compound operator reads the state as a number, so the operator itself is the whole error and
  // the assignment check below would only restate it.
  if (setStatement.operator !== '=' && !isPlainNumberType(expected)) {
    ctx.error(
      stateValidationMessages.compoundStateType(state.name, setStatement.operator, Type.displayName(expected)),
      setStatement,
    )
    return
  }

  if (!Type.isAssignable(actual, expected)) {
    ctx.error(
      stateValidationMessages.setTypeMismatch(
        state.name,
        Type.displayName(expected),
        Type.displayName(actual),
      ),
      setStatement.value,
    )
  }
}

/** isPlainNumberType returns whether a type is `number` itself rather than a refinement of it. */
function isPlainNumberType(type: ASTUtils.TaoType): boolean {
  return type.kind === 'primitive' && type.nominal === undefined && type.primitive === 'number'
}

/** reportStateDeclarationTypes checks a state's declared type and rejects stored actions. */
function reportStateDeclarationTypes(state: AST.StateDeclaration, ctx: ValidationContext): void {
  if (state.type) {
    const expected = Type.ofReference(state.type)
    const actual = Type.ofExpression(state.value)
    if (expected.kind !== 'unresolved' && actual.kind !== 'unresolved' && !Type.isAssignable(actual, expected)) {
      ctx.error(
        stateValidationMessages.initialTypeMismatch(
          state.name,
          Type.displayName(expected),
          Type.displayName(actual),
        ),
        state.value,
      )
      return
    }
  }
  const valueType = Type.ofExpression(state.value)
  if (valueType.kind === 'primitive' && valueType.primitive === 'action') {
    ctx.error(stateValidationMessages.stateActionType(state.name), state.value)
  }
}
