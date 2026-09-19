import { UnexpectedBehaviorError } from './TR-errors'

type RuntimeSwitchKey = string | number | symbol
type KindItem = { kind: RuntimeSwitchKey }
type TypeItem = { type: RuntimeSwitchKey }

type RuntimeSwitchHandlers<ValueT extends RuntimeSwitchKey, ResultT> = {
  [KeyT in ValueT]: (value: KeyT) => ResultT
}

type KindHandlers<ItemT extends KindItem, ResultT> = {
  [KeyT in ItemT['kind']]: (item: Extract<ItemT, { kind: KeyT }>) => ResultT
}

type TypeHandlers<ItemT extends TypeItem, ResultT> = {
  [KeyT in ItemT['type']]: (item: Extract<ItemT, { type: KeyT }>) => ResultT
}

/**
 * RuntimeSwitch mirrors `Switch` in `packages/shared/shared-src/core/Switch_TypeSafe.ts` for the
 * runtime, which ships to the device and imports nothing from Tao's toolchain shared package. It is
 * a value-only subset of that original, plus a precompiled-table entry point and a `type` form the
 * original spells `$type` because its unions are Langium AST nodes and these are wire messages.
 */
export default Object.assign(RuntimeSwitch, {
  kind: RuntimeSwitchKind,
  type: RuntimeSwitchType,
})

/** RuntimeSwitch dispatches exhaustively on a literal value. */
function RuntimeSwitch<ValueT extends RuntimeSwitchKey, ResultT>(
  input: ValueT,
  handlers: RuntimeSwitchHandlers<ValueT, ResultT>,
): ResultT {
  const handler = runtimeSwitchHandler(input, handlers as Readonly<Record<ValueT, unknown>>)
  return (handler as (value: ValueT) => ResultT)(input)
}

/** RuntimeSwitchKind dispatches exhaustively on a `kind` discriminator. */
function RuntimeSwitchKind<ItemT extends KindItem, ResultT>(
  item: ItemT,
  handlers: KindHandlers<ItemT, ResultT>,
): ResultT {
  const handler = runtimeSwitchHandler(item.kind, handlers as Readonly<Record<RuntimeSwitchKey, unknown>>)
  return (handler as (item: ItemT) => ResultT)(item)
}

/** RuntimeSwitchType dispatches exhaustively on a wire message's `type` discriminator. */
function RuntimeSwitchType<ItemT extends TypeItem, ResultT>(
  item: ItemT,
  handlers: TypeHandlers<ItemT, ResultT>,
): ResultT {
  const handler = runtimeSwitchHandler(item.type, handlers as Readonly<Record<RuntimeSwitchKey, unknown>>)
  return (handler as (item: ItemT) => ResultT)(item)
}

/** runtimeSwitchHandler returns the handler a precompiled table declares for `input`, so hot paths
 * can dispatch through one shared table without a per-call handler object. */
export function runtimeSwitchHandler<ValueT extends RuntimeSwitchKey, HandlerT>(
  input: ValueT,
  handlers: Readonly<Record<ValueT, HandlerT>>,
): HandlerT {
  // Own keys only: a wire value such as `constructor` must not resolve to an inherited member.
  const handler = Object.hasOwn(handlers, input) ? handlers[input] : undefined
  if (!handler) {
    throw new UnexpectedBehaviorError(`Unhandled runtime switch value: ${String(input)}`)
  }
  return handler
}
