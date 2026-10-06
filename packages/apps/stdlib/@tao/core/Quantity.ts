import TR from '@runtime/TR'
import { quantityToText } from '@runtime/TR-quantity-values'
import { type Duration, type Ratio, types } from './Quantity.tao'

const duration = (value: Duration) => TR.quantityOperand(types.Duration.Factory, value)
const ratio = (value: Ratio) => TR.quantityOperand(types.Ratio.Factory, value)

export const DurationAdd = (left: Duration, right: Duration): Duration =>
  TR.QuantityArithmetic.add(types.Duration.Factory, duration(left), duration(right))

export const DurationSubtract = (left: Duration, right: Duration): Duration =>
  TR.QuantityArithmetic.subtract(types.Duration.Factory, duration(left), duration(right))

export const DurationNegate = (value: Duration): Duration =>
  TR.QuantityArithmetic.negate(types.Duration.Factory, duration(value))

export const DurationMultiplyNumber = (value: Duration, multiplier: number): Duration =>
  TR.QuantityArithmetic.multiply(
    types.Duration.Factory,
    duration(value),
    TR.scalarOperand(multiplier),
  )

export const NumberMultiplyDuration = (multiplier: number, value: Duration): Duration =>
  TR.QuantityArithmetic.multiply(
    types.Duration.Factory,
    TR.scalarOperand(multiplier),
    duration(value),
  )

export const DurationDivideNumber = (value: Duration, divisor: number): Duration =>
  TR.QuantityArithmetic.divide(
    types.Duration.Factory,
    duration(value),
    TR.scalarOperand(divisor),
  )

export const DurationDivideDuration = (left: Duration, right: Duration): Ratio =>
  TR.QuantityArithmetic.divide(
    types.Ratio.Factory,
    duration(left),
    duration(right),
    'unity',
  )

export const DurationMultiplyRatio = (value: Duration, multiplier: Ratio): Duration =>
  TR.QuantityArithmetic.multiply(types.Duration.Factory, duration(value), ratio(multiplier))

export const DurationDivideRatio = (value: Duration, divisor: Ratio): Duration =>
  TR.QuantityArithmetic.divide(types.Duration.Factory, duration(value), ratio(divisor))

export const RatioAdd = (left: Ratio, right: Ratio): Ratio =>
  TR.QuantityArithmetic.add(types.Ratio.Factory, ratio(left), ratio(right))

export const RatioSubtract = (left: Ratio, right: Ratio): Ratio =>
  TR.QuantityArithmetic.subtract(types.Ratio.Factory, ratio(left), ratio(right))

export const RatioNegate = (value: Ratio): Ratio => TR.QuantityArithmetic.negate(types.Ratio.Factory, ratio(value))

export const RatioMultiply = (left: Ratio, right: Ratio): Ratio =>
  TR.QuantityArithmetic.multiply(types.Ratio.Factory, ratio(left), ratio(right))

export const RatioDivide = (left: Ratio, right: Ratio): Ratio =>
  TR.QuantityArithmetic.divide(types.Ratio.Factory, ratio(left), ratio(right))

export const RatioMultiplyNumber = (value: Ratio, multiplier: number): Ratio =>
  TR.QuantityArithmetic.multiply(
    types.Ratio.Factory,
    ratio(value),
    TR.scalarOperand(multiplier),
  )

export const NumberMultiplyRatio = (multiplier: number, value: Ratio): Ratio =>
  TR.QuantityArithmetic.multiply(
    types.Ratio.Factory,
    TR.scalarOperand(multiplier),
    ratio(value),
  )

export const RatioDivideNumber = (value: Ratio, divisor: number): Ratio =>
  TR.QuantityArithmetic.divide(
    types.Ratio.Factory,
    ratio(value),
    TR.scalarOperand(divisor),
  )

const compareDurations = (left: Duration, right: Duration): -1 | 0 | 1 =>
  TR.QuantityArithmetic.compare(types.Duration.Factory, left, right)

const compareRatios = (left: Ratio, right: Ratio): -1 | 0 | 1 =>
  TR.QuantityArithmetic.compare(types.Ratio.Factory, left, right)

export const DurationEqual = (left: Duration, right: Duration): boolean => compareDurations(left, right) === 0

export const DurationNotEqual = (left: Duration, right: Duration): boolean => compareDurations(left, right) !== 0

export const DurationLess = (left: Duration, right: Duration): boolean => compareDurations(left, right) < 0

export const DurationLessEqual = (left: Duration, right: Duration): boolean => compareDurations(left, right) <= 0

