import TR from '@runtime/TR'
import type React from 'react'

type ItemArguments = Readonly<{
  Item: TR.Capability
  Occurrence: TR.Value<Readonly<{ Ordinal: number }>>
}>

type ListProps = Readonly<{
  Items: readonly TR.Capability[]
  DuplicateKey: TR.EnumCaseIdentity
  Slots?: Readonly<{ '@item'?: TR.SlotRenderer<ItemArguments> | null }>
  Layout?: TR.TaoVisualLayout
  Tag?: string
}>

/** KeyedList samples the admitted key witness and preserves each authenticated item carrier. */
export function KeyedList({ Items, DuplicateKey, Slots, Layout, Tag }: ListProps): React.ReactElement {
  const keys = new Set<string>()
  const rows = Items.map((Item, index) => {
    const key = TR.Call<string>(TR.Capability.method(Item, 'Key')).getJSValue()
    if (typeof key !== 'string') {
      TR.Errors.failInvariant('Expected the admitted Key witness to return its declared text domain.')
    }
    if (keys.has(key)) {
      TR.Fail(TR.Value(DuplicateKey), 'LazyList requires a unique key for each displayed occurrence.')
    }
    keys.add(key)
    return { key, args: { Item, Occurrence: TR.Value({ Ordinal: index + 1 }) } }
  })
  return TR.Views.LazyList({
    rows,
    renderer: TR.RenderSlots.select(Slots, '@item'),
    layout: Layout,
    tag: Tag,
  })
}
