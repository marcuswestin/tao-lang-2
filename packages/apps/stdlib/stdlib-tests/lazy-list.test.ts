import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import { TaoActionFailure, UnexpectedBehaviorError } from '../../runtime/TaoRuntime-src/TR-errors'
import { KeyedList } from '../@tao/ui/LazyList'

const failure = TR.Enum(
  TR.Navigation.Identity(['tao.declaration', 1, 'tests', '@workspace', 'LazyList', 'enum', 'ListFailure']),
  ['DuplicateKey'],
)['DuplicateKey']!

function keyed(value: TR.Evaluable): TR.Capability {
  return TR.Capability.attach(value, {
    Key: TR.Function((receiver: TR.Evaluable) => {
      Expect(receiver === value).toBe(true)
      return TR.Value((receiver.evaluate().jsValue as { Key: string }).Key)
    }),
  })
}

Describe('stdlib: LazyList native adapter', () => {
  Test('retains item carriers, stable keys, one-based occurrence values and the opaque renderer', () => {
    const first = keyed(TR.Value({ Key: 'a', Title: 'first' }))
    const second = keyed(TR.Value({ Key: 'b', Title: 'second' }))
    let bodyCalls = 0
    const renderer = TR.RenderSlots.create(() => {
      bodyCalls++
      return null
    }, {})
    const list = KeyedList({
      Items: [first, second],
      DuplicateKey: failure.jsValue,
      Slots: { '@item': renderer },
      Tag: 'rows',
    })
    const props = list.props as {
      props: {
        rows: { key: string; args: { Item: TR.Capability; Occurrence: TR.Value<{ Ordinal: number }> } }[]
        renderer: unknown
        tag: string
      }
    }
    Expect(props.props.rows.map(row => row.key)).toEqual(['a', 'b'])
    Expect(props.props.rows[0]!.args.Item === first).toBe(true)
    Expect(props.props.rows[1]!.args.Item === second).toBe(true)
    Expect(props.props.rows.map(row => row.args.Occurrence.getJSValue())).toEqual([{ Ordinal: 1 }, { Ordinal: 2 }])
    Expect(props.props.renderer === renderer).toBe(true)
    Expect(props.props.tag).toBe('rows')
    Expect(bodyCalls).toBe(0)

    const reordered = KeyedList({ Items: [second, first], DuplicateKey: failure.jsValue, Slots: { '@item': renderer } })
    const reorderedRows = (reordered.props as typeof props).props.rows
    Expect(reorderedRows.map(row => row.key)).toEqual(['b', 'a'])
    Expect(reorderedRows[0]!.args.Item === second).toBe(true)
    Expect(reorderedRows.map(row => row.args.Occurrence.getJSValue())).toEqual([{ Ordinal: 1 }, { Ordinal: 2 }])
  })

  Test('rejects duplicate keys with the supplied declared failure before mounting rows', () => {
    const first = keyed(TR.Value({ Key: 'same', Title: 'first' }))
    const second = keyed(TR.Value({ Key: 'same', Title: 'second' }))
    let error: unknown
    try {
      KeyedList({ Items: [first, second], DuplicateKey: failure.jsValue })
    } catch (caught) {
      error = caught
    }
    Expect(error instanceof TaoActionFailure).toBe(true)
    const modeled = error as TaoActionFailure
    Expect(modeled.caseName).toBe('DuplicateKey')
    Expect(modeled.declaredSentence).toBe('LazyList requires a unique key for each displayed occurrence.')
  })

  Test('samples current keys while retaining the live item receiver', () => {
    const source = TR.Cell(TR.Value({ Key: 'before', Title: 'first' }))
    const Item = keyed(source)
    const before = KeyedList({ Items: [Item], DuplicateKey: failure.jsValue })
    const row = (before.props as { props: { rows: { key: string; args: { Item: TR.Capability } }[] } }).props.rows[0]!
    source.set(TR.Value({ Key: 'after', Title: 'changed' }))
    Expect(row.args.Item.getJSValue()).toEqual({ Key: 'after', Title: 'changed' })
    const after = KeyedList({ Items: [Item], DuplicateKey: failure.jsValue })
    const nextRow = (after.props as { props: { rows: typeof row[] } }).props.rows[0]!
    Expect(row.key).toBe('before')
    Expect(nextRow.key).toBe('after')
    Expect(nextRow.args.Item === Item).toBe(true)
  })

  Test('requires an authenticated Key witness rather than a reflected payload method', () => {
    const impostor = TR.Value({ Key: () => 'invented' }) as unknown as TR.Capability
    Expect(() => KeyedList({ Items: [impostor], DuplicateKey: failure.jsValue })).toThrow(UnexpectedBehaviorError)
  })

  Test('preserves an explicitly empty item supply', () => {
    const list = KeyedList({ Items: [], DuplicateKey: failure.jsValue, Slots: { '@item': null } })
    Expect((list.props as { props: { rows: unknown[]; renderer: unknown } }).props).toEqual(
      Expect['objectContaining']({ rows: [], renderer: null }),
    )
  })
})
