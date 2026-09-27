import TR from '@runtime/TR'
import { NavigationCommandButton } from '@runtime/TR-navigation-command-button'
import * as TaoReactNative from '@runtime/TR-react-native'
import { Describe, Expect, Test, testOverrideSlot } from '@shared/test'
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

const runtimeSlot = testOverrideSlot({
  read: () => TaoReactNative.requireReactNativeRuntime,
  write: value =>
    Object.defineProperty(TaoReactNative, 'requireReactNativeRuntime', { configurable: true, value, writable: true }),
})

Describe('Catalyst appearance', () => {
  Test('updates mounted defaults, preserves authored colors, and removes appearance listeners', () => {
    let system: TR.Scheme = 'light'
    const listeners = new Set<() => void>()
    const runtime = TaoReactNative.requireReactNativeRuntime()
    const restore = runtimeSlot.install(() => ({
      ActivityIndicator: runtime.ActivityIndicator,
      Image: runtime.Image,
      KeyboardAvoidingView: runtime.KeyboardAvoidingView,
      Pressable: runtime.Pressable,
      ScrollView: runtime.ScrollView,
      Switch: runtime.Switch,
      Text: runtime.Text,
      TextInput: runtime.TextInput,
      View: runtime.View,
      Platform: { OS: 'ios', isMacCatalyst: true },
      Appearance: {
        getColorScheme: () => system,
        addChangeListener: listener => {
          listeners.add(listener)
          return {
            remove: () => {
              listeners.delete(listener)
            },
          }
        },
      },
    }))
    try {
      const view = render(
        <TR.Scheme.Provider>
          <TR.AppSurfaceFrame nativeInsets>
            <SchemeValue />
            <NavigationCommandButton
              command={TR.Interaction.Command({
                action: () => TR.Action(() => undefined),
                members: { Label: () => TR.Value('Open menu') },
                name: 'OpenMenu',
              }).read()}
            />
            {TR.Views.Text({ children: 'Default text' }, { nativeProps: { testID: 'default-text' } })}
            {TR.Views.Text({ children: 'Authored text' }, {
              nativeProps: { testID: 'authored-text', style: { color: '#ff0000' } },
            })}
            {TR.Views.TextInput({ label: 'Name', value: '', id: 'name' })}
          </TR.AppSurfaceFrame>
        </TR.Scheme.Provider>,
      )
      Expect(RN.StyleSheet.flatten(view.UNSAFE_getByType(RN.ScrollView).props.style).backgroundColor).toBe('#ffffff')
      Expect(view.getByTestId('scheme').props.children).toBe('system:light:system:reactive-catalyst')
      Expect(RN.StyleSheet.flatten(view.getByTestId('default-text').props.style).color).toBe('#1c1c1e')
      act(() => {
        system = 'dark'
        listeners.forEach(listener => listener())
      })
      Expect(RN.StyleSheet.flatten(view.UNSAFE_getByType(RN.ScrollView).props.style).backgroundColor).toBe('#1c1c1e')
      Expect(view.UNSAFE_getByType(RN.ScrollView).props.contentInsetAdjustmentBehavior).toBe('automatic')
      Expect(view.getByTestId('scheme').props.children).toBe('system:dark:system:reactive-catalyst')
      Expect(RN.StyleSheet.flatten(view.getByTestId('default-text').props.style).color).toBe('#f2f2f7')
      Expect(RN.StyleSheet.flatten(view.getByTestId('authored-text').props.style).color).toBe('#ff0000')
      Expect(RN.StyleSheet.flatten(view.getByText('Open menu').props.style).color).toBe('#f2f2f7')
      Expect(RN.StyleSheet.flatten(view.getByTestId('name').props.style)).toMatchObject({
        color: '#f2f2f7',
        backgroundColor: '#1c1c1e',
        borderColor: '#48484a',
      })
      act(() => {
        system = 'light'
        listeners.forEach(listener => listener())
      })
      Expect(RN.StyleSheet.flatten(view.UNSAFE_getByType(RN.ScrollView).props.style).backgroundColor).toBe('#ffffff')
      Expect(view.getByTestId('scheme').props.children).toBe('system:light:system:reactive-catalyst')
      Expect(listeners.size).toBeGreaterThan(0)
      view.unmount()
      Expect(listeners.size).toBe(0)
    } finally {
      cleanup()
      restore()
    }
  })
})
