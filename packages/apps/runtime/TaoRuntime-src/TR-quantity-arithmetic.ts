import type { TaoEvaluable } from './TR-action-values'
import { TaoActionFailure } from './TR-errors'
import { isQuantityPayload, QuantityFailureCases } from './TR-quantity-values'

type QuantityFactoryLike = Readonly<{
  definition: Readonly<{
    units: Readonly<Record<string, number>>
    defaultUnit: string
  }>
  fromJSValue(canonical: unknown): TaoEvaluable<unknown>
  acceptsPayload(payload: unknown): boolean
  // `never[]` keeps this capability check compatible with emitted facades whose parameters are
  // intentionally narrowed to their exact runtime value and declared unit types.
  read: (...args: never[]) => Readonly<{ canonical: number; unit: string }>
  inUnit: (...args: never[]) => TaoEvaluable<unknown>
}>

type RuntimeQuantityFactory =
  & QuantityFactoryLike
  & Readonly<{
    acceptsPayload(payload: unknown): boolean
    read(value: TaoEvaluable<unknown>): Readonly<{ canonical: number; unit: string }>
    inUnit(value: TaoEvaluable<unknown>, unit: string): TaoEvaluable<unknown>
  }>

type QuantityOperand<Factory extends QuantityFactoryLike = QuantityFactoryLike> = Readonly<{
  kind: 'quantity'
  factory: Factory
  value: TaoEvaluable<unknown>
}>

type ScalarOperand = Readonly<{
  kind: 'scalar'
  value: number | TaoEvaluable<number>
}>

export type TaoQuantityArithmeticOperand = QuantityOperand | ScalarOperand

type QuantitySnapshot = Readonly<{
  canonical: number
  unit: string
  factory: RuntimeQuantityFactory
  payload: unknown
}>

type OperandSnapshot = QuantitySnapshot | Readonly<{ canonical: number }>

type UnitOf<Factory extends QuantityFactoryLike> = Extract<keyof Factory['definition']['units'], string>
type ResultOf<Factory extends QuantityFactoryLike> = ReturnType<Factory['fromJSValue']>

/** Tag a value with the declaration-owned factory that is allowed to authenticate its backing. */
export function quantityOperand<const Factory extends QuantityFactoryLike>(
  factory: Factory,
  value: TaoEvaluable<unknown>,
): QuantityOperand<Factory> {
  return Object.freeze({ kind: 'quantity', factory, value })
}

/** Tag an ordinary finite number (or a Tao value that evaluates to one) as an arithmetic scalar. */
export function scalarOperand(value: number | TaoEvaluable<number>): ScalarOperand {
  return Object.freeze({ kind: 'scalar', value })
}

function evaluateQuantity(operand: QuantityOperand): QuantitySnapshot {
  const factory = operand.factory as RuntimeQuantityFactory
  const payload: unknown = operand.value.evaluate().jsValue
  if (!isQuantityPayload(payload)) {
    // Let the supplied factory retain ownership of shape and domain diagnostics.
    factory.read({ evaluate: () => ({ jsValue: payload }) })
  }
  if (!factory.acceptsPayload(payload)) {
    // This produces the existing DomainMismatch failure for a real foreign quantity payload.
    factory.read({ evaluate: () => ({ jsValue: payload }) })
  }
  const snapshot = factory.read({ evaluate: () => ({ jsValue: payload }) })
  return Object.freeze({ ...snapshot, factory, payload })
}

function evaluateScalar(operand: ScalarOperand): OperandSnapshot {
  let canonical: unknown = operand.value
  if (typeof operand.value !== 'number') {
    const input: unknown = operand.value
    if ((typeof input !== 'object' || input === null) && typeof input !== 'function') {
      throw new TaoActionFailure(QuantityFailureCases.BadShape, 'A numeric scalar is required for quantity arithmetic.')
    }
    const evaluate = (input as { evaluate?: unknown }).evaluate
    if (typeof evaluate !== 'function') {
      throw new TaoActionFailure(QuantityFailureCases.BadShape, 'A numeric scalar is required for quantity arithmetic.')
    }
    const snapshot: unknown = evaluate.call(input)
    if ((typeof snapshot !== 'object' || snapshot === null) && typeof snapshot !== 'function') {
      throw new TaoActionFailure(QuantityFailureCases.BadShape, 'A numeric scalar is required for quantity arithmetic.')
    }
    canonical = (snapshot as { jsValue: unknown }).jsValue
  }
  if (typeof canonical !== 'number') {
    throw new TaoActionFailure(QuantityFailureCases.BadShape, 'A numeric scalar is required for quantity arithmetic.')
  }
  if (!Number.isFinite(canonical)) {
    throw new TaoActionFailure(QuantityFailureCases.NonFinite, 'Quantity arithmetic needs finite numeric operands.')
  }
  return Object.freeze({ canonical })
}

function evaluateOperand(operand: TaoQuantityArithmeticOperand): OperandSnapshot {
  return operand.kind === 'quantity' ? evaluateQuantity(operand) : evaluateScalar(operand)
}

