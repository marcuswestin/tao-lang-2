import type { TaoEvaluable } from './TR-action-values'
import { RuntimeAssert } from './TR-assert'
import { TaoActionFailure } from './TR-errors'
import { isQuantityPayload, QuantityFailureCases } from './TR-quantity-values'
import { completeRuntimeValue, type TaoRuntimeValue } from './TR-reactive-values'

/** Explicitly categorize a legacy wrapper at a native union whose ordinary data can look identical. */
export function nativeQuantityResult<ValueT>(input: TaoEvaluable<ValueT>): TaoRuntimeValue<ValueT> {
  return completeRuntimeValue(input)
}

type QuantityAdmissionFactory = Readonly<{
  ownsPayload(payload: unknown): boolean
  read(value: TaoEvaluable<unknown>): unknown
}>

/** Admit an unknown native quantity against exact supplied owners, preserving its original wrapper. */
export function admitQuantityUnion(
  input: unknown,
  factories: readonly QuantityAdmissionFactory[],
  domain: string,
): void {
  RuntimeAssert(factories.length > 0, 'quantity admission has declared canonical owner factories')
  const badShape: () => never = () => {
    throw new TaoActionFailure(QuantityFailureCases.BadShape, `A checked '${domain}' quantity value is required.`)
  }
  if (!isObject(input)) {
    badShape()
  }
  const evaluate = input['evaluate']
  if (typeof evaluate !== 'function') {
    badShape()
  }
  const snapshot: unknown = evaluate.call(input)
  if (!isObject(snapshot)) {
    badShape()
  }
  const payload = snapshot['jsValue']
  if (!isQuantityPayload(payload)) {
    badShape()
  }
  const factory = factories.find(candidate => candidate.ownsPayload(payload))
  if (!factory) {
    throw new TaoActionFailure(QuantityFailureCases.DomainMismatch, `The quantity must have the '${domain}' domain.`)
  }
  // Snapshot reads must not reevaluate a native wrapper or reread a mutable payload getter.
  factory.read({ evaluate: () => ({ jsValue: payload }) })
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}
