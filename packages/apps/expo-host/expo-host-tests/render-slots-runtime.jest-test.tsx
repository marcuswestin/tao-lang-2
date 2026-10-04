import TR from '@runtime/TR'
import { createElement } from '@runtime/TR-create-element'
import { createReactiveSource, markReactiveValue } from '@runtime/TR-reactive'
import {
  createSlotRenderer,
  type RenderSlotBodyProps,
  RenderSlotFrame,
  selectRenderSlot,
  type TaoSlotRenderer,
} from '@runtime/TR-render-slots'
import { Describe, Expect, Test } from '@shared/test'
import { act, fireEventAsync, render } from '@testing-library/react-native'
import { type ReactElement, useEffect, useReducer, useRef, useState } from 'react'
import * as RN from 'react-native'
import { registerRuntimeE2ELifecycle } from './test-compile-app'

registerRuntimeE2ELifecycle()

Describe('mounted render slot frames', () => {
  Test(
    'isolates keyed placements and preserves their state across fresh descriptors, captures, arguments and Tao props',
    async () => {
      type Args = { id: string; value: TR.Value<string> }
      type Environment = { capture: string; report(value: string): void }
      const observed = new Map<string, RenderSlotBodyProps<Args, Environment>>()
      const mounted: string[] = []
      const removed: string[] = []
      const firstReports: string[] = []
      const nextReports: string[] = []
      function Body(props: RenderSlotBodyProps<Args, Environment>): ReactElement {
        const { args, environment, taoProps } = props
        const [count, setCount] = useState(0)
        const mountedId = useRef(args.id).current
        useEffect(() => {
          mounted.push(mountedId)
          return () => {
            removed.push(mountedId)
          }
        }, [mountedId])
        observed.set(args.id, props)
        const value = args.value.evaluate().jsValue
        return createElement(RN.Pressable, {
          accessibilityLabel: taoProps?.accessibilityLabel,
          onPress: () => {
            environment.report(`${environment.capture}:${value}:${count}`)
            setCount(current => current + 1)
          },
          testID: args.id,
        }, createElement(RN.Text, null, `${args.id}:${value}:${environment.capture}:${count}`))
      }
      function placements(renderer: TaoSlotRenderer<Args>, args: readonly Args[], taoProps: TR.TaoProps): ReactElement {
        return createElement(
          RN.View,
          null,
          ...args.map(argument =>
            createElement(RenderSlotFrame<Args>, {
              args: argument,
              key: argument.id,
              renderer: selectRenderSlot({ content: renderer }, 'content'),
              taoProps,
            })
          ),
        )
      }
      const firstEnvironment: Environment = { capture: 'First', report: value => firstReports.push(value) }
      const firstRenderer = createSlotRenderer(Body, firstEnvironment)
      const firstA = { id: 'A', value: TR.Value('old A') }
      const firstB = { id: 'B', value: TR.Value('old B') }
      const firstTaoProps = { accessibilityLabel: 'First occurrence' }
      Expect(selectRenderSlot({ forwarded: firstRenderer }, 'forwarded')).toBe(firstRenderer)
      Expect(observed.size).toBe(0)
      Expect(mounted).toEqual([])
      const screen = render(placements(firstRenderer, [firstA, firstB], firstTaoProps))
      await fireEventAsync.press(screen.getByTestId('A'))
      await fireEventAsync.press(screen.getByTestId('B'))
      await fireEventAsync.press(screen.getByTestId('B'))
      Expect(screen.getByText('A:old A:First:1')).toBeDefined()
      Expect(screen.getByText('B:old B:First:2')).toBeDefined()

      const nextEnvironment: Environment = { capture: 'Next', report: value => nextReports.push(value) }
      const nextRenderer = createSlotRenderer(Body, nextEnvironment)
      const nextA = { id: 'A', value: TR.Value('new A') }
      const nextB = { id: 'B', value: TR.Value('new B') }
      const nextTaoProps = { accessibilityLabel: 'Next occurrence', testTag: 'current' }
      Expect(nextRenderer).not.toBe(firstRenderer)
      screen.rerender(placements(nextRenderer, [nextA, nextB], nextTaoProps))
      Expect(screen.getByText('A:new A:Next:1')).toBeDefined()
      Expect(screen.getByText('B:new B:Next:2')).toBeDefined()
      Expect(observed.get('A')?.args).toBe(nextA)
      Expect(observed.get('A')?.args.value).toBe(nextA.value)
      Expect(observed.get('A')?.environment).toBe(nextEnvironment)
      Expect(observed.get('A')?.taoProps).toBe(nextTaoProps)
      Expect(screen.getByTestId('A').props.accessibilityLabel).toBe('Next occurrence')
      Expect(mounted).toEqual(['A', 'B'])
      Expect(removed).toEqual([])
      await fireEventAsync.press(screen.getByTestId('A'))
      Expect(firstReports).toEqual(['First:old A:0', 'First:old B:0', 'First:old B:1'])
      Expect(nextReports).toEqual(['Next:new A:1'])

      screen.rerender(placements(createSlotRenderer(Body, nextEnvironment), [nextB, nextA], nextTaoProps))
      Expect(screen.getAllByText(/^[AB]:/).map(node => node.props.children)).toEqual([
        'B:new B:Next:2',
        'A:new A:Next:2',
      ])
      Expect(mounted).toEqual(['A', 'B'])
      Expect(removed).toEqual([])
      screen.rerender(placements(nextRenderer, [nextB], nextTaoProps))
      Expect(screen.queryByTestId('A')).toBeNull()
      Expect(screen.getByText('B:new B:Next:2')).toBeDefined()
      Expect(removed).toEqual(['A'])
      screen.rerender(placements(nextRenderer, [nextB, nextA], nextTaoProps))
      Expect(screen.getByText('B:new B:Next:2')).toBeDefined()
      Expect(screen.getByText('A:new A:Next:0')).toBeDefined()
      Expect(mounted).toEqual(['A', 'B', 'A'])
      screen.unmount()
      Expect(removed.filter(id => id === 'A')).toHaveLength(2)
      Expect(removed.filter(id => id === 'B')).toHaveLength(1)
    },
  )

  Test(
    'suppresses defaults for explicit empty slots and remounts a replacement body with a different hook topology',
    async () => {
      const lifecycle: string[] = []
      function DefaultBody(): ReactElement {
        const [count, setCount] = useState(0)
        useEffect(() => {
          lifecycle.push('default mounted')
          return () => {
            lifecycle.push('default removed')
          }
        }, [])
        return createElement(RN.Pressable, {
          onPress: () => setCount(current => current + 1),
          testID: 'default',
        }, createElement(RN.Text, null, `Default ${count}`))
      }
      function ReplacementBody(): ReactElement {
        const [count, increment] = useReducer((value: number) => value + 1, 50)
        const marker = useRef('replacement').current
        const [otherState] = useState('independent')
        useEffect(() => {
          lifecycle.push('replacement mounted')
          return () => {
            lifecycle.push('replacement removed')
          }
        }, [])
        return createElement(RN.Pressable, {
          onPress: increment,
          testID: marker,
        }, createElement(RN.Text, null, `Replacement ${count} ${otherState}`))
      }
      const fallback = createSlotRenderer<undefined, undefined>(DefaultBody, undefined)
      const replacement = createSlotRenderer<undefined, undefined>(ReplacementBody, undefined)
      const placement = (renderer: TaoSlotRenderer<undefined> | null) =>
        createElement(RenderSlotFrame<undefined>, {
          args: undefined,
          renderer,
        })
      const screen = render(placement(selectRenderSlot(undefined, 'content', fallback)))
      await fireEventAsync.press(screen.getByTestId('default'))
      Expect(screen.getByText('Default 1')).toBeDefined()
      screen.rerender(placement(selectRenderSlot({ content: null }, 'content', fallback)))
      Expect(screen.queryByTestId('default')).toBeNull()
      Expect(lifecycle).toEqual(['default mounted', 'default removed'])
      screen.rerender(placement(selectRenderSlot({ content: undefined }, 'content', fallback)))
      Expect(screen.queryByTestId('default')).toBeNull()
      Expect(lifecycle).toHaveLength(2)
      screen.rerender(placement(selectRenderSlot({}, 'content', fallback)))
      Expect(screen.getByText('Default 0')).toBeDefined()
      screen.rerender(placement(selectRenderSlot({ content: replacement }, 'content', fallback)))
      Expect(screen.queryByTestId('default')).toBeNull()
      Expect(screen.getByText('Replacement 50 independent')).toBeDefined()
      Expect(lifecycle).toEqual([
        'default mounted',
        'default removed',
        'default mounted',
        'default removed',
        'replacement mounted',
      ])
      await fireEventAsync.press(screen.getByTestId('replacement'))
      Expect(screen.getByText('Replacement 51 independent')).toBeDefined()
      screen.unmount()
      Expect(lifecycle.at(-1)).toBe('replacement removed')
    },
  )

  Test(
    'lets actual Tao state holders own live-source notifications, source replacement and subscription cleanup per placement',
    async () => {
      type LiveValue = { value: string; subscribe(listener: () => void): () => void }
      type Environment = { caption: string; initial: LiveValue; replacement: LiveValue }
      const firstSource = createReactiveSource()
      const secondSource = createReactiveSource()
      const first = markReactiveValue({ value: 'First reading', subscribe: firstSource.subscribe })
      const second = markReactiveValue({ value: 'Second reading', subscribe: secondSource.subscribe })
      let renders = 0
      function HolderBody({ args, environment }: RenderSlotBodyProps<{ id: string }, Environment>): ReactElement {
        const holder = TR.State(() => TR.Value(environment.initial))
        const [count, setCount] = useState(0)
        renders += 1
        return createElement(
          RN.View,
          null,
          createElement(RN.Text, null, `${args.id}:${holder.evaluate().jsValue.value}:${environment.caption}:${count}`),
          createElement(RN.Pressable, {
            onPress: () => setCount(current => current + 1),
            testID: `${args.id}-increment`,
          }),
          createElement(RN.Pressable, {
            onPress: () => holder.set(TR.Value(environment.replacement)),
            testID: `${args.id}-replace`,
          }),
        )
      }
      const environment: Environment = { caption: 'Original capture', initial: first, replacement: second }
      const placement = (renderer: TaoSlotRenderer<{ id: string }>, ids: readonly string[]) =>
        createElement(
          RN.View,
          null,
          ...ids.map(id =>
            createElement(RenderSlotFrame<{ id: string }>, {
              args: { id },
              key: id,
              renderer,
            })
          ),
        )
      const screen = render(placement(createSlotRenderer(HolderBody, environment), ['A', 'B']))
      Expect(firstSource.listenerCount).toBe(2)
      Expect(secondSource.listenerCount).toBe(0)
      await fireEventAsync.press(screen.getByTestId('A-increment'))
      act(() => {
        first.value = 'Updated reading'
        firstSource.notify()
      })
      Expect(screen.getByText('A:Updated reading:Original capture:1')).toBeDefined()
      Expect(screen.getByText('B:Updated reading:Original capture:0')).toBeDefined()
      const nextEnvironment = { ...environment, caption: 'Fresh capture' }
      const nextRenderer = createSlotRenderer(HolderBody, nextEnvironment)
      screen.rerender(placement(nextRenderer, ['A', 'B']))
      Expect(screen.getByText('A:Updated reading:Fresh capture:1')).toBeDefined()
      Expect(firstSource.listenerCount).toBe(2)
      await fireEventAsync.press(screen.getByTestId('A-replace'))
      Expect(screen.getByText('A:Second reading:Fresh capture:1')).toBeDefined()
      Expect(screen.getByText('B:Updated reading:Fresh capture:0')).toBeDefined()
      Expect(firstSource.listenerCount).toBe(1)
      Expect(secondSource.listenerCount).toBe(1)
      screen.rerender(placement(nextRenderer, ['A']))
      Expect(firstSource.listenerCount).toBe(0)
      Expect(secondSource.listenerCount).toBe(1)
      const afterRemoval = renders
      act(() => {
        first.value = 'Removed source reading'
        firstSource.notify()
      })
      Expect(renders).toBe(afterRemoval)
      Expect(screen.getByText('A:Second reading:Fresh capture:1')).toBeDefined()
      act(() => {
        second.value = 'Live replacement reading'
        secondSource.notify()
      })
      Expect(screen.getByText('A:Live replacement reading:Fresh capture:1')).toBeDefined()
      screen.unmount()
      Expect(firstSource.listenerCount).toBe(0)
      Expect(secondSource.listenerCount).toBe(0)
      const afterUnmount = renders
      act(() => secondSource.notify())
      Expect(renders).toBe(afterUnmount)
    },
  )
})
