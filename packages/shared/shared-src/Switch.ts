import { UnexpectedBehaviorError } from './Errors'

type ValueHandlers<ValueT extends PropertyKey, ResultT> = {
  [KeyT in ValueT]: (value: KeyT) => ResultT
}

type TypeHandlers<ItemT extends { $type: PropertyKey }, ResultT> = {
  [KeyT in ItemT['$type']]: (item: Extract<ItemT, { $type: KeyT }>) => ResultT
}

type PropertyValue<ItemT, PropertyT extends keyof ItemT> = ItemT[PropertyT]

type PropertyHandlers<ItemT, PropertyT extends keyof ItemT, ResultT> = PropertyValue<ItemT, PropertyT> extends
  infer ValueT ?
    & { [KeyT in Exclude<ValueT, undefined> & PropertyKey]: (value: KeyT) => ResultT }
    & (undefined extends ValueT ? { undefined: (value: undefined) => ResultT } : {})
  : never

export function value<ValueT extends PropertyKey, ResultT>(
  input: ValueT,
  handlers: ValueHandlers<ValueT, ResultT>,
): ResultT {
  const handler = handlers[input]

  if (!handler) {
    throw new UnexpectedBehaviorError(`Unhandled switch value: ${String(input)}`)
  }
  return handler(input)
}

export function type<ItemT extends { $type: PropertyKey }, ResultT>(
  item: ItemT,
  handlers: TypeHandlers<ItemT, ResultT>,
): ResultT {
  const key = item.$type as ItemT['$type']
  const handler = handlers[key]

  if (!handler) {
    throw new UnexpectedBehaviorError(`Unhandled item type: ${String(key)}`)
  }
  return handler(item as Extract<ItemT, { $type: typeof key }>)
}

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

const Switch = {
  value,
  type,
  property,
}

export default Switch
