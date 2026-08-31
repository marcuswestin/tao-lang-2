import TR from '@runtime/TR'
import { fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import { Text } from 'react-native'

describe('SplitNav resize affordances', () => {
  test('drags a bound width, resets on portable double tap, and stops after responder termination', () => {
    let current = 320
    const writes: number[] = []
    let resets = 0
    const width = {
      evaluate: () => TR.Value(current),
      reset: () => {
        current = 320
        resets += 1
      },
      set: (next: TR.Evaluable) => {
        current = next.evaluate().jsValue
        writes.push(current)
      },
    }
    const screen = render(split(width).render() as React.ReactElement)
    const handle = screen.getByLabelText('Resize primary')

    fireEvent(handle, 'responderGrant', { nativeEvent: { pageX: 100 } })
    fireEvent(handle, 'responderMove', { nativeEvent: { pageX: 135 } })
    fireEvent(handle, 'responderRelease', { nativeEvent: { pageX: 135 } })
    expect(writes).toEqual([355])

    fireEvent(handle, 'responderGrant', { nativeEvent: { pageX: 100 } })
    fireEvent(handle, 'responderRelease', { nativeEvent: { pageX: 100 } })
    fireEvent(handle, 'responderGrant', { nativeEvent: { pageX: 100 } })
    fireEvent(handle, 'responderRelease', { nativeEvent: { pageX: 100 } })
    expect(resets).toBe(1)

    fireEvent(handle, 'responderGrant', { nativeEvent: { pageX: 100 } })
    fireEvent(handle, 'responderTerminate', { nativeEvent: { pageX: 100 } })
    fireEvent(handle, 'responderMove', { nativeEvent: { pageX: 180 } })
    expect(writes).toEqual([355])
  })
})

function split(width: TR.Evaluable): TR.NavigationValue {
  const pane = TR.Navigation.View({ name: 'Pane', render: () => <Text>Pane</Text> })
  return TR.Navigation.Mount(TR.Navigation.Configure(
    TR.Navigation.Declaration('Workspace', TR.NavKind.Split()),
    {
      '@primary': { Content: pane, Resizable: TR.Value(true), Width: width },
      '@detail': { Content: pane, Resizable: TR.Value(false), Width: TR.Value(240) },
    },
  ))
}
