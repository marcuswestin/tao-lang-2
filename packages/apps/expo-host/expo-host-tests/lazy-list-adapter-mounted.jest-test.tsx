import TR from '@runtime/TR'
import * as TaoReactNative from '@runtime/TR-react-native'
import { Describe, Expect, Test, testOverrideSlot } from '@shared/test'
import { cleanup, fireEventAsync, render } from '@testing-library/react-native'
import React, { useEffect, useState } from 'react'
import * as RN from 'react-native'
import { KeyedList } from '../../stdlib/@tao/ui/LazyList'

type ItemArguments = Readonly<{
  Item: TR.Capability
  Occurrence: TR.Value<Readonly<{ Ordinal: number }>>
}>
type Environment = Readonly<{ caption: string }>
type FlatListRow = Readonly<{ key: string; args: ItemArguments; taoProps?: TR.TaoProps }>
type FlatListProps = Readonly<{
  data: readonly FlatListRow[]
  keyExtractor(item: FlatListRow, index: number): string
  renderItem(info: { item: FlatListRow; index: number }): React.ReactNode
  testID?: string
}>

const nativeRuntimeSlot = testOverrideSlot({
  read: () => TaoReactNative.requireReactNativeRuntime,
  write: value =>
    Object.defineProperty(TaoReactNative, 'requireReactNativeRuntime', { configurable: true, value, writable: true }),
})

Describe('mounted stdlib LazyList adapter', () => {
  Test(
    'keeps row state by authenticated key and refreshes occurrence values across reorder, removal and reinsertion',
    async () => {
      const runtime = TaoReactNative.requireReactNativeRuntime()
      const lifecycle: string[] = []
      const FlatList = (props: FlatListProps): React.ReactElement =>
        React.createElement(
          RN.View,
          { testID: props.testID },
          ...props.data.map((item, index) =>
            React.createElement(
              React.Fragment,
              { key: props.keyExtractor(item, index) },
              props.renderItem({ item, index }),
            )
          ),
        )
      const restore = nativeRuntimeSlot.install(() => ({
        ActivityIndicator: runtime.ActivityIndicator,
        FlatList,
        Image: runtime.Image,
        KeyboardAvoidingView: runtime.KeyboardAvoidingView,
        Platform: runtime.Platform,
        Pressable: runtime.Pressable,
        ScrollView: runtime.ScrollView,
        Switch: runtime.Switch,
        Text: runtime.Text,
        TextInput: runtime.TextInput,
        View: runtime.View,
      }))

      try {
        const item = (key: string, label: string): TR.Capability => {
          const receiver = TR.Value({ Key: key, Label: label })
          return TR.Capability.attach(receiver, {
            Key: TR.Function((actual: TR.Evaluable) => {
              Expect(actual).toBe(receiver)
              return TR.Value((actual.evaluate().jsValue as { Key: string }).Key)
            }),
          })
        }
        const a = item('a', 'A')
        const b = item('b', 'B')
        const c = item('c', 'C')
        const duplicateKey = TR.Enum(
          TR.Navigation.Identity(['tao.declaration', 1, 'tests', '@workspace', 'LazyList', 'enum', 'ListFailure']),
          ['DuplicateKey'],
        )['DuplicateKey']!
        const observed = new Map<string, ItemArguments>()

        function Body({ args, environment }: { args: ItemArguments; environment: Environment }): React.ReactElement {
          const [count, setCount] = useState(0)
          const payload = args.Item.getJSValue() as { Key: string; Label: string }
          const ordinal = args.Occurrence.getJSValue().Ordinal
          useEffect(() => {
            lifecycle.push(`mounted:${payload.Key}`)
            return () => {
              lifecycle.push(`removed:${payload.Key}`)
            }
          }, [payload.Key])
          observed.set(payload.Key, args)
          return React.createElement(
            RN.View,
            null,
            React.createElement(RN.Text, null, `${payload.Label}:${ordinal}:${environment.caption}:${count}`),
            React.createElement(RN.Pressable, {
              onPress: () => setCount(current => current + 1),
              testID: `increment:${payload.Key}`,
            }),
          )
        }

        const list = (items: readonly TR.Capability[], caption: string) =>
          KeyedList({
            Items: items,
            DuplicateKey: duplicateKey.jsValue,
            Slots: { '@item': TR.RenderSlots.create(Body, { caption }) },
            Tag: 'adapter-mounted-list',
          })

        const screen = render(list([a, b, c], 'initial'))
        await fireEventAsync.press(screen.getByTestId('increment:b'))
        await fireEventAsync.press(screen.getByTestId('increment:b'))

        screen.rerender(list([c, a, b], 'refreshed'))
        Expect(screen.getByText('B:3:refreshed:2')).toBeDefined()
        Expect(screen.getByText('A:2:refreshed:0')).toBeDefined()
        Expect(screen.getByText('C:1:refreshed:0')).toBeDefined()
        Expect(observed.get('b')?.Item).toBe(b)
        Expect(observed.get('a')?.Item).toBe(a)
        Expect(observed.get('c')?.Item).toBe(c)

        screen.rerender(list([c, a], 'removed'))
        Expect(screen.queryByTestId('increment:b')).toBeNull()
        Expect(lifecycle.filter(event => event === 'removed:b')).toHaveLength(1)

        screen.rerender(list([b, c, a], 'reinserted'))
        Expect(screen.getByText('B:1:reinserted:0')).toBeDefined()
        Expect(observed.get('b')?.Item).toBe(b)
        Expect(lifecycle.filter(event => event === 'mounted:b')).toHaveLength(2)
        screen.unmount()
        Expect(lifecycle.filter(event => event.startsWith('removed:'))).toHaveLength(4)
      } finally {
        cleanup()
        restore()
      }
    },
  )
})
