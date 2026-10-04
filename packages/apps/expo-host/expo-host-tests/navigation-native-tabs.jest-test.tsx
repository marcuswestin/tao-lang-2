import { jest } from '@jest/globals'
import TR from '@runtime/TR'
import { InteractionControls } from '@runtime/TR-interaction-catalog'
import { overrideNavigationCommandIconForTest } from '@runtime/TR-navigation-command-button'
import {
  captureNativeNavigationDiagnostics,
  disableNativeNavigationSurfaces,
  type NativeTabsHostProps,
  type NativeTabsScreenProps,
  overrideNativeNavigationModuleForTest,
} from '@runtime/TR-navigation-native-hosts'
import { renderNativeSelectionTabs } from '@runtime/TR-navigation-native-tabs'
import * as TaoReactNative from '@runtime/TR-react-native'
import { Deferred, Describe, Expect, Test } from '@shared/test'
import { act, render } from '@testing-library/react-native'
import React, { createElement } from 'react'
import * as RN from 'react-native'
import type { TabsHostProps, TabsScreenProps } from 'react-native-screens'
import { registerRuntimeE2ELifecycle } from './test-compile-app'

registerRuntimeE2ELifecycle()

Describe('native tab reconciliation', () => {
  Test('blocks native and late selection while covered and acknowledges prevented requests', () => {
    const fixture = tabsFixture()
    try {
      fixture.cover(true)
      Expect(fixture.host().tabBarHidden).toBe(true)
      Expect(fixture.screen.UNSAFE_getByProps({ screenKey: 'settings' }).props.preventNativeSelection).toBe(true)
      fixture.select('settings', 1)
      Expect(fixture.activations).toEqual([])
      fixture.prevent('settings', 2)
      Expect(fixture.host().navStateRequest).toEqual({ selectedScreenKey: 'home', baseProvenance: 2 })
      fixture.cover(false)
      Expect(fixture.host().tabBarHidden).toBe(false)
      Expect(fixture.screen.UNSAFE_getByProps({ screenKey: 'settings' }).props.preventNativeSelection).toBe(false)
      fixture.select('settings', 3)
      Expect(fixture.activations).toEqual(['settings'])
    } finally {
      fixture.dispose()
    }
  })

  Test('an item overlay disables native tab selection through the mounted navigation host', () => {
    const fixture = tabsFixture()
    const home = TR.Navigation.View({
      name: 'Covered home',
      render: () => createElement(RN.Text, null, 'Covered home content'),
    })
    const notice = TR.Navigation.View({
      name: 'Tab notice',
      render: () => createElement(RN.Text, null, 'Notice content'),
    })
    const stack = TR.Navigation.Mount(TR.Navigation.Configure(
      TR.Navigation.Declaration('Covered item stack', TR.NavKind.Basic.Stack()),
      { Initial: home },
    ))
    const selection = TR.Navigation.Mount(TR.Navigation.Configure(
      TR.Navigation.Declaration('Covered native selection', TR.NavKind.Selection()),
      {
        '@home': { Content: stack, Label: TR.Value('Covered home') },
        '@settings': { Content: home, Label: TR.Value('Covered settings') },
        Display: TR.Value('automatic'),
        Initial: TR.Value('@home'),
      },
    ))
    const app = TR.Navigation.App({ name: 'Covered tabs app', auxiliaries: () => ({}), navigator: () => selection })
    const screen = render(createElement(TR.Navigation.AppHost, { app }))
    try {
      Expect(screen.UNSAFE_getByProps({ screenKey: 'settings' }).props.preventNativeSelection).toBe(false)
      act(() => stack.presentOverlay(notice, {}))
      Expect(screen.UNSAFE_getByProps({ screenKey: 'settings' }).props.preventNativeSelection).toBe(true)
      act(() => stack.back())
      Expect(screen.UNSAFE_getByProps({ screenKey: 'settings' }).props.preventNativeSelection).toBe(false)
    } finally {
      screen.unmount()
      fixture.dispose()
    }
  })

  Test('hides a retained tab ask from the window layer while another native tab is active', async () => {
    const fixture = tabsFixture()
    const askMounts: string[] = []
    const askUnmounts: string[] = []
    function Question() {
      React.useEffect(() => {
        askMounts.push('home ask')
        return () => {
          askUnmounts.push('home ask')
        }
      }, [])
      return createElement(RN.Text, null, 'Home tab question')
    }
    const home = TR.Navigation.View({ name: 'Ask home', render: () => createElement(RN.Text, null, 'Ask home page') })
    const settings = TR.Navigation.View({
      name: 'Ask settings',
      render: () => createElement(RN.Text, null, 'Settings page'),
    })
    const question = TR.Navigation.View({ name: 'Home question', render: () => createElement(Question) })
    const stack = TR.Navigation.Mount(TR.Navigation.Configure(
      TR.Navigation.Declaration('Asking tab stack', TR.NavKind.Basic.Stack()),
      { Initial: home },
    ))
    const selection = TR.Navigation.Mount(TR.Navigation.Configure(
      TR.Navigation.Declaration('Asking native tabs', TR.NavKind.Selection()),
      {
        '@home': { Content: stack, Label: TR.Value('Home') },
        '@settings': { Content: settings, Label: TR.Value('Settings') },
        Display: TR.Value('automatic'),
        Initial: TR.Value('@home'),
      },
    ))
    const app = TR.Navigation.App({ name: 'Asking tabs app', auxiliaries: () => ({}), navigator: () => selection })
    const screen = render(createElement(TR.Navigation.AppHost, { app }))
    let answer!: Promise<{ evaluate(): { jsValue: unknown } }>
    try {
      act(() => {
        answer = TR.Navigation.Ask({ app, navigation: stack }, question, {})
      })
      screen.getByText('Home tab question')
      Expect(fixture.host().tabBarHidden).toBe(true)
      act(() => {
        selection.activate('settings')
      })
      Expect(fixture.host().navStateRequest.selectedScreenKey).toBe('settings')
      Expect(fixture.host().tabBarHidden).toBe(false)
      Expect(screen.queryByText('Home tab question')).toBeNull()
      screen.getByText('Settings page')
      act(() => {
        selection.activate('home')
      })
      screen.getByText('Home tab question')
      Expect(askMounts).toEqual(['home ask'])
      Expect(askUnmounts).toEqual([])
      act(() => {
        stack.back()
      })
      Expect((await answer).evaluate().jsValue).toBe(null)
    } finally {
      screen.unmount()
      fixture.dispose()
    }
  })

  Test('resolves portable Android icons without letting an older request replace the current icon', async () => {
    const house = Deferred<RN.ImageSourcePropType>()
    const check = Deferred<RN.ImageSourcePropType>()
    const requests: string[] = []
    const Icon = Object.assign(() => null, {
      hasIcon: (name: string, style?: string) => style === 'solid' && ['house', 'check'].includes(name),
      getImageSource: (name: string) => {
        requests.push(name)
        return name === 'house' ? house.promise : check.promise
      },
    })
    const restoreIcon = overrideNavigationCommandIconForTest(Icon)
    const fixture = tabsFixture({ OS: 'android' })
    try {
      fixture.icon('checkmark')
      await act(async () => check.resolve({ uri: 'check.png' }))
      Expect(requests).toContain('check')
      Expect(fixture.screen.UNSAFE_getByProps({ screenKey: 'home' }).props.android?.icon)
        .toEqual({ type: 'imageSource', imageSource: { uri: 'check.png' } })
      await act(async () => house.resolve({ uri: 'old-house.png' }))
      Expect(fixture.screen.UNSAFE_getByProps({ screenKey: 'home' }).props.android?.icon)
        .toEqual({ type: 'imageSource', imageSource: { uri: 'check.png' } })
      fixture.icon('unsupported.symbol')
      Expect(fixture.screen.UNSAFE_getByProps({ screenKey: 'home' }).props.android).toBeUndefined()
      Expect(fixture.screen.UNSAFE_getByProps({ screenKey: 'home' }).props.title).toBe('home')
    } finally {
      fixture.dispose()
      restoreIcon()
    }
  })

  Test('reports an absent tab API once and keeps explicit test disabling quiet', () => {
    const fixture = tabsFixture()
    const warnings = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const restoreModule = overrideNativeNavigationModuleForTest({})
    try {
      const options = { activeKey: 'home', observable: true, items: [], onActivate: () => undefined }
      Expect(renderNativeSelectionTabs(options)).toBeUndefined()
      Expect(renderNativeSelectionTabs(options)).toBeUndefined()
      Expect(captureNativeNavigationDiagnostics().map(event => event.reason)).toEqual(['api-mismatch'])
      Expect(warnings).toHaveBeenCalledTimes(1)
      disableNativeNavigationSurfaces()
      warnings.mockClear()
      Expect(renderNativeSelectionTabs(options)).toBeUndefined()
      Expect(warnings).not.toHaveBeenCalled()
    } finally {
      restoreModule()
      warnings.mockRestore()
      fixture.dispose()
    }
  })

  Test('keeps all six Android destinations in the basic fallback and reports its limit', () => {
    const fixture = tabsFixture({ OS: 'android' })
    const warnings = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const items = Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`@item${index}`, {
        Label: TR.Value(`Destination ${index}`),
        Content: TR.Navigation.View({
          name: `Item${index}`,
          render: () => createElement(RN.Text, null, `Content ${index}`),
        }),
      }]))
      const selection = TR.Navigation.Mount(TR.Navigation.Configure(
        TR.Navigation.Declaration('Overflow selection', TR.NavKind.Selection()),
        { ...items, Display: TR.Value('automatic'), Initial: TR.Value('@item0') },
      ))
      const screen = render(selection.render() as React.ReactElement)
      try {
        Expect(screen.getAllByRole('tab')).toHaveLength(6)
        screen.getByText('Destination 5')
        Expect(captureNativeNavigationDiagnostics().some(event => event.reason === 'too-many-tabs')).toBe(true)
        Expect(selection.ownsWindowSurface()).toBe(false)
      } finally {
        screen.unmount()
      }
    } finally {
      warnings.mockRestore()
      fixture.dispose()
    }
  })

  Test('uses the pinned host and screen contract and retains every tab subtree', () => {
    const fixture = tabsFixture({ isPad: true, Version: '18.0' })
    try {
      Expect(fixture.host().navStateRequest).toEqual({ selectedScreenKey: 'home', baseProvenance: 0 })
      Expect(fixture.host().rejectStaleNavStateUpdates).toBe(true)
      Expect(fixture.host().ios?.tabBarControllerMode).toBe('tabSidebar')
      const home = fixture.screen.UNSAFE_getByProps({ screenKey: 'home' })
      Expect(home.props.ios.icon).toEqual({ type: 'sfSymbol', name: 'house' })
      Expect(home.props.specialEffects.repeatedTabSelection).toEqual({ popToRoot: false, scrollToTop: false })
      Expect(home.props.isFocused).toBeUndefined()
      fixture.select('settings', 1)
      fixture.select('home', 2)
      Expect(fixture.mounts).toEqual(['home', 'settings', 'third'])
      Expect(fixture.unmounts).toEqual([])
    } finally {
      fixture.dispose()
    }
  })

  Test('uses native sidebar adaptation for Catalyst without changing mobile adaptation', () => {
    for (
      const [platform, mode] of [
        [{ isMacCatalyst: true, Version: '26.0' }, 'tabSidebar'],
        [{ isPad: false, Version: '26.0' }, 'automatic'],
        [{ isPad: true, Version: '17.0' }, 'automatic'],
      ] as const
    ) {
      const fixture = tabsFixture(platform)
      try {
        Expect(fixture.host().ios?.tabBarControllerMode).toBe(mode)
      } finally {
        fixture.dispose()
      }
    }
  })

  Test('activates a user selection once through its outline identity, never its JS acknowledgement', () => {
    const fixture = tabsFixture()
    const activate = jest.spyOn(InteractionControls, 'ActivateIdentity')
    try {
      fixture.select('settings', 1)
      fixture.present('third')
      fixture.select('settings', 1)
      Expect(fixture.host().navStateRequest.selectedScreenKey).toBe('third')
      fixture.present('settings')
      fixture.select('settings', 2, 'programmatic-js')
      fixture.select('settings', 3, 'user', true)
      fixture.select('missing', 4)
      Expect(fixture.activations).toEqual(['settings'])
      Expect(activate).toHaveBeenCalledTimes(1)
      Expect(activate.mock.calls[0]?.[0]).toEqual(expect.stringContaining('navigation:selection:settings'))
      Expect(fixture.host().navStateRequest).toEqual({ selectedScreenKey: 'settings', baseProvenance: 4 })
    } finally {
      activate.mockRestore()
      fixture.dispose()
    }
  })

  Test('rebases the latest Tao intent after an older JS acknowledgement and a stale rejection', () => {
    const fixture = tabsFixture()
    try {
      fixture.present('settings')
      fixture.present('third')
      fixture.select('settings', 1, 'programmatic-js')
      Expect(fixture.host().navStateRequest).toEqual({ selectedScreenKey: 'third', baseProvenance: 1 })
      fixture.reject('home', 4, 'settings', 0)
      Expect(fixture.host().navStateRequest).toEqual({ selectedScreenKey: 'third', baseProvenance: 4 })
      fixture.select('settings', 2, 'programmatic-js')
      fixture.select('home', 3)
      fixture.reject('settings', 2, 'third', 0)
      Expect(fixture.host().navStateRequest).toEqual({ selectedScreenKey: 'third', baseProvenance: 4 })
      Expect(fixture.activations).toEqual([])
      fixture.select('third', 5, 'programmatic-js')
      Expect(fixture.host().navStateRequest).toEqual({ selectedScreenKey: 'third', baseProvenance: 5 })
    } finally {
      fixture.dispose()
    }
  })

  Test('still handles the user event when a rejection acknowledging that native state arrives first', () => {
    const fixture = tabsFixture()
    try {
      fixture.reject('settings', 1, 'home', 0)
      fixture.select('settings', 1)
      fixture.select('settings', 1)
      Expect(fixture.activations).toEqual(['settings'])
      Expect(fixture.host().navStateRequest).toEqual({ selectedScreenKey: 'settings', baseProvenance: 1 })
      fixture.select('home', 2, 'implicit')
      fixture.select('third', 3, 'programmatic-native')
      Expect(fixture.activations).toEqual(['settings'])
      Expect(fixture.host().navStateRequest).toEqual({ selectedScreenKey: 'settings', baseProvenance: 3 })
    } finally {
      fixture.dispose()
    }
  })
})

