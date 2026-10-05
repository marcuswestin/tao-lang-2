import { AST } from '@parser'
import {
  type AssociatedCallableDeclaration,
  associatedMethodCallTarget,
  type AssociatedMethodReceiver,
} from './associated-methods'
import { NumericUnits } from './NumericUnits'
import { type TaoType, Type } from './Type'

/** A recognized unit reading retains every authored declaration and the real receiver anchor. */
export type NumericUnitReading = Readonly<{
  invocation: AST.MethodCallExpression
  receiverAnchor: AssociatedMethodReceiver
  receiverType: TaoType
  resultType: TaoType
  concreteFactoryOwner: AST.TypeDeclaration
  unitOwner: AST.TypeDeclaration
  unit: AST.NumericUnitDeclaration
  unitName: string
}>

export type NumericUnitReadingResolution =
  | Readonly<{ kind: 'unit-reading'; reading: NumericUnitReading }>
  | Readonly<{ kind: 'not-unit-reading'; invocation: AST.MethodCallExpression }>
  | Readonly<{
    kind: 'invalid-unit-reading'
    invocation: AST.MethodCallExpression
    reading: NumericUnitReading
    problem: 'arguments' | 'associated-method-collision'
  }>

/** Unit readings are recognized only from linked unit rows on a nominal numeric receiver. */
export function resolveNumericUnitReading(
  invocation: AST.MethodCallExpression,
  options: { receiverType?(receiver: AssociatedMethodReceiver): TaoType } = {},
): NumericUnitReadingResolution {
  const target = associatedMethodCallTarget(invocation)
  if (!target) {
    return { kind: 'not-unit-reading', invocation }
  }
  const receiver = options.receiverType
    ? options.receiverType(target.receiver)
    : target.receiver.kind === 'expression'
    ? Type.ofExpression(target.receiver.expression)
    : Type.atMemberPath(Type.ofReferenceRoot(target.receiver.site), target.receiver.members)
  if (receiver.kind !== 'primitive' || receiver.primitive !== 'numeric') {
    return { kind: 'not-unit-reading', invocation }
  }
  const concreteFactoryOwner = Type.quantityOwner(receiver)
  if (!concreteFactoryOwner) {
    return { kind: 'not-unit-reading', invocation }
  }
  const unitOwner = NumericUnits.unitOwner(concreteFactoryOwner)
  const plan = unitOwner ? NumericUnits.declarationPlan(unitOwner) : undefined
  const unit = unitOwner?.type && AST.isDerivedTypeExpression(unitOwner.type)
    ? unitOwner.type.slots.unitBlocks.flatMap(block => block.units).find(candidate => candidate.name === target.name)
    : undefined
  const plannedUnit = plan?.units.find(candidate => candidate.name === target.name)
  if (!unitOwner || !plan || !unit || !plannedUnit) {
    return { kind: 'not-unit-reading', invocation }
  }
  const reading: NumericUnitReading = {
    invocation,
    receiverAnchor: target.receiver,
    receiverType: receiver,
    resultType: receiver,
    concreteFactoryOwner,
    unitOwner,
    unit,
    unitName: unit.name,
  }
  if (Type.associatedMethodDeclaration(receiver, target.name)) {
    return { kind: 'invalid-unit-reading', invocation, reading, problem: 'associated-method-collision' }
  }
  if (AST.argumentsOf(invocation).length > 0) {
    return { kind: 'invalid-unit-reading', invocation, reading, problem: 'arguments' }
  }
  return { kind: 'unit-reading', reading }
}

/** Collisions for a declaration are based on its effective unit table and canonical method lookup. */
export function numericUnitReadingCollisions(
  owner: AST.TypeDeclaration,
): readonly Readonly<{
  unit: AST.NumericUnitDeclaration
  method: AssociatedCallableDeclaration
}>[] {
  const tableOwner = NumericUnits.unitOwner(owner)
  const plan = tableOwner ? NumericUnits.declarationPlan(tableOwner) : undefined
  const units = tableOwner?.type && AST.isDerivedTypeExpression(tableOwner.type)
    ? tableOwner.type.slots.unitBlocks.flatMap(block => block.units)
    : []
  if (!plan) {
    return []
  }
  return units.flatMap(unit => {
    if (!plan.units.some(candidate => candidate.name === unit.name)) {
      return []
    }
    const method = Type.associatedMethodDeclaration(Type.ofDefinition(owner), unit.name)?.declaration
    return method ? [{ unit, method }] : []
  })
}
