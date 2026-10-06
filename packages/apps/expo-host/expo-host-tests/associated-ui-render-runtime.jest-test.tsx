import TR from '@runtime/TR'
import { createElement } from '@runtime/TR-create-element'
import { mountUiComponent } from '@runtime/TR-ui-render'
import { Describe, Expect, Test } from '@shared/test'
import { fireEventAsync, render } from '@testing-library/react-native'
import { type ReactElement, useEffect, useState } from 'react'
import * as RN from 'react-native'
import { registerRuntimeE2ELifecycle } from './test-compile-app'

registerRuntimeE2ELifecycle()

Describe('mounted associated UI components', () => {
  Test('mounts the selected component lazily with stable state and unchanged receiver props', async () => {
    type Props = { Receiver: TR.Value<string>; Caption: string; __tao: TR.TaoProps }
    const observed = new Map<string, Props>()
    const lifecycle: string[] = []
    function Body(props: Props): ReactElement {
      const [count, setCount] = useState(0)
      useEffect(() => {
        lifecycle.push('mounted')
        return () => {
          lifecycle.push('removed')
        }
      }, [])
      observed.set('current', props)
      return createElement(RN.Pressable, {
        testID: props.__tao.testTag,
        accessibilityLabel: props.__tao.accessibilityLabel,
        onPress: () => {
          setCount(current => current + 1)
        },
      }, createElement(RN.Text, null, `${props.Receiver.evaluate().jsValue}:${props.Caption}:${count}`))
    }
    const first: Props = {
      Receiver: TR.Value('First'),
      Caption: 'initial',
      __tao: { testTag: 'associated', accessibilityLabel: 'First occurrence' },
    }
    const element = mountUiComponent(Body, first)
    Expect(observed.size).toBe(0)
    Expect(lifecycle).toEqual([])
    const screen = render(element)
    await fireEventAsync.press(screen.getByTestId('associated'))
    Expect(screen.getByText('First:initial:1')).toBeDefined()
    Expect(observed.get('current')?.Receiver).toBe(first.Receiver)
    Expect(observed.get('current')?.__tao).toBe(first.__tao)

    const next: Props = {
      Receiver: TR.Value('Next'),
      Caption: 'updated',
      __tao: { testTag: 'associated', accessibilityLabel: 'Next occurrence' },
    }
    screen.rerender(mountUiComponent(Body, next))
    Expect(screen.getByText('Next:updated:1')).toBeDefined()
    Expect(screen.getByLabelText('Next occurrence')).toBeDefined()
    Expect(observed.get('current')?.Receiver).toBe(next.Receiver)
    Expect(observed.get('current')?.__tao).toBe(next.__tao)
    Expect(lifecycle).toEqual(['mounted'])
    await fireEventAsync.press(screen.getByTestId('associated'))
    Expect(screen.getByText('Next:updated:2')).toBeDefined()
    screen.unmount()
    Expect(lifecycle).toEqual(['mounted', 'removed'])
  })
})