function tabsFixture(platform: { OS?: string; isPad?: boolean; isMacCatalyst?: boolean; Version?: string } = {}) {
  const activations: string[] = []
  const mounts: string[] = []
  const unmounts: string[] = []
  let activeKey = 'home'
  let observable = true
  let hostProps: TabsHostProps
  const runtime = jest.spyOn(TaoReactNative, 'requireReactNativeRuntime').mockReturnValue({
    ActivityIndicator: RN.ActivityIndicator,
    Image: RN.Image,
    KeyboardAvoidingView: RN.KeyboardAvoidingView,
    Pressable: RN.Pressable,
    ScrollView: RN.ScrollView,
    Switch: RN.Switch,
    Text: RN.Text,
    TextInput: RN.TextInput,
    View: RN.View,
    Platform: { OS: 'ios', ...platform },
  } as TaoReactNative.ReactNativeRuntime)
  const restoreModule = overrideNativeNavigationModuleForTest({
    Tabs: {
      Host: (props: NativeTabsHostProps) => {
        hostProps = props
        return createElement(RN.View, null, props.children)
      },
      Screen: (props: NativeTabsScreenProps) => {
        const screenProps: TabsScreenProps = props
        return createElement(RN.View, screenProps, screenProps.children)
      },
    },
  })
  function Content({ name }: { name: string }) {
    React.useEffect(() => {
      mounts.push(name)
      return () => {
        unmounts.push(name)
      }
    }, [name])
    return createElement(RN.Text, null, `${name} content`)
  }
  const items = ['home', 'settings', 'third'].map(key => ({
    key,
    title: key,
    iconName: 'house',
    content: createElement(Content, { name: key }),
  }))
  const element = () =>
    renderNativeSelectionTabs({
      activeKey,
      observable,
      items,
      onActivate: key => {
        activations.push(key)
        activeKey = key
        screen.rerender(element())
      },
    }) as React.ReactElement
  const screen = render(element())
  return {
    activations,
    mounts,
    unmounts,
    screen,
    host: () => hostProps,
    cover(covered: boolean) {
      observable = !covered
      screen.rerender(element())
    },
    icon(name: string) {
      items[0]!.iconName = name
      screen.rerender(element())
    },
    prevent(key: string, provenance: number) {
      act(() =>
        hostProps.onTabSelectionPrevented?.(
          {
            nativeEvent: {
              selectedScreenKey: activeKey,
              provenance,
              preventedScreenKey: key,
            },
          } as Parameters<NonNullable<TabsHostProps['onTabSelectionPrevented']>>[0],
        )
      )
    },
    present(key: string) {
      activeKey = key
      screen.rerender(element())
    },
    select(
      key: string,
      provenance: number,
      actionOrigin: 'user' | 'programmatic-js' | 'implicit' | 'programmatic-native' = 'user',
      isRepeated = false,
    ) {
      act(() =>
        hostProps.onTabSelected?.(
          {
            nativeEvent: {
              selectedScreenKey: key,
              provenance,
              actionOrigin,
              isRepeated,
              hasTriggeredSpecialEffect: false,
            },
          } as Parameters<NonNullable<TabsHostProps['onTabSelected']>>[0],
        )
      )
    },
    reject(key: string, provenance: number, rejectedScreenKey: string, rejectedBaseProvenance: number) {
      act(() =>
        hostProps.onTabSelectionRejected?.(
          {
            nativeEvent: {
              selectedScreenKey: key,
              provenance,
              rejectedScreenKey,
              rejectedBaseProvenance,
              rejectionReason: 'stale',
            },
          } as Parameters<NonNullable<TabsHostProps['onTabSelectionRejected']>>[0],
        )
      )
    },
    dispose() {
      screen.unmount()
      restoreModule()
      runtime.mockRestore()
    },
  }
}
