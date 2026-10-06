import TR from '@runtime/TR'
import { InteractionScrollContext, type Measurable } from '@runtime/TR-interaction-scroll'
import * as TaoReactNative from '@runtime/TR-react-native'
import { createSlotRenderer, type RenderSlotBodyProps } from '@runtime/TR-render-slots'
import { Describe, Expect, Test, testOverrideSlot } from '@shared/test'
import { act, cleanup, fireEventAsync, render } from '@testing-library/react-native'
import React, { useContext, useState } from 'react'
import * as RN from 'react-native'

type Args = { label: string; token: object }
type Row = Readonly<{ key: string; args: Args; taoProps?: TR.TaoProps }>
type ScrollEvent = { nativeEvent?: { contentOffset?: { x?: number; y?: number } } }
type MeasuredNativeHandle = Measurable & {
  scrollTo?(offset: { animated: boolean; x: number; y: number }): void
}
type FlatListHandle = {
  getNativeScrollRef(): Measurable
  scrollToOffset(options: { animated: boolean; offset: number }): void
}
type FlatListProps = {
  accessibilityLabel?: string
  contentContainerStyle?: unknown
  data: readonly Row[]
  horizontal?: boolean
  keyExtractor(item: Row, index: number): string
  onScroll?: (event: ScrollEvent) => void
  renderItem(info: { item: Row; index: number }): React.ReactNode
  scrollEventThrottle?: number
  style?: RN.StyleProp<RN.ViewStyle>
  testID?: string
}
type ScrollViewProps = {
  accessibilityLabel?: string
  children?: React.ReactNode
  onScroll?: (event: ScrollEvent) => void
  style?: RN.StyleProp<RN.ViewStyle>
  testID?: string
}

const nativeRuntimeSlot = testOverrideSlot({
  read: () => TaoReactNative.requireReactNativeRuntime,
  write: value =>
    Object.defineProperty(TaoReactNative, 'requireReactNativeRuntime', { configurable: true, value, writable: true }),
})