function outputUnit<Result extends QuantityFactoryLike>(
  left: OperandSnapshot,
  right: OperandSnapshot | undefined,
  resultFactory: Result,
  explicitUnit: UnitOf<Result> | undefined,
): UnitOf<Result> {
  if (explicitUnit !== undefined) {
    return explicitUnit
  }
  if ('factory' in left && resultFactoryAccepts(resultFactory, left)) {
    return left.unit as UnitOf<Result>
  }
  if (right && 'factory' in right && resultFactoryAccepts(resultFactory, right)) {
    return right.unit as UnitOf<Result>
  }
  return resultFactory.definition.defaultUnit as UnitOf<Result>
}

function resultFactoryAccepts<Result extends QuantityFactoryLike>(
  resultFactory: Result,
  candidate: QuantitySnapshot,
): boolean {
  return (resultFactory as RuntimeQuantityFactory).acceptsPayload(candidate.payload)
}

function result(
  resultFactory: QuantityFactoryLike,
  canonical: number,
  unit: string,
): TaoEvaluable<unknown> {
  // fromJSValue checks finite canonical data and the declared result invariant exactly once.
  const canonicalValue = resultFactory.fromJSValue(canonical)
  // inUnit validates the result-domain unit and changes only its retained view.
  return (resultFactory as RuntimeQuantityFactory).inUnit(canonicalValue, unit)
}

function makeResult<Factory extends QuantityFactoryLike>(
  resultFactory: Factory,
  canonical: number,
  unit: UnitOf<Factory>,
): ResultOf<Factory> {
  return result(resultFactory, canonical, unit) as ResultOf<Factory>
}

function applyBinary<Factory extends QuantityFactoryLike>(
  resultFactory: Factory,
  left: TaoQuantityArithmeticOperand,
  right: TaoQuantityArithmeticOperand,
  explicitUnit: UnitOf<Factory> | undefined,
  operation: (left: number, right: number) => number,
): ResultOf<Factory> {
  const first = evaluateOperand(left)
  const second = evaluateOperand(right)
  const canonical = operation(first.canonical, second.canonical)
  const unit = outputUnit(first, second, resultFactory, explicitUnit)
  return makeResult(resultFactory, canonical, unit)
}

function compareRead<Factory extends QuantityFactoryLike>(
  factory: Factory,
  value: TaoEvaluable<unknown>,
): Readonly<{ canonical: number }> {
  const snapshot: unknown = value.evaluate().jsValue
  const runtimeFactory = factory as RuntimeQuantityFactory
  if (isQuantityPayload(snapshot) && !runtimeFactory.acceptsPayload(snapshot)) {
    runtimeFactory.read({ evaluate: () => ({ jsValue: snapshot }) })
  }
  return runtimeFactory.read({ evaluate: () => ({ jsValue: snapshot }) })
}

/** Authored quantity operations. Storage ownership alone never installs an operator. */
export const QuantityArithmetic = Object.freeze({
  add<Factory extends QuantityFactoryLike>(
    factory: Factory,
    left: TaoQuantityArithmeticOperand,
    right: TaoQuantityArithmeticOperand,
    unit?: UnitOf<Factory>,
  ): ResultOf<Factory> {
    return applyBinary(factory, left, right, unit, (first, second) => first + second)
  },
  subtract<Factory extends QuantityFactoryLike>(
    factory: Factory,
    left: TaoQuantityArithmeticOperand,
    right: TaoQuantityArithmeticOperand,
    unit?: UnitOf<Factory>,
  ): ResultOf<Factory> {
    return applyBinary(factory, left, right, unit, (first, second) => first - second)
  },
  multiply<Factory extends QuantityFactoryLike>(
    factory: Factory,
    left: TaoQuantityArithmeticOperand,
    right: TaoQuantityArithmeticOperand,
    unit?: UnitOf<Factory>,
  ): ResultOf<Factory> {
    return applyBinary(factory, left, right, unit, (first, second) => first * second)
  },
  divide<Factory extends QuantityFactoryLike>(
    factory: Factory,
    left: TaoQuantityArithmeticOperand,
    right: TaoQuantityArithmeticOperand,
    unit?: UnitOf<Factory>,
  ): ResultOf<Factory> {
    return applyBinary(factory, left, right, unit, (first, second) => first / second)
  },
  negate<Factory extends QuantityFactoryLike>(
    factory: Factory,
    value: TaoQuantityArithmeticOperand,
    unit?: UnitOf<Factory>,
  ): ResultOf<Factory> {
    const operand = evaluateOperand(value)
    const selectedUnit = outputUnit(operand, undefined, factory, unit)
    return makeResult(factory, -operand.canonical, selectedUnit)
  },
  compare<Factory extends QuantityFactoryLike>(
    factory: Factory,
    left: TaoEvaluable<unknown>,
    right: TaoEvaluable<unknown>,
  ): -1 | 0 | 1 {
    const first = compareRead(factory, left)
    const second = compareRead(factory, right)
    return first.canonical < second.canonical ? -1 : first.canonical > second.canonical ? 1 : 0
  },
})
