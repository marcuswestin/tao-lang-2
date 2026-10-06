import type { TaoEvaluable } from './TR-action-values'
import { RuntimeAssert } from './TR-assert'
import { completeRuntimeValue, reactiveValue, type TaoRuntimeValue } from './TR-reactive-values'
import { readAvailability, withReadAvailability } from './TR-read-availability'

/** Capture an action receiver once, retaining entity authority and live fields. */
export function captureActionReceiver<ValueT>(
  receiver: TaoEvaluable<ValueT>,
  cardinality: 'one' | 'many',
): TaoRuntimeValue<ValueT> {
  const evaluated = completeRuntimeValue(receiver).evaluate()
  if (cardinality === 'one') {
    return evaluated
  }
  const members = evaluated.jsValue
  RuntimeAssert(Array.isArray(members), 'a collection action receiver is an array')
  const captured = reactiveValue([...members] as unknown as ValueT)
  const availability = readAvailability(evaluated)
  return availability ? withReadAvailability(captured, availability) : captured
}
