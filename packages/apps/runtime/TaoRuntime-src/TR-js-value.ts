import type { TaoEvaluable } from './TR-action-values'
import { quantityPayloadJSValue, type TaoQuantityPayload } from './TR-quantity-values'

/** TaoJSValue exposes checked quantity backing and otherwise retains the JavaScript payload type. */
export type TaoJSValue<ValueT> = ValueT extends TaoQuantityPayload<string, string> ? number : ValueT

/** getJSValue performs one current read, without flattening structures or copying live handles. */
export function getJSValue<ValueT>(value: TaoEvaluable<ValueT>): TaoJSValue<ValueT> {
  const payload = value.evaluate().jsValue
  return (quantityPayloadJSValue(payload) ?? payload) as TaoJSValue<ValueT>
}