Describe('native LazyList host', () => {
  Test('keeps keyed row state and identity while forwarding layout and revealing nested mounted rows', async () => {
    const runtime = TaoReactNative.requireReactNativeRuntime()
    const pendingListMeasurements: Array<(x: number, y: number, width: number, height: number) => void> = []
    const listMeasure = jest.fn((receive: (x: number, y: number, width: number, height: number) => void) => {
      pendingListMeasurements.push(receive)
    })
    const outerMeasure = jest.fn((receive: (x: number, y: number, width: number, height: number) => void) =>
      receive(0, 0, 200, 80)
    )
    const listScrolls: number[] = []
    const outerScrolls: unknown[] = []
    const listNativeScrollView: Measurable = { measureInWindow: listMeasure }
    const getNativeScrollRef = jest.fn(() => listNativeScrollView)
    let renderedFlatListProps: FlatListProps | undefined
    let outerScrollHandler: ScrollViewProps['onScroll']

    const MeasuredFlatList = React.forwardRef<FlatListHandle, FlatListProps>((props, ref) => {
      renderedFlatListProps = props
      React.useImperativeHandle(ref, () => ({
        getNativeScrollRef,
        scrollToOffset: options => listScrolls.push(options.offset),
      }))
      return React.createElement(
        RN.View,
        { accessibilityLabel: props.accessibilityLabel, style: props.style, testID: props.testID },
        ...props.data.map((item, index) =>
          React.createElement(
            React.Fragment,
            { key: props.keyExtractor(item, index) },
            props.renderItem({ item, index }),
          )
        ),
      )
    })
    const MeasuredScrollView = React.forwardRef<MeasuredNativeHandle, ScrollViewProps>((props, ref) => {
      outerScrollHandler = props.onScroll
      React.useImperativeHandle(ref, () => ({
        measureInWindow: outerMeasure,
        scrollTo: offset => outerScrolls.push(offset),
      }))
      return React.createElement(
        RN.View,
        { accessibilityLabel: props.accessibilityLabel, style: props.style, testID: props.testID },
        props.children,
      )
    })
    const restore = nativeRuntimeSlot.install(() => ({
      ActivityIndicator: runtime.ActivityIndicator,
      FlatList: MeasuredFlatList,
      Image: runtime.Image,
      KeyboardAvoidingView: runtime.KeyboardAvoidingView,
      Platform: runtime.Platform,
      Pressable: runtime.Pressable,
      ScrollView: MeasuredScrollView,
      Switch: runtime.Switch,
      Text: runtime.Text,
      TextInput: runtime.TextInput,
      View: runtime.View,
    }))
    const observed = new Map<string, RenderSlotBodyProps<Args, undefined>>()
    const listOnScroll = jest.fn()
    let revealMounted: ((target: Measurable | null) => void) | undefined
    function RowBody(body: RenderSlotBodyProps<Args, undefined>): React.ReactElement {
      const [count, setCount] = useState(0)
      revealMounted = useContext(InteractionScrollContext)
      const identity = body.taoProps?.testTag ?? body.args.label
      observed.set(identity, body)
      return React.createElement(RN.Pressable, {
        onPress: () => setCount(value => value + 1),
        testID: identity,
      }, React.createElement(RN.Text, null, `${body.args.label}:${count}`))
    }
    const first: Row[] = [
      { key: 'row:a', args: { label: 'A', token: {} }, taoProps: { testTag: 'row-a' } },
      { key: 'row:b', args: { label: 'B', token: {} }, taoProps: { testTag: 'row-b' } },
    ]
    const renderer = createSlotRenderer(RowBody, undefined)
    const list = (rows: readonly Row[]) =>
      TR.Views.LazyList<Args>(
        { renderer, rows },
        {
          layout: TR.Layout.create([['gap', 9], ['pad', 5], ['height', 120]]),
          nativeProps: { accessibilityLabel: 'Saved items', horizontal: true, onScroll: listOnScroll },
          testTag: 'saved-items',
        },
      )

    try {
      const screen = render(TR.Views.ScrollView(
        { children: list(first) },
        { nativeProps: { testID: 'outer-scroll' } },
      ))
      await fireEventAsync.press(screen.getByTestId('row-b'))
      await fireEventAsync.press(screen.getByTestId('row-b'))
      const reordered = [...first].reverse()
      screen.rerender(TR.Views.ScrollView(
        { children: list(reordered) },
        { nativeProps: { testID: 'outer-scroll' } },
      ))

      Expect(screen.getByText('B:2')).toBeDefined()
      Expect(screen.getByText('A:0')).toBeDefined()
      Expect(observed.get('row-a')?.args).toBe(reordered[1]?.args)
      Expect(observed.get('row-a')?.taoProps).toBe(reordered[1]?.taoProps)
      Expect(observed.get('row-b')?.args).toBe(reordered[0]?.args)
      Expect(observed.get('row-b')?.taoProps).toBe(reordered[0]?.taoProps)

      const listHost = screen.getByTestId('saved-items')
      Expect(listHost.props['accessibilityLabel']).toBe('Saved items')
      Expect(renderedFlatListProps?.data).toBe(reordered)
      Expect(renderedFlatListProps?.horizontal).toBe(false)
      Expect(renderedFlatListProps?.keyExtractor(reordered[0]!, 0)).toBe('row:b')
      Expect(renderedFlatListProps?.contentContainerStyle).toEqual([
        { flexGrow: 1 },
        { flexDirection: 'column', gap: 9, padding: 5 },
        undefined,
      ])
      Expect(renderedFlatListProps?.style).toEqual([{ alignSelf: 'stretch' }, { height: 120 }])
      Expect(renderedFlatListProps?.scrollEventThrottle).toBe(16)

      const listEvent = { nativeEvent: { contentOffset: { x: 3, y: 40 } } }
      act(() => renderedFlatListProps?.onScroll?.(listEvent))
      Expect(listOnScroll).toHaveBeenCalledWith(listEvent)
      act(() => outerScrollHandler?.({ nativeEvent: { contentOffset: { x: 0, y: 7 } } }))
      act(() => revealMounted?.({ measureInWindow: receive => receive(0, 180, 10, 10) }))
      Expect(getNativeScrollRef).toHaveBeenCalled()
      Expect(listMeasure).toHaveBeenCalled()
      act(() => pendingListMeasurements.shift()?.(0, 50, 100, 50))
      Expect(listScrolls).toEqual([130])
      Expect(outerMeasure).toHaveBeenCalled()
      act(() => pendingListMeasurements.shift()?.(0, 50, 100, 50))
      Expect(outerScrolls).toEqual([{ animated: false, x: 0, y: 27 }])
      const removedRowMeasure = jest.fn((receive: (x: number, y: number, width: number, height: number) => void) =>
        receive(0, 180, 10, 10)
      )
      act(() => revealMounted?.({ measureInWindow: removedRowMeasure }))
      Expect(pendingListMeasurements).toHaveLength(1)
      screen.unmount()
      act(() => pendingListMeasurements.shift()?.(0, 50, 100, 50))
      Expect(removedRowMeasure).not.toHaveBeenCalled()
      Expect(listScrolls).toEqual([130])
      Expect(outerScrolls).toEqual([{ animated: false, x: 0, y: 27 }])
    } finally {
      cleanup()
      restore()
    }
  })
})
