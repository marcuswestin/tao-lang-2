import { jest } from '@jest/globals'
import TR from '@runtime/TR'
import * as TaoAppShell from '@runtime/TR-app-shell'
import { interactionOutline } from '@runtime/TR-interaction-outline'
import { NavigationCommandButton } from '@runtime/TR-navigation-command-button'
import { RuntimeHostReadChannel } from '@runtime/TR-navigation-host-slots'
import { NativeToolbar } from '@runtime/TR-navigation-native-stack'
import { overrideLiquidGlassForTest, SelectionToggleBar } from '@runtime/TR-navigation-toggle-bar'
import * as TaoReactNative from '@runtime/TR-react-native'
import { Describe, Expect, Test } from '@shared/test'
import { act, fireEventAsync, render } from '@testing-library/react-native'
import { createElement } from 'react'
import * as RN from 'react-native'
import { registerRuntimeE2ELifecycle } from './test-compile-app'

type FocusEvent = Readonly<{ eventType: 'focus'; host: object }>

registerRuntimeE2ELifecycle()

Describe('navigation accessibility', () => {
  Test('renders every native toggle surface through the available Liquid Glass adapter', () => {
    const restoreRuntime = jest.spyOn(TaoReactNative, 'requireReactNativeRuntime').mockReturnValue(
      runtimeWithFocus([]),
    )
    const restoreInsets = jest.spyOn(TaoAppShell, 'requireSafeAreaContext').mockReturnValue({
      SafeAreaProvider: RN.View,
      useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
    })
    const restoreGlass = overrideLiquidGlassForTest({
      GlassView: props => createElement(RN.View, { ...props, testID: 'liquid-glass-surface' }),
      isGlassEffectAPIAvailable: () => true,
      isLiquidGlassAvailable: () => true,
    })
    try {
      const screen = render(createElement(SelectionToggleBar, {
        back: () => undefined,
        canGoBack: true,
        chrome: new RuntimeHostReadChannel(),
        fallbackTitle: 'Home',
        name: 'Glass selection',
        native: true,
        next: { key: 'settings', label: 'Settings' },
        observable: true,
        select: () => undefined,
      }))

      const surfaces = screen.getAllByTestId('liquid-glass-surface')
      Expect(surfaces).toHaveLength(3)
      Expect(surfaces.map(surface => surface.props.glassEffectStyle)).toEqual(['regular', 'regular', 'regular'])
      Expect(surfaces.every(surface => surface.props.isInteractive === true)).toBe(true)
      // The web renderer deprecates the pointerEvents prop; the bar passes touches through by style.
      const views = screen.UNSAFE_getAllByType(RN.View)
      Expect(views.filter(view => view.props.pointerEvents !== undefined)).toHaveLength(0)
      Expect(views.some(view => RN.StyleSheet.flatten(view.props.style)?.pointerEvents === 'box-none')).toBe(true)
    } finally {
      restoreGlass()
      restoreInsets.mockRestore()
      restoreRuntime.mockRestore()
    }
  })

  Test('uses opaque chrome when Reduce Transparency changes and restores glass when disabled', async () => {
    let changed: ((enabled: boolean) => void) | undefined
    let removed = false
    const runtime = runtimeWithFocus([])
    const restoreRuntime = jest.spyOn(TaoReactNative, 'requireReactNativeRuntime').mockReturnValue({
      ...runtime,
      AccessibilityInfo: {
        ...runtime.AccessibilityInfo!,
        addEventListener: (_event, listener) => {
          changed = listener
          return {
            remove: () => {
              removed = true
            },
          }
        },
        isReduceTransparencyEnabled: async () => true,
      },
    })
    const restoreInsets = jest.spyOn(TaoAppShell, 'requireSafeAreaContext').mockReturnValue({
      SafeAreaProvider: RN.View,
      useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
    })
    const restoreGlass = overrideLiquidGlassForTest({
      GlassView: props => createElement(RN.View, { ...props, testID: 'liquid-glass-surface' }),
    })
    try {
      const screen = render(createElement(SelectionToggleBar, {
        back: () => undefined,
        canGoBack: true,
        chrome: new RuntimeHostReadChannel(),
        fallbackTitle: 'Home',
        name: 'Accessible selection',
        native: true,
        next: { key: 'settings', label: 'Settings' },
        observable: true,
        select: () => undefined,
      }))
      await act(async () => {
        await Promise.resolve()
      })
      Expect(screen.queryAllByTestId('liquid-glass-surface')).toHaveLength(0)
      Expect(
        screen.UNSAFE_getAllByType(RN.View).filter(view =>
          RN.StyleSheet.flatten(view.props.style)?.backgroundColor === '#fafafc'
        ),
      ).toHaveLength(3)
      act(() => changed?.(false))
      Expect(screen.getAllByTestId('liquid-glass-surface')).toHaveLength(3)
      act(() => changed?.(true))
      Expect(screen.queryAllByTestId('liquid-glass-surface')).toHaveLength(0)
      screen.unmount()
      Expect(removed).toBe(true)
    } finally {
      restoreGlass()
      restoreInsets.mockRestore()
      restoreRuntime.mockRestore()
    }
  })

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
      focusEvents.length = 0
      await fireEventAsync.press(screen.getByLabelText('More'))
      Expect(screen.getByLabelText('More').props.accessibilityState).toEqual({
        disabled: false,
        expanded: true,
      })
      const menu = screen.UNSAFE_getByProps({ accessibilityRole: 'menu' })
      Expect(menu.props.accessibilityViewIsModal).toBe(true)
      Expect(menu.props.onAccessibilityEscape).toEqual(expect.any(Function))
      Expect(focusEvents).toHaveLength(2)
      const moreHost = focusEvents[0]?.host
      Expect(focusEvents[1]?.host).not.toBe(moreHost)

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

  Test('hides toggle chrome while an item overlay is modal and restores it after dismissal', () => {
    const restoreRuntime = jest.spyOn(TaoReactNative, 'requireReactNativeRuntime').mockReturnValue(
      runtimeWithFocus([]),
    )
    try {
      const commands = ['First', 'Second', 'Third'].map(label => navigationCommand(label, () => undefined))
      const home = TR.Navigation.View({
        name: 'Toggle home',
        render: (_arguments, _taoProps, host) => {
          TR.Navigation.UseHostSlots(host, {
            Title: () => TR.Value('Toggle home'),
            Toolbar: () => commands,
          })
          return createElement(RN.Text, null, 'Toggle home content')
        },
      })
      const notice = TR.Navigation.View({
        name: 'Toggle notice',
        render: () => createElement(RN.Text, null, 'Toggle notice content'),
      })
      const stack = TR.Navigation.Mount(TR.Navigation.Configure(
        TR.Navigation.Declaration('Toggle item stack', TR.NavKind.Basic.Stack()),
        { Initial: home },
      ))
      const selection = toggleSelection(stack)
      const app = TR.Navigation.App({
        auxiliaries: () => ({}),
        name: 'Toggle modal app',
        navigator: () => selection,
      })
      const screen = render(createElement(TR.Navigation.AppHost, { app }))

      Expect(screen.getByLabelText('More')).toBeDefined()
      act(() => stack.presentOverlay(notice, {}))
      Expect(screen.queryByLabelText('More')).toBeNull()
      Expect(screen.getByText('Toggle notice content')).toBeDefined()

      act(() => stack.back())
      Expect(screen.getByLabelText('More')).toBeDefined()
    } finally {
      restoreRuntime.mockRestore()
    }
  })

  Test('restores toggle More focus only after its modal menu has closed', async () => {
    const focusEvents: FocusEvent[] = []
    const menuPresenceAtMoreFocus: boolean[] = []
    let rendered: ReturnType<typeof render> | undefined
    const restoreRuntime = jest.spyOn(TaoReactNative, 'requireReactNativeRuntime').mockReturnValue(
      runtimeWithFocus(focusEvents, host => {
        if ((host as { props?: { accessibilityLabel?: string } }).props?.accessibilityLabel === 'More') {
          menuPresenceAtMoreFocus.push(rendered?.queryByRole('menu') !== null)
        }
      }),
    )
    try {
      const commands = ['First', 'Second', 'Third'].map(label => navigationCommand(label, () => undefined))
      const home = TR.Navigation.View({
        name: 'Toggle focus home',
        render: (_arguments, _taoProps, host) => {
          TR.Navigation.UseHostSlots(host, {
            Title: () => TR.Value('Toggle focus home'),
            Toolbar: () => commands,
          })
          return createElement(RN.Text, null, 'Toggle focus content')
        },
      })
      const stack = TR.Navigation.Mount(TR.Navigation.Configure(
        TR.Navigation.Declaration('Toggle focus stack', TR.NavKind.Basic.Stack()),
        { Initial: home },
      ))
      const selection = toggleSelection(stack)
      const app = TR.Navigation.App({
        auxiliaries: () => ({}),
        name: 'Toggle focus app',
        navigator: () => selection,
      })
      const screen = render(createElement(TR.Navigation.AppHost, { app }))
      rendered = screen

      focusEvents.length = 0
      await fireEventAsync.press(screen.getByLabelText('More'))
      const menuHost = focusEvents.at(-1)?.host
      Expect((menuHost as { props?: { accessibilityLabel?: string } } | undefined)?.props?.accessibilityLabel)
        .toBe('Third')

      focusEvents.length = 0
      await fireEventAsync.press(screen.getByLabelText('Third'))
      Expect(screen.getByLabelText('More').props.accessibilityState).toMatchObject({ expanded: false })
      Expect(focusEvents).toHaveLength(1)
      Expect((focusEvents[0]?.host as { props?: { accessibilityLabel?: string } }).props?.accessibilityLabel)
        .toBe('More')
      Expect(menuPresenceAtMoreFocus).toEqual([false])
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
      focusEvents.length = 0
      await fireEventAsync.press(screen.getByLabelText('More'))
      Expect(screen.getByLabelText('More').props.accessibilityState).toEqual({
        disabled: false,
        expanded: true,
      })
      const menu = screen.UNSAFE_getByProps({ accessibilityRole: 'menu' })
      Expect(menu.props.accessibilityViewIsModal).toBe(true)
      Expect(focusEvents).toHaveLength(1)

      focusEvents.length = 0
      act(() => menu.props.onAccessibilityEscape())
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

function toggleSelection(content: TR.NavigationValue): TR.NavigationValue {
  return TR.Navigation.Mount(TR.Navigation.Configure(
    TR.Navigation.Declaration('Accessible toggle selection', TR.NavKind.Selection()),
    {
      '@home': { Content: content, Label: TR.Value('Home') },
      '@settings': {
        Content: TR.Navigation.View({
          name: 'Settings',
          render: () => createElement(RN.Text, null, 'Settings content'),
        }),
        Label: TR.Value('Settings'),
      },
      Display: TR.Value('toggle'),
      Initial: TR.Value('@home'),
    },
  ))
}

function runtimeWithFocus(
  events: FocusEvent[],
  onFocus?: (host: object) => void,
): TaoReactNative.ReactNativeRuntime {
  return {
    AccessibilityInfo: {
      sendAccessibilityEvent(host, eventType) {
        events.push({ eventType, host })
        onFocus?.(host)
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
