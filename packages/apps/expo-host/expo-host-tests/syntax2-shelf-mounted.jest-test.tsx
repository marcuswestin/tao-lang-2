import TR from '@runtime/TR'
import * as TaoReactNative from '@runtime/TR-react-native'
import { Describe, Expect, Test, testOverrideSlot } from '@shared/test'
import { cleanup } from '@testing-library/react-native'
import React from 'react'
import * as RN from 'react-native'
import { registerRuntimeE2ELifecycle, testCompileApp } from './test-compile-app'

type ItemArguments = Readonly<{
  Item: TR.Capability
  Occurrence: TR.Value<Readonly<{ Ordinal: number }>>
}>
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

registerRuntimeE2ELifecycle()

Describe('Syntax2 Shelf mounted source', () => {
  Test('renders a named @item RowView with Entry and Occurrence inputs', async () => {
    await mountShelf('', '@item: RowView')
  })

  Test('renders an inline @item body with explicit row and occurrence inputs', async () => {
    await mountShelf('', '@item Item, Position -> Text("{Item.ToText()}:{Position.Ordinal}")')
  })

  Test('forwards an ordinary Shelf default @item into the public LazyList', async () => {
    await mountShelf('@item(Item Entry, Occurrence): RowView', '@item: @item')
  })
})

async function mountShelf(shelfSlot: string, lazyListSlot: string): Promise<void> {
  const runtime = TaoReactNative.requireReactNativeRuntime()
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
    await testCompileApp(
      `
        use LazyList, Occurrence, RenderKey, Text from @tao/ui

        type Entry is text with {
          func Key() fails never -> RenderKey { return RenderKey "{Entry}" }
          func ToText() fails never -> text { return Entry }
          view Render() { render "{Entry}" }
        }

        view RowView(Item Entry, Occurrence) {
          render "{Item.ToText()}:{Occurrence.Ordinal}"
        }

        view Shelf() {
          ${shelfSlot}
          state Entries = [Entry "Ada", Entry "Grace"]
          render LazyList(Entries) {
            ${lazyListSlot}
          }
        }

        app ShelfMountApp {
          id "syntax2-shelf-mounted"
          version "1.0.0"
          name "Shelf mounted source"
          view Shelf
        }
      `,
      screen => {
        Expect(screen.getByText('Ada:1')).toBeDefined()
        Expect(screen.getByText('Grace:2')).toBeDefined()
      },
    )
  } finally {
    cleanup()
    restore()
  }
}
