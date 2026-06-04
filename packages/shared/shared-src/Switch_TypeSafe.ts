import { UnexpectedBehaviorError } from './Errors'

type SwitchKey = string | number | symbol
type SwitchValue = SwitchKey | undefined

type ValueHandlers<ValueT extends SwitchValue, ResultT> =
  & { [KeyT in Exclude<ValueT, undefined> & SwitchKey]: (value: KeyT) => ResultT }
  & (undefined extends ValueT ? { undefined: (value: undefined) => ResultT } : {})

type TypeHandlers<ItemT extends { $type: SwitchKey }, ResultT> = {
  [KeyT in ItemT['$type']]: (item: Extract<ItemT, { $type: KeyT }>) => ResultT
}

type PropertyValue<ItemT, PropertyT extends keyof ItemT> = ItemT[PropertyT]

type PropertyHandlers<ItemT, PropertyT extends keyof ItemT, ResultT> = PropertyValue<ItemT, PropertyT> extends
  infer ValueT ?
    & { [KeyT in Exclude<ValueT, undefined> & SwitchKey]: (value: KeyT) => ResultT }
    & (undefined extends ValueT ? { undefined: (value: undefined) => ResultT } : {})
  : never

/** value dispatches exhaustively on a literal value. */
export function value<ValueT extends SwitchValue, ResultT>(
  input: ValueT,
  handlers: ValueHandlers<ValueT, ResultT>,
): ResultT {
  const key = input === undefined ? 'undefined' : input
  const handler = handlers[key as keyof ValueHandlers<ValueT, ResultT>]

  if (!handler) {
    throw new UnexpectedBehaviorError(`Unhandled switch value: ${String(input)}`)
  }
  return (handler as (value: ValueT) => ResultT)(input)
}

/** type dispatches exhaustively on an AST-style `$type` discriminator. */
export function type<ItemT extends { $type: SwitchKey }, ResultT>(
  item: ItemT,
  handlers: TypeHandlers<ItemT, ResultT>,
): ResultT {
  const key = item.$type as ItemT['$type']
  const handler = handlers[key]

  if (!handler) {
    throw new UnexpectedBehaviorError(`Unhandled item type: ${String(key)}`)
  }
  return (handler as (item: ItemT) => ResultT)(item)
}

/** property dispatches exhaustively on one property value. */
export function property<ItemT extends object, PropertyT extends keyof ItemT, ResultT>(
  item: ItemT,
  propertyName: PropertyT,
  handlers: PropertyHandlers<ItemT, PropertyT, ResultT>,
): ResultT {
  const propertyValue = item[propertyName]
  const key = propertyValue === undefined ? 'undefined' : propertyValue
  const handler = handlers[key as keyof PropertyHandlers<ItemT, PropertyT, ResultT>]

  if (!handler) {
    throw new UnexpectedBehaviorError(`Unhandled property value: ${String(propertyValue)}`)
  }
  return (handler as (value: PropertyValue<ItemT, PropertyT>) => ResultT)(propertyValue)
}
