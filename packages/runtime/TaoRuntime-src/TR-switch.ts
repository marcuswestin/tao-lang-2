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
  const handler = handlers[input]
  if (!handler) {
    throw new UnexpectedBehaviorError(`Unhandled runtime switch value: ${String(input)}`)
  }
  return (handler as (value: ValueT) => ResultT)(input)
}
