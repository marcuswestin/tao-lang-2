import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import { act, cleanup, render } from '@testing-library/react-native'
import React from 'react'
import * as RN from 'react-native'

Describe('Scheme runtime provider', () => {
  Test('reacts to browser System changes through the ordinary runtime context', () => {
    const view = render(schemeHost('light'))
    Expect(view.getByTestId('scheme').props.children).toBe('system:light:system:reactive-browser')

    act(() => view.rerender(schemeHost('dark')))

    Expect(view.getByTestId('scheme').props.children).toBe('system:dark:system:reactive-browser')
    cleanup()
  })
})

function schemeHost(system: TR.Scheme): React.ReactElement {
  return (
    <TR.Scheme.Provider appearance="system" environment={{ platform: 'web', system }}>
      <SchemeValue />
    </TR.Scheme.Provider>
  )
}

function SchemeValue(): React.ReactElement {
  const scheme = TR.Scheme.use()
  return (
    <RN.Text testID="scheme">
      {`${scheme.requested}:${scheme.resolved}:${scheme.source}:${scheme.capability}`}
    </RN.Text>
  )
}
