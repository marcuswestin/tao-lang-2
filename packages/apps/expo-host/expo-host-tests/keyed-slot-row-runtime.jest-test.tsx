import TR from '@runtime/TR'
import { createElement } from '@runtime/TR-create-element'
import { createSlotRenderer, type RenderSlotBodyProps } from '@runtime/TR-render-slots'
import { mountKeyedSlotRow } from '@runtime/TR-ui-render'
import { Describe, Expect, Test } from '@shared/test'
import { fireEventAsync, render } from '@testing-library/react-native'
import { type ReactElement, useEffect, useState } from 'react'
import * as RN from 'react-native'
import { registerRuntimeE2ELifecycle } from './test-compile-app'

registerRuntimeE2ELifecycle()

Describe('mounted keyed slot rows', () => {
  Test(
    'keeps each occurrence current and keyed through updates, reorder, body replacement, removal and null',
    async () => {
      type Args = { item: string; value: TR.Value<string> }
      type Environment = { capture: string }
      type Row = Readonly<{ key: string; args: Args; taoProps: TR.TaoProps }>
      const observed = new Map<string, RenderSlotBodyProps<Args, Environment>>()
      const lifecycle: string[] = []

      function Body(props: RenderSlotBodyProps<Args, Environment>): ReactElement {
        const [count, setCount] = useState(0)
        const occurrence = props.taoProps?.testTag ?? 'missing'
        observed.set(occurrence, props)
        useEffect(() => {
          lifecycle.push(`body:${occurrence}:mounted`)
          return () => {
            lifecycle.push(`body:${occurrence}:removed`)
          }
        }, [occurrence])
        return createElement(
          RN.Pressable,
          {
            onPress: () => setCount(current => current + 1),
            testID: occurrence,
          },
          createElement(
            RN.Text,
            null,
            `${props.args.item}:${props.args.value.evaluate().jsValue}:${props.environment.capture}:${count}`,
          ),
        )
      }

      function ReplacementBody(props: RenderSlotBodyProps<Args, Environment>): ReactElement {
        const occurrence = props.taoProps?.testTag ?? 'missing'
        useEffect(() => {
          lifecycle.push(`replacement:${occurrence}:mounted`)
          return () => {
            lifecycle.push(`replacement:${occurrence}:removed`)
          }
        }, [occurrence])
        return createElement(
          RN.Text,
          { testID: occurrence },
          `replacement:${props.args.item}:${props.environment.capture}`,
        )
      }

      const placements = (
        renderer: ReturnType<typeof createSlotRenderer<Args, Environment>> | null,
        rows: readonly Row[],
      ) => createElement(RN.View, null, ...rows.map(row => mountKeyedSlotRow(row, renderer)))
      const firstRenderer = createSlotRenderer(Body, { capture: 'first' })
      const leftValue = TR.Value('left-old')
      const rightValue = TR.Value('right-old')
      const firstRows: Row[] = [
        { key: 'occurrence:left', args: { item: 'same', value: leftValue }, taoProps: { testTag: 'occurrence:left' } },
        {
          key: 'occurrence:right',
          args: { item: 'same', value: rightValue },
          taoProps: { testTag: 'occurrence:right' },
        },
      ]
      const screen = render(placements(firstRenderer, firstRows))
      await fireEventAsync.press(screen.getByTestId('occurrence:left'))
      await fireEventAsync.press(screen.getByTestId('occurrence:right'))
      await fireEventAsync.press(screen.getByTestId('occurrence:right'))

      const nextRenderer = createSlotRenderer(Body, { capture: 'fresh' })
      const nextRows: Row[] = [
        { key: 'occurrence:left', args: { item: 'same', value: leftValue }, taoProps: { testTag: 'occurrence:left' } },
        {
          key: 'occurrence:right',
          args: { item: 'same', value: rightValue },
          taoProps: { testTag: 'occurrence:right' },
        },
      ]
      screen.rerender(placements(nextRenderer, nextRows))
      Expect(screen.getByText('same:left-old:fresh:1')).toBeDefined()
      Expect(screen.getByText('same:right-old:fresh:2')).toBeDefined()
      Expect(observed.get('occurrence:left')?.args).toBe(nextRows[0]?.args)
      Expect(observed.get('occurrence:left')?.args.value).toBe(leftValue)
      Expect(observed.get('occurrence:left')?.taoProps).toBe(nextRows[0]?.taoProps)
      Expect(observed.get('occurrence:right')?.args).toBe(nextRows[1]?.args)
      Expect(observed.get('occurrence:right')?.args.value).toBe(rightValue)
      Expect(observed.get('occurrence:right')?.taoProps).toBe(nextRows[1]?.taoProps)

      screen.rerender(placements(createSlotRenderer(Body, { capture: 'reordered' }), [...nextRows].reverse()))
      Expect(screen.getByText('same:right-old:reordered:2')).toBeDefined()
      Expect(screen.getByText('same:left-old:reordered:1')).toBeDefined()
      Expect(screen.getAllByTestId(/^occurrence:/).map(node => node.props.testID)).toEqual([
        'occurrence:right',
        'occurrence:left',
      ])
      Expect(lifecycle).toEqual(['body:occurrence:left:mounted', 'body:occurrence:right:mounted'])

      const replacement = createSlotRenderer(ReplacementBody, { capture: 'replacement' })
      screen.rerender(placements(replacement, [...nextRows].reverse()))
      Expect(screen.getAllByText('replacement:same:replacement')).toHaveLength(2)
      Expect(lifecycle.filter(event => event.endsWith(':removed'))).toEqual([
        'body:occurrence:right:removed',
        'body:occurrence:left:removed',
      ])
      screen.rerender(placements(replacement, [nextRows[1]!]))
      Expect(screen.queryByTestId('occurrence:left')).toBeNull()
      Expect(lifecycle).toContain('replacement:occurrence:left:removed')
      screen.rerender(placements(null, [nextRows[1]!]))
      Expect(screen.queryByTestId('occurrence:right')).toBeNull()
      Expect(lifecycle).toContain('replacement:occurrence:right:removed')
      screen.unmount()
    },
  )
})
