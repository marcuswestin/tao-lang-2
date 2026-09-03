import { jest } from '@jest/globals'
import TR from '@runtime/TR'
import { interactionOutline } from '@runtime/TR-interaction-outline'
import { NavigationCommandButton } from '@runtime/TR-navigation-command-button'
import { NativeToolbar } from '@runtime/TR-navigation-native-stack'
import * as TaoReactNative from '@runtime/TR-react-native'
import { Describe, Expect, Test } from '@shared/test'
import { act, fireEventAsync, render } from '@testing-library/react-native'
import { createElement } from 'react'
import * as RN from 'react-native'
import { registerRuntimeE2ELifecycle } from './test-compile-app'

type FocusEvent = Readonly<{ eventType: 'focus'; host: object }>

registerRuntimeE2ELifecycle()

Describe('navigation accessibility', () => {
  Test('exposes JS selection controls as one tablist with selected tab state', async () => {
    const home = TR.Navigation.View({ name: 'Home', render: () => createElement(RN.Text, null, 'Home content') })
    const settings = TR.Navigation.View({
      name: 'Settings',
      render: () => createElement(RN.Text, null, 'Settings content'),
    })
    const selection = TR.Navigation.Mount(TR.Navigation.Configure(
      TR.Navigation.Declaration('Accessible selection', TR.NavKind.Basic.Selection()),
      {
        '@home': { Content: home, Label: TR.Value('Home') },
        '@settings': { Content: settings, Label: TR.Value('Settings') },
        Display: TR.Value('tabs'),
        Initial: TR.Value('@home'),
      },
    ))
    const app = TR.Navigation.App({
      auxiliaries: () => ({}),
      name: 'Accessible selection app',
      navigator: () => selection,
    })
    const screen = render(createElement(TR.Navigation.AppHost, { app }))

    Expect(screen.UNSAFE_getByProps({ accessibilityRole: 'tablist' })).toBeDefined()
    const tabs = screen.getAllByRole('tab')
    Expect(tabs[0]?.props.accessibilityState).toMatchObject({ disabled: false, selected: true })
    Expect(tabs[1]?.props.accessibilityState).toMatchObject({ disabled: false, selected: false })

    await fireEventAsync.press(screen.getByText('Settings'))
    const updatedTabs = screen.getAllByRole('tab')
    Expect(updatedTabs[0]?.props.accessibilityState).toMatchObject({ disabled: false, selected: false })
    Expect(updatedTabs[1]?.props.accessibilityState).toMatchObject({ disabled: false, selected: true })
  })

  Test('projects a navigation command semantic focus request to its mounted host', () => {
    const focusEvents: FocusEvent[] = []
    const restoreRuntime = jest.spyOn(TaoReactNative, 'requireReactNativeRuntime').mockReturnValue(
      runtimeWithFocus(focusEvents),
    )
    try {
      render(createElement(NavigationCommandButton, {
        command: navigationCommand('Focus command', () => undefined).read(),
      }))
      const command = interactionOutline.liveNodes().find(node => node.label() === 'Focus command')

      Expect(command?.live?.focus).toBeDefined()
      act(() => command?.live?.focus?.())
      Expect(focusEvents).toHaveLength(1)
      Expect(focusEvents[0]?.eventType).toBe('focus')
    } finally {
      restoreRuntime.mockRestore()
    }
  })

  Test('reports Basic More expansion and restores focus after command dismissal', async () => {
    const focusEvents: FocusEvent[] = []
    const invoked: string[] = []
    const restoreRuntime = jest.spyOn(TaoReactNative, 'requireReactNativeRuntime').mockReturnValue(
      runtimeWithFocus(focusEvents),
    )
    try {
      const commands = ['First', 'Second', 'Third'].map(label => navigationCommand(label, () => invoked.push(label)))
      const home = TR.Navigation.View({
        name: 'Home',
        render: (_arguments, _taoProps, host) => {
          TR.Navigation.UseHostSlots(host, {
            Title: () => TR.Value('Home'),
            Toolbar: () => commands,
          })
          return createElement(RN.Text, null, 'Home content')
        },
      })
      const stack = TR.Navigation.Mount(TR.Navigation.Configure(
        TR.Navigation.Declaration('Accessible basic stack', TR.NavKind.Basic.Stack()),
        { Initial: home },
      ))
      const screen = render(stack.render() as React.ReactElement)

      Expect(screen.getByLabelText('More').props.accessibilityState).toEqual({
        disabled: false,
        expanded: false,
      })
      await fireEventAsync.press(screen.getByLabelText('More'))
      Expect(screen.getByLabelText('More').props.accessibilityState).toEqual({
        disabled: false,
        expanded: true,
      })
      const moreHost = focusEvents.at(-1)?.host
      Expect(moreHost).toBeDefined()

      focusEvents.length = 0
      await fireEventAsync.press(screen.getByLabelText('Third'))
      Expect(invoked).toEqual(['Third'])
      Expect(screen.getByLabelText('More').props.accessibilityState).toEqual({
        disabled: false,
        expanded: false,
      })
      Expect(focusEvents.at(-1)?.host).toBe(moreHost)
    } finally {
      restoreRuntime.mockRestore()
    }
  })

  Test('reports native More expansion and restores focus after menu dismissal', async () => {
    const focusEvents: FocusEvent[] = []
    const restoreRuntime = jest.spyOn(TaoReactNative, 'requireReactNativeRuntime').mockReturnValue(
      runtimeWithFocus(focusEvents),
    )
    try {
      const commands = ['First', 'Second', 'Third'].map(label => navigationCommand(label, () => undefined).read())
      const screen = render(createElement(NativeToolbar, { commands }))

      Expect(screen.getByLabelText('More').props.accessibilityState).toEqual({
        disabled: false,
        expanded: false,
      })
      await fireEventAsync.press(screen.getByLabelText('More'))
      Expect(screen.getByLabelText('More').props.accessibilityState).toEqual({
        disabled: false,
        expanded: true,
      })

      focusEvents.length = 0
      await fireEventAsync.press(screen.getByLabelText('Third'))
      Expect(screen.getByLabelText('More').props.accessibilityState).toEqual({
        disabled: false,
        expanded: false,
      })
      Expect(focusEvents).toHaveLength(1)
      Expect(focusEvents[0]?.eventType).toBe('focus')
    } finally {
      restoreRuntime.mockRestore()
    }
  })
})

function navigationCommand(label: string, invoke: () => unknown): TR.Command {
  return TR.Interaction.Command({
    action: () => TR.Action(invoke),
    members: { Label: () => TR.Value(label) },
    name: label,
  })
}

function runtimeWithFocus(events: FocusEvent[]): TaoReactNative.ReactNativeRuntime {
  return {
    AccessibilityInfo: {
      sendAccessibilityEvent(host, eventType) {
        events.push({ eventType, host })
      },
    },
    ActivityIndicator: RN.ActivityIndicator,
    Image: RN.Image,
    KeyboardAvoidingView: RN.KeyboardAvoidingView,
    Modal: RN.Modal,
    Platform: { OS: 'ios' },
    Pressable: RN.Pressable,
    ScrollView: RN.ScrollView,
    Switch: RN.Switch,
    Text: RN.Text,
    TextInput: RN.TextInput,
    View: RN.View,
  }
}