export const DurationGreater = (left: Duration, right: Duration): boolean => compareDurations(left, right) > 0

export const DurationGreaterEqual = (left: Duration, right: Duration): boolean => compareDurations(left, right) >= 0

export const RatioEqual = (left: Ratio, right: Ratio): boolean => compareRatios(left, right) === 0

export const RatioNotEqual = (left: Ratio, right: Ratio): boolean => compareRatios(left, right) !== 0

export const RatioLess = (left: Ratio, right: Ratio): boolean => compareRatios(left, right) < 0

export const RatioLessEqual = (left: Ratio, right: Ratio): boolean => compareRatios(left, right) <= 0

export const RatioGreater = (left: Ratio, right: Ratio): boolean => compareRatios(left, right) > 0

export const RatioGreaterEqual = (left: Ratio, right: Ratio): boolean => compareRatios(left, right) >= 0

type ScalarValue = TR.Value<TR.QuantityPayload>
type ScalarFactory = TR.QuantityFactory
const scalarSnapshot = (value: ScalarValue): ScalarValue => TR.Value(value.evaluate().jsValue)

export const ScalarToText = (value: ScalarValue): string => quantityToText(value)

export const ScalarAdd = (left: ScalarValue, right: ScalarValue, factory: ScalarFactory): ScalarValue => {
  const first = scalarSnapshot(left)
  const second = scalarSnapshot(right)
  return TR.QuantityArithmetic.add(
    factory,
    TR.quantityOperand(factory, first),
    TR.quantityOperand(factory, second),
  )
}

export const ScalarSubtract = (left: ScalarValue, right: ScalarValue, factory: ScalarFactory): ScalarValue => {
  const first = scalarSnapshot(left)
  const second = scalarSnapshot(right)
  return TR.QuantityArithmetic.subtract(
    factory,
    TR.quantityOperand(factory, first),
    TR.quantityOperand(factory, second),
  )
}

export const ScalarNegate = (value: ScalarValue, factory: ScalarFactory): ScalarValue => {
  const snapshot = scalarSnapshot(value)
  return TR.QuantityArithmetic.negate(factory, TR.quantityOperand(factory, snapshot))
}

export const ScalarMultiplyNumber = (
  value: ScalarValue,
  multiplier: number,
  factory: ScalarFactory,
): ScalarValue => {
  const snapshot = scalarSnapshot(value)
  return TR.QuantityArithmetic.multiply(
    factory,
    TR.quantityOperand(factory, snapshot),
    TR.scalarOperand(multiplier),
  )
}

export const NumberMultiplyScalar = (
  multiplier: number,
  value: ScalarValue,
  factory: ScalarFactory,
): ScalarValue => {
  const snapshot = scalarSnapshot(value)
  return TR.QuantityArithmetic.multiply(
    factory,
    TR.scalarOperand(multiplier),
    TR.quantityOperand(factory, snapshot),
  )
}

export const ScalarDivideNumber = (
  value: ScalarValue,
  divisor: number,
  factory: ScalarFactory,
): ScalarValue => {
  const snapshot = scalarSnapshot(value)
  return TR.QuantityArithmetic.divide(
    factory,
    TR.quantityOperand(factory, snapshot),
    TR.scalarOperand(divisor),
  )
}

const compareScalars = (left: ScalarValue, right: ScalarValue, factory: ScalarFactory): -1 | 0 | 1 => {
  const first = scalarSnapshot(left)
  const second = scalarSnapshot(right)
  return TR.QuantityArithmetic.compare(factory, first, second)
}

export const ScalarEqual = (left: ScalarValue, right: ScalarValue, factory: ScalarFactory): boolean =>
  compareScalars(left, right, factory) === 0

export const ScalarNotEqual = (left: ScalarValue, right: ScalarValue, factory: ScalarFactory): boolean =>
  compareScalars(left, right, factory) !== 0

export const ScalarLess = (left: ScalarValue, right: ScalarValue, factory: ScalarFactory): boolean =>
  compareScalars(left, right, factory) < 0

export const ScalarLessEqual = (left: ScalarValue, right: ScalarValue, factory: ScalarFactory): boolean =>
  compareScalars(left, right, factory) <= 0

export const ScalarGreater = (left: ScalarValue, right: ScalarValue, factory: ScalarFactory): boolean =>
  compareScalars(left, right, factory) > 0

export const ScalarGreaterEqual = (
  left: ScalarValue,
  right: ScalarValue,
  factory: ScalarFactory,
): boolean => compareScalars(left, right, factory) >= 0
