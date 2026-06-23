import { UnexpectedBehaviorError } from './Errors'

type SwitchKey = string | number | symbol
type SwitchValueKey = SwitchKey | undefined
type TypeItem = { $type: SwitchKey }
type KindItem = { kind: SwitchKey }

type ValueHandlers<ValueT extends SwitchValueKey, ResultT> =
  & { [KeyT in Exclude<ValueT, undefined> & SwitchKey]: (value: KeyT) => ResultT }
  & (undefined extends ValueT ? { undefined: (value: undefined) => ResultT } : {})

type TypeHandlers<ItemT extends TypeItem, ResultT> = {
  [KeyT in ItemT['$type']]: (item: Extract<ItemT, { $type: KeyT }>) => ResultT
}

type KindHandlers<ItemT extends KindItem, ResultT> = {
  [KeyT in ItemT['kind']]: (item: Extract<ItemT, { kind: KeyT }>) => ResultT
}

type TypeMaybeHandlers<ItemT extends TypeItem | undefined, ResultT> =
  & TypeHandlers<Exclude<ItemT, undefined>, ResultT>
  & (undefined extends ItemT ? { undefined: (item: undefined) => ResultT } : {})

type KindMaybeHandlers<ItemT extends KindItem | undefined, ResultT> =
  & KindHandlers<Exclude<ItemT, undefined>, ResultT>
  & (undefined extends ItemT ? { undefined: (item: undefined) => ResultT } : {})

type PropertyValue<ItemT, PropertyT extends keyof ItemT> = ItemT[PropertyT]

type PropertyHandlers<ItemT, PropertyT extends keyof ItemT, ResultT> = PropertyValue<ItemT, PropertyT> extends
  infer ValueT ?
    & { [KeyT in Exclude<ValueT, undefined> & SwitchKey]: (value: KeyT) => ResultT }
    & (undefined extends ValueT ? { undefined: (value: undefined) => ResultT } : {})
  : never

export default Object.assign(Switch, {
  kind: SwitchKind,
  kindMaybe: SwitchKindMaybe,
  property: SwitchProperty,
  type: SwitchType,
  typeMaybe: SwitchTypeMaybe,
})

/** Switch dispatches exhaustively on a literal value. */
function Switch<ValueT extends SwitchValueKey, ResultT>(
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

/** SwitchType dispatches exhaustively on an AST-style `$type` discriminator. */
function SwitchType<ItemT extends TypeItem, ResultT>(
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

/** SwitchKind dispatches exhaustively on a `kind` discriminator. */
function SwitchKind<ItemT extends KindItem, ResultT>(
  item: ItemT,
  handlers: KindHandlers<ItemT, ResultT>,
): ResultT {
  const key = item.kind as ItemT['kind']
  const handler = handlers[key]

  if (!handler) {
    throw new UnexpectedBehaviorError(`Unhandled item kind: ${String(key)}`)
  }
  return (handler as (item: ItemT) => ResultT)(item)
}

/** SwitchTypeMaybe dispatches exhaustively on an AST-style `$type` discriminator or undefined. */
function SwitchTypeMaybe<ItemT extends TypeItem | undefined, ResultT>(
  item: ItemT,
  handlers: TypeMaybeHandlers<ItemT, ResultT>,
): ResultT {
  const key = item === undefined ? 'undefined' : item.$type
  const handler = handlers[key as keyof TypeMaybeHandlers<ItemT, ResultT>]

  if (!handler) {
    throw new UnexpectedBehaviorError(`Unhandled item type: ${String(key)}`)
  }
  return (handler as (item: ItemT) => ResultT)(item)
}

/** SwitchKindMaybe dispatches exhaustively on a `kind` discriminator or undefined. */
function SwitchKindMaybe<ItemT extends KindItem | undefined, ResultT>(
  item: ItemT,
  handlers: KindMaybeHandlers<ItemT, ResultT>,
): ResultT {
  const key = item === undefined ? 'undefined' : item.kind
  const handler = handlers[key as keyof KindMaybeHandlers<ItemT, ResultT>]

  if (!handler) {
    throw new UnexpectedBehaviorError(`Unhandled item kind: ${String(key)}`)
  }
  return (handler as (item: ItemT) => ResultT)(item)
}

/** SwitchProperty dispatches exhaustively on one property value. */
function SwitchProperty<ItemT extends object, PropertyT extends keyof ItemT, ResultT>(
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
