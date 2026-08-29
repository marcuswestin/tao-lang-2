import { UnexpectedBehaviorError } from './TR-errors'

type RuntimeSwitchKey = string | number | symbol

type RuntimeSwitchHandlers<ValueT extends RuntimeSwitchKey, ResultT> = {
  [KeyT in ValueT]: (value: KeyT) => ResultT
}

/** RuntimeSwitch dispatches exhaustively without importing Tao's toolchain shared package. */
export default function RuntimeSwitch<ValueT extends RuntimeSwitchKey, ResultT>(
  input: ValueT,
  handlers: RuntimeSwitchHandlers<ValueT, ResultT>,
): ResultT {
  const handler = runtimeSwitchHandler(input, handlers as Readonly<Record<ValueT, unknown>>)
  return (handler as (value: ValueT) => ResultT)(input)
}

/** runtimeSwitchHandler returns the handler a precompiled table declares for `input`, so hot paths
 * can dispatch through one shared table without a per-call handler object. */
export function runtimeSwitchHandler<ValueT extends RuntimeSwitchKey, HandlerT>(
  input: ValueT,
  handlers: Readonly<Record<ValueT, HandlerT>>,
): HandlerT {
  const handler = handlers[input]
  if (!handler) {
    throw new UnexpectedBehaviorError(`Unhandled runtime switch value: ${String(input)}`)
  }
  return handler
}
