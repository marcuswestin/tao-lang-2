import { RuntimeTesting } from '@expo-host/testing/runtime-testing'
import { jest } from '@jest/globals'
import TR from '@runtime/TR'
import { navigationTitleTestId } from '@runtime/TR-navigation-basic-stack'
import {
  navigationCommandIconTestId,
  overrideNavigationCommandIconForTest,
} from '@runtime/TR-navigation-command-button'
import { RuntimeHostReadChannel } from '@runtime/TR-navigation-host-slots'
import { overrideNativeNavigationModuleForTest } from '@runtime/TR-navigation-native-hosts'
import { NativeStackSurface, NativeToolbar } from '@runtime/TR-navigation-native-stack'
import { navigationContentAccessibilityTestId } from '@runtime/TR-navigation-surfaces'
import * as TaoReactNative from '@runtime/TR-react-native'
import { Errors, FS, HCI } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { act, fireEvent, fireEventAsync, render } from '@testing-library/react-native'
import { createElement, type ReactElement, useState } from 'react'
import * as RN from 'react-native'
import { RuntimeToolchainPaths } from '../expo-host-src/runtime-toolchain-paths'
import {
  compileAndRenderApp,
  ExpectScreen,
  registerRuntimeE2ELifecycle,
  testCompileApp,
  testCompileFiles,
} from './test-compile-app'

function configuredStack(name: string, initial: TR.Presentable): TR.NavigationValue {
  return TR.Navigation.Mount(TR.Navigation.Configure(
    TR.Navigation.Declaration(name, TR.NavKind.Stack()),
    { Initial: initial },
  ))
}

function configuredBasicStack(
  name: string,
  initial: TR.Presentable | TR.NavigationValue,
  slots: { Title?: TR.Evaluable; Toolbar?: readonly TR.Command[] } = {},
): TR.NavigationValue {
  return TR.Navigation.Mount(TR.Navigation.Configure(
    TR.Navigation.Declaration(name, TR.NavKind.Basic.Stack()),
    { Initial: initial, ...slots },
  ))
}

function navigationCommand(definition: {
  enabled?: boolean
  icon?: string
  invoke(): unknown
  label: string
}): TR.Command {
  return TR.Interaction.Command({
    action: () => TR.Action(definition.invoke),
    members: {
      Enabled: () => TR.Value(definition.enabled ?? true),
      ...(definition.icon ? { Icon: () => TR.Value(definition.icon) } : {}),
      Label: () => TR.Value(definition.label),
    },
    name: definition.label,
  })
}

function restoreGlobalProperty(name: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor)
  } else {
    Reflect.deleteProperty(globalThis, name)
  }
}

function configuredSlot(
  name: string,
  initial: TR.Presentable | TR.NavigationValue,
): TR.NavigationValue {
  return TR.Navigation.Mount(TR.Navigation.Configure(
    TR.Navigation.Declaration(name, TR.NavKind.Slot()),
    { Initial: initial },
  ))
}

function configuredSelection(definition: {
  display: TR.Evaluable
  initial: string
  items: Record<string, { content: TR.Presentable | TR.NavigationValue; label: TR.Evaluable }>
  name: string
}): TR.NavigationValue {
  const items = Object.fromEntries(
    Object.entries(definition.items).map(([key, item]) => [
      `@${key}`,
      { Content: item.content, Label: item.label },
    ]),
  )
  return TR.Navigation.Mount(TR.Navigation.Configure(
    TR.Navigation.Declaration(definition.name, TR.NavKind.Selection()),
    {
      Display: definition.display,
      Initial: TR.Value(`@${definition.initial}`),
      ...items,
    },
  ))
}

registerRuntimeE2ELifecycle()

Describe('Expo runtime', () => {
  Test('resolves a configured nav declaration imported by its mounted screen', async () => {
    await testCompileFiles(
      'App.tao',
      {
        'App.tao': `
          use SlotNav, StackNav from @tao/nav
          use Home from ./Screen.tao

          workspace nav NestedStack = StackNav { Initial Home }

          app StableTargetApp {
            Name "Stable target"
            Navigator SlotNav { Initial NestedStack }
          }
        `,
        'Screen.tao': `
          use Col, FormButton, Text from @tao/ui
          use NestedStack from ./

          workspace scene Home() {
            Title "Home"
            action Open() { present Detail() in NestedStack }
            render Col() {
              Text("Home")
              FormButton("Open detail") { on press Open }
            }
          }

          scene Detail() { Title "Detail" render Text("Stable detail") }
        `,
      },
      async screen => {
        await fireEventAsync.press(screen.getByText('Open detail'))
        ExpectScreen(screen).toHaveText('Stable detail')
      },
    )
  })

  Test(
    'dispatches visible and hardware Back through the configured app reducer and cleans up its subscription',
    async () => {
      let handler: (() => boolean) | undefined
      let removes = 0
      const restoreReactNativeRuntime = jest.spyOn(TaoReactNative, 'requireReactNativeRuntime').mockReturnValue({
        ActivityIndicator: RN.ActivityIndicator,
        BackHandler: {
          addEventListener(event, nextHandler) {
            Expect(event).toBe('hardwareBackPress')
            handler = nextHandler
            return {
              remove: () => {
                removes += 1
              },
            }
          },
        },
        Image: RN.Image,
        KeyboardAvoidingView: RN.View,
        Pressable: RN.Pressable,
        ScrollView: RN.View,
        Switch: RN.Switch,
        Text: RN.Text,
        TextInput: RN.TextInput,
        View: RN.View,
      })

      try {
        const home = TR.Navigation.View({ name: 'Home', render: () => createElement(RN.Text, null, 'Home') })
        const windowRoot = TR.Navigation.View({
          name: 'Window root',
          render: () => createElement(RN.Text, null, 'Window root'),
        })
        const detail = TR.Navigation.View({ name: 'Detail', render: () => createElement(RN.Text, null, 'Detail') })
        const notice = TR.Navigation.View({ name: 'Notice', render: () => createElement(RN.Text, null, 'Notice') })
        const stack = configuredStack('HardwareBackTest', home)
        const window = configuredSlot('HardwareBackWindow', windowRoot)
        const app = TR.Navigation.App({
          name: 'Hardware Back App',
          navigator: () => stack,
          auxiliaries: () => ({ window }),
        })
        const screen = render(createElement(TR.Navigation.AppHost, { app }))

        Expect(handler?.()).toBe(false)
        act(() => {
          TR.Navigation.PresentIn(undefined, stack, detail, {})
          TR.Navigation.PresentOverlay(undefined, window, notice, {})
        })
        ExpectScreen(screen).toHaveText('Detail')
        ExpectScreen(screen).toHaveText('Notice')
        await fireEventAsync.press(screen.getByLabelText('Back'))
        Expect(screen.queryByText('Notice')).toBeNull()
        ExpectScreen(screen).toHaveText('Detail')
        let consumed = false
        act(() => {
          consumed = handler!()
        })
        Expect(consumed).toBe(true)
        ExpectScreen(screen).toHaveText('Home')
        Expect(screen.queryByText('Detail')).toBeNull()

        screen.unmount()
        Expect(removes).toBe(1)
      } finally {
        restoreReactNativeRuntime.mockRestore()
      }
    },
  )

  Test('mirrors browser Back, Forward, and ask response through the app reducer', async () => {
    let popState: ((event: { state: unknown }) => void) | undefined
    let removes = 0
    const pushes: unknown[] = []
    const replacements: unknown[] = []
    const goes: number[] = []
    let browserState: unknown = { router: 'preserved' }
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        addEventListener(event: string, listener: (event: { state: unknown }) => void) {
          Expect(event).toBe('popstate')
          popState = listener
        },
        history: {
          go: (delta: number) => goes.push(delta),
          pushState: (state: unknown) => {
            browserState = state
            pushes.push(state)
          },
          replaceState: (state: unknown) => {
            browserState = state
            replacements.push(state)
          },
          get state() {
            return browserState
          },
        },
        removeEventListener(event: string, listener: (event: { state: unknown }) => void) {
          Expect(event).toBe('popstate')
          if (popState === listener) {
            popState = undefined
          }
          removes += 1
        },
      },
    })

    try {
      const home = TR.Navigation.View({ name: 'Home', render: () => createElement(RN.Text, null, 'Home') })
      const detail = TR.Navigation.View({ name: 'Detail', render: () => createElement(RN.Text, null, 'Detail') })
      let responseProps: TR.TaoProps | undefined
      const confirm = TR.Navigation.View({
        name: 'Confirm',
        render: (_arguments, taoProps) => {
          responseProps = taoProps
          return createElement(RN.Text, null, 'Confirm')
        },
      })
      const stack = configuredStack('BrowserHistoryTest', home)
      const app = TR.Navigation.App({
        name: 'Browser History App',
        navigator: () => stack,
        auxiliaries: () => ({}),
      })
      const screen = render(createElement(TR.Navigation.AppHost, { app }))

      await act(async () => {
        TR.Navigation.PresentIn({ app, navigation: stack }, stack, detail, {})
      })
      ExpectScreen(screen).toHaveText('Detail')
      Expect(replacements[0]).toMatchObject({
        __taoNavigation: [Expect['any'](String), 0],
        router: 'preserved',
      })
      Expect(pushes[0]).toMatchObject({
        __taoNavigation: [Expect['any'](String), 1],
        router: 'preserved',
      })

      await act(async () => popState?.({ state: replacements[0] }))
      ExpectScreen(screen).toHaveText('Home')
      await act(async () => popState?.({ state: pushes[0] }))
      ExpectScreen(screen).toHaveText('Detail')

      let answer: Promise<TR.Evaluable>
      await act(async () => {
        answer = TR.Navigation.Ask({ app, navigation: stack }, confirm, {})
      })
      ExpectScreen(screen).toHaveText('Confirm')
      await act(async () => TR.Navigation.Respond(responseProps))
      Expect((await answer!).evaluate().jsValue).toBe(null)
      Expect(goes).toEqual([-1])
      await act(async () => popState?.({ state: pushes[0] }))
      await act(async () => popState?.({ state: pushes[1] }))
      ExpectScreen(screen).toHaveText('Detail')
      Expect(screen.queryByText('Confirm')).toBeNull()
      Expect(replacements.at(-1)).toMatchObject({
        __taoNavigation: [Expect['any'](String), 1],
        router: 'preserved',
      })

      screen.unmount()
      Expect(removes).toBe(1)
    } finally {
      if (originalWindow) {
        Object.defineProperty(globalThis, 'window', originalWindow)
      } else {
        Reflect.deleteProperty(globalThis, 'window')
      }
    }
  })

  Test('keeps one visible Back affordance above a covered depth-two stack', async () => {
    const home = TR.Navigation.View({ name: 'Home', render: () => createElement(RN.Text, null, 'Home') })
    const detail = TR.Navigation.View({ name: 'Detail', render: () => createElement(RN.Text, null, 'Detail') })
    const notice = TR.Navigation.View({ name: 'Notice', render: () => createElement(RN.Text, null, 'Notice') })
    const stack = configuredBasicStack('Covered stack', home)
    const app = TR.Navigation.App({ name: 'Covered stack app', navigator: () => stack, auxiliaries: () => ({}) })
    const screen = render(createElement(TR.Navigation.AppHost, { app }))

    act(() => stack.present(detail, {}))
    act(() => stack.presentOverlay(notice, {}))
    ExpectScreen(screen).toHaveText('Notice')
    Expect(screen.getAllByLabelText('Back')).toHaveLength(1)

    await fireEventAsync.press(screen.getByLabelText('Back'))
    Expect(screen.queryByText('Notice')).toBeNull()
    ExpectScreen(screen).toHaveText('Detail')
    Expect(screen.getAllByLabelText('Back')).toHaveLength(1)
  })

  Test('marks covered basic stack content inactive for navigators rendered inside it', () => {
    const activity = new Map<string, boolean | undefined>()
    const presentable = (name: string) =>
      TR.Navigation.View({
        name,
        render: (_arguments, taoProps) => {
          activity.set(name, taoProps?.navigationHostActive)
          return createElement(RN.Text, null, name)
        },
      })
    const stack = configuredBasicStack('Retained activity', presentable('Home'))
    stack.present(presentable('Detail'), {})

    const screen = render(stack.render() as ReactElement)

    Expect(activity).toEqual(new Map([['Home', false], ['Detail', true]]))
    screen.unmount()
  })

  Test('centralizes same-URL web history and reduces auxiliary overlays before navigator entries', async () => {
    const popListeners = new Set<(event: { state?: unknown }) => void>()
    const pushes: unknown[] = []
    const replacements: unknown[] = []
    const goes: number[] = []
    const previousHistory = Object.getOwnPropertyDescriptor(globalThis, 'history')
    const previousAdd = Object.getOwnPropertyDescriptor(globalThis, 'addEventListener')
    const previousRemove = Object.getOwnPropertyDescriptor(globalThis, 'removeEventListener')
    Object.defineProperty(globalThis, 'history', {
      configurable: true,
      value: {
        go: (delta: number) => goes.push(delta),
        pushState: (state: unknown, unused: string) => {
          Expect(unused).toBe('')
          pushes.push(state)
        },
        replaceState: (state: unknown, unused: string) => {
          Expect(unused).toBe('')
          replacements.push(state)
        },
      },
    })
    Object.defineProperty(globalThis, 'addEventListener', {
      configurable: true,
      value: (name: string, listener: (event: { state?: unknown }) => void) => {
        if (name === 'popstate') {
          popListeners.add(listener)
        }
      },
    })
    Object.defineProperty(globalThis, 'removeEventListener', {
      configurable: true,
      value: (name: string, listener: (event: { state?: unknown }) => void) => {
        if (name === 'popstate') {
          popListeners.delete(listener)
        }
      },
    })
    const restoreRuntime = jest.spyOn(TaoReactNative, 'requireReactNativeRuntime').mockReturnValue({
      ActivityIndicator: RN.ActivityIndicator,
      Image: RN.Image,
      KeyboardAvoidingView: RN.KeyboardAvoidingView,
      Modal: RN.Modal,
      Platform: { OS: 'web' },
      Pressable: RN.Pressable,
      ScrollView: RN.ScrollView,
      Switch: RN.Switch,
      Text: RN.Text,
      TextInput: RN.TextInput,
      View: RN.View,
    })
    let screen: ReturnType<typeof render> | undefined
    let otherScreen: ReturnType<typeof render> | undefined
    try {
      const home = TR.Navigation.View({ name: 'Web home', render: () => createElement(RN.Text, null, 'Web home') })
      const detail = TR.Navigation.View({
        name: 'Web detail',
        render: () => createElement(RN.Text, null, 'Web detail'),
      })
      const secondDetail = TR.Navigation.View({
        name: 'Web second detail',
        render: () => createElement(RN.Text, null, 'Web second detail'),
      })
      const thirdDetail = TR.Navigation.View({
        name: 'Web third detail',
        render: () => createElement(RN.Text, null, 'Web third detail'),
      })
      const windowRoot = TR.Navigation.View({
        name: 'Web window',
        render: () => createElement(RN.Text, null, 'Web window'),
      })
      const notice = TR.Navigation.View({
        name: 'Web notice',
        render: () => createElement(RN.Text, null, 'Web notice'),
      })
      const stack = configuredBasicStack('Web stack', home)
      const window = configuredSlot('Web auxiliary', windowRoot)
      const app = TR.Navigation.App({
        name: 'Web app',
        navigator: () => stack,
        auxiliaries: () => ({ window }),
      })
      screen = render(createElement(TR.Navigation.AppHost, { app }))
      Expect(popListeners.size).toBe(1)
      Expect(replacements.length).toBeGreaterThan(0)

      act(() => TR.Navigation.PresentIn(undefined, stack, detail, {}))
      act(() => TR.Navigation.PresentOverlay(undefined, window, notice, {}))
      Expect(pushes).toHaveLength(2)
      ExpectScreen(screen).toHaveText('Web detail')
      ExpectScreen(screen).toHaveText('Web notice')

      act(() => popListeners.values().next().value!({ state: pushes[0] }))
      Expect(screen.queryByText('Web notice')).toBeNull()
      ExpectScreen(screen).toHaveText('Web detail')
      act(() => popListeners.values().next().value!({ state: replacements[0] }))
      Expect(screen.queryByText('Web detail')).toBeNull()
      ExpectScreen(screen).toHaveText('Web home')

      act(() => TR.Navigation.PresentIn(undefined, stack, detail, {}))

      const otherHome = TR.Navigation.View({
        name: 'Other web home',
        render: () => createElement(RN.Text, null, 'Other web home'),
      })
      const otherDetail = TR.Navigation.View({
        name: 'Other web detail',
        render: () => createElement(RN.Text, null, 'Other web detail'),
      })
      const otherStack = configuredBasicStack('Other web stack', otherHome)
      const otherApp = TR.Navigation.App({
        name: 'Other web app',
        navigator: () => otherStack,
        auxiliaries: () => ({}),
      })
      const pushesBeforeOtherHost = pushes.length
      otherScreen = render(createElement(TR.Navigation.AppHost, { app: otherApp }))
      Expect(popListeners.size).toBe(2)

      // Only the most recently mounted host owns browser entries. The retained host still updates
      // semantically, then resumes ownership at its current depth when the active host unmounts.
      act(() => TR.Navigation.PresentIn(undefined, stack, secondDetail, {}))
      Expect(pushes).toHaveLength(pushesBeforeOtherHost)
      act(() => TR.Navigation.PresentIn(undefined, otherStack, otherDetail, {}))
      Expect(pushes).toHaveLength(pushesBeforeOtherHost + 1)
      otherScreen.unmount()
      otherScreen = undefined
      Expect(popListeners.size).toBe(1)
      const pushesAfterResume = pushes.length
      act(() => TR.Navigation.PresentIn(undefined, stack, thirdDetail, {}))
      Expect(pushes).toHaveLength(pushesAfterResume + 1)

      Expect(popListeners.size).toBe(1)
      screen.unmount()
      screen = undefined
      Expect(popListeners.size).toBe(0)
    } finally {
      otherScreen?.unmount()
      screen?.unmount()
      restoreRuntime.mockRestore()
      restoreGlobalProperty('history', previousHistory)
      restoreGlobalProperty('addEventListener', previousAdd)
      restoreGlobalProperty('removeEventListener', previousRemove)
    }
  })

  Test('layers stacked StackNav overlays absolutely and preserves covered overlay state', async () => {
    function StatefulOverlay(): ReactElement {
      const [count, setCount] = useState(0)
      return createElement(
        RN.View,
        null,
        createElement(RN.Text, null, `Overlay count ${count}`),
        createElement(RN.Pressable, {
          accessibilityLabel: 'Increment overlay',
          onPress: () => setCount(value => value + 1),
        }),
      )
    }

    const home = TR.Navigation.View({ name: 'Home', render: () => createElement(RN.Text, null, 'Home') })
    const first = TR.Navigation.View({ name: 'First overlay', render: () => createElement(StatefulOverlay) })
    const second = TR.Navigation.View({
      name: 'Second overlay',
      render: () => createElement(RN.Text, null, 'Second overlay'),
    })
    const stack = configuredStack('OverlayHostStack', home)
    const app = TR.Navigation.App({
      name: 'Overlay Host App',
      navigator: () => stack,
      auxiliaries: () => ({}),
    })
    const screen = render(createElement(TR.Navigation.AppHost, { app }))

    act(() => {
      TR.Navigation.PresentOverlay(undefined, stack, first, {})
    })
    const baseContent = screen.UNSAFE_getAllByType(RN.View).find(
      view => view.props.testID === navigationContentAccessibilityTestId,
    )!
    Expect(baseContent.props.accessibilityElementsHidden).toBe(false)
    Expect(baseContent.props.importantForAccessibility).toBe('auto')
    await fireEventAsync.press(screen.getByLabelText('Increment overlay'))
    ExpectScreen(screen).toHaveText('Overlay count 1')

    act(() => {
      TR.Navigation.PresentOverlay(undefined, stack, second, {})
    })
    ExpectScreen(screen).toHaveText('Second overlay')
    Expect(screen.queryByLabelText('Increment overlay')).toBeNull()
    const styles = screen.UNSAFE_getAllByType(RN.View).map(view => RN.StyleSheet.flatten(view.props.style))
    Expect(styles.some(style => style?.position === 'relative')).toBe(true)
    Expect(styles.some(style =>
      style?.position === 'absolute'
      && style.top === 0
      && style.right === 0
      && style.bottom === 0
      && style.left === 0
      && style.zIndex === 1
    )).toBe(true)

    await fireEventAsync.press(screen.getByLabelText('Back'))
    Expect(screen.queryByText('Second overlay')).toBeNull()
    ExpectScreen(screen).toHaveText('Overlay count 1')
    await fireEventAsync.press(screen.getByLabelText('Back'))
    Expect(screen.queryByText('Overlay count 1')).toBeNull()
    ExpectScreen(screen).toHaveText('Home')
  })

  Test('reconciles native sheet dismissal through the owning app history funnel', async () => {
    const home = TR.Navigation.View({ name: 'Home', render: () => createElement(RN.Text, null, 'Home') })
    const sheet = TR.Navigation.View({ name: 'Sheet', render: () => createElement(RN.Text, null, 'Sheet') })
    const stack = configuredStack('Sheet dismissal stack', home)
    const app = TR.Navigation.App({
      name: 'Sheet dismissal app',
      navigator: () => stack,
      auxiliaries: () => ({}),
    })
    const dismiss = jest.spyOn(app, 'dismiss')
    const goes: number[] = []
    app.attachBrowserHistory({
      go: delta => goes.push(delta),
      push: () => {},
      replace: () => {},
      subscribe: () => () => {},
    })
    const screen = render(createElement(TR.Navigation.AppHost, { app }))

    await act(async () => {
      TR.Navigation.PresentOverlay({ app, navigation: stack }, stack, sheet, {}, { sheet: true })
    })
    const baseContent = screen.UNSAFE_getAllByType(RN.View).find(
      view => view.props.testID === navigationContentAccessibilityTestId,
    )!
    Expect(baseContent.props.accessibilityElementsHidden).toBe(true)
    Expect(baseContent.props.importantForAccessibility).toBe('no-hide-descendants')
    const modalSurfaces = screen.UNSAFE_getAllByType(RN.View).filter(
      view => view.props.accessibilityViewIsModal === true,
    )
    Expect(modalSurfaces).toHaveLength(1)
    Expect(modalSurfaces[0]?.props.onAccessibilityEscape).toEqual(expect.any(Function))
    await act(async () => {
      screen.UNSAFE_getByType(RN.Modal).props.onRequestClose()
    })

    Expect(dismiss).toHaveBeenCalledTimes(1)
    Expect(goes).toEqual([-1])
    ExpectScreen(screen).toHaveText('Home')

    await act(async () => {
      TR.Navigation.PresentOverlay({ app, navigation: stack }, stack, sheet, {}, { sheet: true })
    })
    await act(async () => {
      screen.UNSAFE_getAllByType(RN.View).find(
        view => view.props.accessibilityViewIsModal === true,
      )?.props.onAccessibilityEscape()
    })

    Expect(dismiss).toHaveBeenCalledTimes(2)
    Expect(goes).toEqual([-1])
    ExpectScreen(screen).toHaveText('Home')
  })

  Test('contains stacked asks and dismisses only the top ask through accessibility escape', async () => {
    const home = TR.Navigation.View({ name: 'Home', render: () => createElement(RN.Text, null, 'Home') })
    const confirm = TR.Navigation.View({
      name: 'Confirm',
      render: arguments_ => createElement(RN.Text, null, `Question ${arguments_['Title']?.evaluate().jsValue}`),
    })
    const stack = configuredStack('Accessible ask stack', home)
    const app = TR.Navigation.App({
      name: 'Accessible ask app',
      navigator: () => stack,
      auxiliaries: () => ({}),
    })
    const dismiss = jest.spyOn(app, 'dismiss')
    const screen = render(createElement(TR.Navigation.AppHost, { app }))
    let first!: Promise<{ evaluate(): { jsValue: unknown } }>
    let second!: Promise<{ evaluate(): { jsValue: unknown } }>

    await act(async () => {
      first = TR.Navigation.Ask(
        { app, navigation: stack },
        confirm,
        { Title: TR.Value('First') },
      )
      second = TR.Navigation.Ask(
        { app, navigation: stack },
        confirm,
        { Title: TR.Value('Second') },
      )
    })

    const baseContent = screen.UNSAFE_getAllByType(RN.View).find(
      view => view.props.testID === navigationContentAccessibilityTestId,
    )!
    Expect(baseContent.props.accessibilityElementsHidden).toBe(true)
    Expect(baseContent.props.importantForAccessibility).toBe('no-hide-descendants')
    ExpectScreen(screen).toHaveText('Question Second')
    Expect(screen.queryByText('Question First')).toBeNull()
    const activeSurface = screen.UNSAFE_getAllByType(RN.View).filter(
      view => view.props.accessibilityViewIsModal === true,
    )
    Expect(activeSurface).toHaveLength(1)

    await act(async () => {
      activeSurface[0]?.props.onAccessibilityEscape()
    })
    Expect(dismiss).toHaveBeenCalledTimes(1)
    Expect((await second).evaluate().jsValue).toBe(null)
    ExpectScreen(screen).toHaveText('Question First')
    Expect(
      screen.UNSAFE_getAllByType(RN.View).filter(
        view => view.props.accessibilityViewIsModal === true,
      ),
    ).toHaveLength(1)

    await act(async () => {
      screen.UNSAFE_getAllByType(RN.View).find(
        view => view.props.accessibilityViewIsModal === true,
      )?.props.onAccessibilityEscape()
    })
    Expect(dismiss).toHaveBeenCalledTimes(2)
    Expect((await first).evaluate().jsValue).toBe(null)
    ExpectScreen(screen).toHaveText('Home')
    Expect(baseContent.props.accessibilityElementsHidden).toBe(false)
    Expect(baseContent.props.importantForAccessibility).toBe('auto')
  })

  Test('contains and accessibility-dismisses a sheet without a native Modal host', async () => {
    const restoreRuntime = jest.spyOn(TaoReactNative, 'requireReactNativeRuntime').mockReturnValue({
      ActivityIndicator: RN.ActivityIndicator,
      Image: RN.Image,
      KeyboardAvoidingView: RN.KeyboardAvoidingView,
      Platform: { OS: 'web' },
      Pressable: RN.Pressable,
      ScrollView: RN.ScrollView,
      Switch: RN.Switch,
      Text: RN.Text,
      TextInput: RN.TextInput,
      View: RN.View,
    })
    try {
      const home = TR.Navigation.View({ name: 'Home', render: () => createElement(RN.Text, null, 'Home') })
      const sheet = TR.Navigation.View({ name: 'Sheet', render: () => createElement(RN.Text, null, 'Sheet') })
      const stack = configuredStack('Inline accessible sheet stack', home)
      const app = TR.Navigation.App({
        name: 'Inline accessible sheet app',
        navigator: () => stack,
        auxiliaries: () => ({}),
      })
      const dismiss = jest.spyOn(app, 'dismiss')
      const screen = render(createElement(TR.Navigation.AppHost, { app }))

      await act(async () => {
        TR.Navigation.PresentOverlay({ app, navigation: stack }, stack, sheet, {}, { sheet: true })
      })

      const baseContent = screen.UNSAFE_getAllByType(RN.View).find(
        view => view.props.testID === navigationContentAccessibilityTestId,
      )!
      Expect(baseContent.props.accessibilityElementsHidden).toBe(true)
      Expect(baseContent.props.importantForAccessibility).toBe('no-hide-descendants')
      const activeSurface = screen.UNSAFE_getAllByType(RN.View).filter(
        view => view.props.accessibilityViewIsModal === true,
      )
      Expect(activeSurface).toHaveLength(1)

      await act(async () => {
        activeSurface[0]?.props.onAccessibilityEscape()
      })
      Expect(dismiss).toHaveBeenCalledTimes(1)
      ExpectScreen(screen).toHaveText('Home')
      Expect(baseContent.props.accessibilityElementsHidden).toBe(false)
      Expect(baseContent.props.importantForAccessibility).toBe('auto')
    } finally {
      restoreRuntime.mockRestore()
    }
  })

  Test('stacks independent asked view occurrences and settles only their own suspended asks', async () => {
    const home = TR.Navigation.View({ name: 'Home', render: () => createElement(RN.Text, null, 'Home') })
    const occurrenceProps = new Map<string, TR.TaoProps | undefined>()
    const confirm = TR.Navigation.View({
      name: 'Confirm',
      render: (arguments_, taoProps) => {
        const title = String(arguments_['Title']?.evaluate().jsValue)
        occurrenceProps.set(title, taoProps)
        return createElement(
          RN.Pressable,
          {
            accessibilityLabel: `Respond ${title}`,
            onPress: () => TR.Navigation.Respond(taoProps, arguments_['Result']),
          },
          createElement(RN.Text, null, `Question ${title}`),
        )
      },
    })
    const stack = configuredStack('AskHostStack', home)
    const app = TR.Navigation.App({
      name: 'Ask Host App',
      navigator: () => stack,
      auxiliaries: () => ({}),
    })
    const screen = render(createElement(TR.Navigation.AppHost, { app }))
    let first!: Promise<{ evaluate(): { jsValue: unknown } }>
    let second!: Promise<{ evaluate(): { jsValue: unknown } }>

    await act(async () => {
      first = TR.Navigation.Ask(
        { navigation: stack },
        confirm,
        { Result: TR.Value('first'), Title: TR.Value('First') },
      )
      second = TR.Navigation.Ask(
        { navigation: stack },
        confirm,
        { Result: TR.Value('second'), Title: TR.Value('Second') },
      )
    })
    ExpectScreen(screen).toHaveText('Question Second')
    Expect(screen.queryByText('Question First')).toBeNull()

    await act(async () => {
      TR.Navigation.Respond(occurrenceProps.get('First'), TR.Value('first-covered'))
    })
    Expect((await first).evaluate().jsValue).toBe('first-covered')
    ExpectScreen(screen).toHaveText('Question Second')

    await fireEventAsync.press(screen.getByLabelText('Back'))
    Expect((await second).evaluate().jsValue).toBe(null)
    Expect(screen.queryByText('Question Second')).toBeNull()
    ExpectScreen(screen).toHaveText('Home')
  })

  Test('replaces keyed app toasts, coexists across keys, restarts expiry, and ignores Back', async () => {
    jest.useFakeTimers()
    try {
      const home = TR.Navigation.View({ name: 'Home', render: () => createElement(RN.Text, null, 'Home') })
      const toast = (name: string, text: string) =>
        TR.Navigation.View({ name, render: () => createElement(RN.Text, null, text) })
      const first = toast('First saved', 'First saved')
      const replacement = toast('Replacement saved', 'Replacement saved')
      const other = toast('Other notice', 'Other notice')
      const zero = toast('Zero notice', 'Zero notice')
      const stack = configuredStack('Toast host', home)
      const app = TR.Navigation.App({ name: 'Toast App', navigator: () => stack, auxiliaries: () => ({}) })
      const screen = render(createElement(TR.Navigation.AppHost, { app }))
      const taoProps: TR.TaoProps = { app }

      // A toast duration is a Tao duration, carried in the family's base unit of nanoseconds.
      const seconds = (count: number) => TR.Value(count * 1e9)
      act(() => {
        TR.Navigation.PresentToast(taoProps, first, {}, {
          duration: seconds(3),
          key: TR.Value('saved'),
        })
        TR.Navigation.PresentToast(taoProps, other, {}, {
          duration: seconds(10),
          key: TR.Value('other'),
        })
      })
      ExpectScreen(screen).toHaveText('First saved')
      ExpectScreen(screen).toHaveText('Other notice')
      Expect(app.back()).toBe(false)
      Expect(screen.queryByLabelText('Back')).toBeNull()
      const toastStyles = screen.UNSAFE_getAllByType(RN.View).map(view => RN.StyleSheet.flatten(view.props.style))
      Expect(toastStyles.some(style =>
        style?.position === 'absolute'
        && style.right === 0
        && style.bottom === 0
        && style.left === 0
        && style.zIndex === 2
      )).toBe(true)

      act(() => {
        jest.advanceTimersByTime(2_000)
        TR.Navigation.PresentToast(taoProps, replacement, {}, {
          duration: seconds(3),
          key: TR.Value('saved'),
        })
      })
      Expect(screen.queryByText('First saved')).toBeNull()
      ExpectScreen(screen).toHaveText('Replacement saved')
      ExpectScreen(screen).toHaveText('Other notice')

      act(() => jest.advanceTimersByTime(1_001))
      ExpectScreen(screen).toHaveText('Replacement saved')
      act(() => jest.advanceTimersByTime(2_000))
      Expect(screen.queryByText('Replacement saved')).toBeNull()
      ExpectScreen(screen).toHaveText('Other notice')

      act(() => {
        TR.Navigation.PresentToast(taoProps, zero, {}, {
          duration: seconds(0),
          key: TR.Value('zero'),
        })
      })
      ExpectScreen(screen).toHaveText('Zero notice')
      act(() => jest.advanceTimersByTime(0))
      Expect(screen.queryByText('Zero notice')).toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })

  Test('resolves contextual overlays to a SlotNav and dismisses its overlay stack before content', async () => {
    const first = TR.Navigation.View({
      name: 'Slot overlay one',
      render: () => createElement(RN.Text, null, 'Slot overlay one'),
    })
    const second = TR.Navigation.View({
      name: 'Slot overlay two',
      render: () => createElement(RN.Text, null, 'Slot overlay two'),
    })
    const home = TR.Navigation.View({
      name: 'Slot home',
      render: (_arguments, taoProps) =>
        createElement(RN.Pressable, {
          accessibilityLabel: 'Open slot overlay',
          onPress: () => TR.Navigation.PresentOverlay(taoProps, undefined, first, {}),
        }, createElement(RN.Text, null, 'Slot home')),
    })
    const slot = configuredSlot('OverlayHostSlot', home)
    const app = TR.Navigation.App({
      name: 'Slot Overlay Host App',
      navigator: () => slot,
      auxiliaries: () => ({}),
    })
    const screen = render(createElement(TR.Navigation.AppHost, { app }))

    await fireEventAsync.press(screen.getByLabelText('Open slot overlay'))
    act(() => {
      TR.Navigation.PresentOverlay(undefined, slot, second, {})
    })
    ExpectScreen(screen).toHaveText('Slot overlay two')
    Expect(screen.queryByText('Slot overlay one')).toBeNull()
    await fireEventAsync.press(screen.getByLabelText('Back'))
    ExpectScreen(screen).toHaveText('Slot overlay one')
    await fireEventAsync.press(screen.getByLabelText('Back'))
    ExpectScreen(screen).toHaveText('Slot home')
    Expect(slot.back()).toBe(false)
  })

  Test('inherits contextual present, overlay, and dismiss through nested generated view props', async () => {
    function NestedNavigationAction(props: {
      __tao?: TR.TaoProps
      label: string
      invoke(taoProps: TR.TaoProps): void
    }): ReactElement {
      const nestedProps = TR.TaoProps({ ...TR.TaoContext(props.__tao) })
      return createElement(RN.Pressable, {
        accessibilityLabel: props.label,
        onPress: () => props.invoke(nestedProps),
      })
    }

    function GeneratedViewBoundary(props: {
      __tao?: TR.TaoProps
      label: string
      invoke(taoProps: TR.TaoProps): void
    }): ReactElement {
      return createElement(NestedNavigationAction, {
        __tao: TR.TaoProps({ ...TR.TaoContext(props.__tao) }),
        label: props.label,
        invoke: props.invoke,
      })
    }

    const detail = TR.Navigation.View({
      name: 'Nested detail',
      render: (_arguments, taoProps) =>
        createElement(GeneratedViewBoundary, {
          __tao: taoProps,
          invoke: props => TR.Navigation.Dismiss(props),
          label: 'Dismiss nested detail',
        }),
    })
    const overlay = TR.Navigation.View({
      name: 'Nested overlay',
      render: (_arguments, taoProps) =>
        createElement(
          RN.View,
          null,
          createElement(RN.Text, null, 'Nested overlay'),
          createElement(GeneratedViewBoundary, {
            __tao: taoProps,
            invoke: props => TR.Navigation.Dismiss(props),
            label: 'Dismiss nested overlay',
          }),
        ),
    })
    const home = TR.Navigation.View({
      name: 'Nested home',
      render: (_arguments, taoProps) =>
        createElement(
          RN.View,
          null,
          createElement(RN.Text, null, 'Nested home'),
          createElement(GeneratedViewBoundary, {
            __tao: taoProps,
            invoke: props => TR.Navigation.PresentIn(props, undefined, detail, {}),
            label: 'Open nested detail',
          }),
          createElement(GeneratedViewBoundary, {
            __tao: taoProps,
            invoke: props => TR.Navigation.PresentOverlay(props, undefined, overlay, {}),
            label: 'Open nested overlay',
          }),
        ),
    })
    const stack = configuredStack('Nested context stack', home)
    const app = TR.Navigation.App({
      name: 'Nested context app',
      navigator: () => stack,
      auxiliaries: () => ({}),
    })
    const screen = render(createElement(TR.Navigation.AppHost, { app }))

    await fireEventAsync.press(screen.getByLabelText('Open nested detail'))
    Expect(screen.queryByText('Nested home')).toBeNull()
    await fireEventAsync.press(screen.getByLabelText('Dismiss nested detail'))
    ExpectScreen(screen).toHaveText('Nested home')

    await fireEventAsync.press(screen.getByLabelText('Open nested overlay'))
    ExpectScreen(screen).toHaveText('Nested overlay')
    await fireEventAsync.press(screen.getByLabelText('Dismiss nested overlay'))
    Expect(screen.queryByText('Nested overlay')).toBeNull()
    ExpectScreen(screen).toHaveText('Nested home')
  })

  Test('carries compiled ambient context through nested views without carrying caller layout', async () => {
    await testCompileApp(
      `
        use StackNav from @tao/nav
        use Button, Col, Text from @tao/ui

        app NestedAmbientApp {
          Name "Nested ambient context"
          Navigator StackNav { Initial Home }
        }

        type ConfirmResult is one of Confirmed

        scene Home() { Title "Home" render Wrapper()[gap 9] }

        view Wrapper() {
          render Col() {
            Editor()
          }
        }

        view Editor() {
          state Status = "Ready"
          action Open() {
            let Result = ask Confirm()
            if Result is Confirmed { set Status = "Confirmed" }
          }
          render Col() {
            Text(Status)
            Button("Open nested ask") { on press Open }
          }
        }

        view Confirm() responds ConfirmResult {
          action ConfirmIt() { respond Confirmed }
          render Col() {
            Text("Nested ask")
            Button("Confirm nested ask") { on press ConfirmIt }
          }
        }
      `,
      async screen => {
        const gapNineViews = screen.UNSAFE_getAllByType(RN.View).filter(view => {
          const style = RN.StyleSheet.flatten(view.props.style)
          return style?.gap === 9
        })
        Expect(gapNineViews).toHaveLength(1)

        fireEvent.press(screen.getByText('Open nested ask'))
        await act(async () => {})
        ExpectScreen(screen).toHaveText('Nested ask')
        await fireEventAsync.press(screen.getByText('Confirm nested ask'))
        await act(async () => {})
        Expect(screen.queryByText('Nested ask')).toBeNull()
        ExpectScreen(screen).toHaveText('Confirmed')
      },
    )
  })

  Test(
    'keeps covered navigation entries mounted and returns through the accessible root-safe back reducer',
    async () => {
      let stack: TR.NavigationValue

      function Home(): ReactElement {
        const [count, setCount] = useState(0)
        return createElement(
          RN.View,
          null,
          createElement(RN.Text, null, `Home count ${count}`),
          createElement(RN.Pressable, {
            accessibilityLabel: 'Increment home',
            onPress: () => setCount(value => value + 1),
          }),
          createElement(RN.Pressable, {
            accessibilityLabel: 'Open detail',
            onPress: () => TR.Navigation.PresentIn(undefined, stack, detail, {}),
          }),
        )
      }

      const home = TR.Navigation.View({ name: 'Home', render: () => createElement(Home) })
      const detail = TR.Navigation.View({ name: 'Detail', render: () => createElement(RN.Text, null, 'Detail') })
      stack = configuredStack('RuntimeNavigationHostTest', home)
      const app = TR.Navigation.App({
        name: 'Runtime Navigation Host App',
        navigator: () => stack,
        auxiliaries: () => ({}),
      })

      const screen = render(createElement(TR.Navigation.AppHost, { app }))
      await fireEventAsync.press(screen.getByLabelText('Increment home'))
      ExpectScreen(screen).toHaveText('Home count 1')

      await fireEventAsync.press(screen.getByLabelText('Open detail'))
      ExpectScreen(screen).toHaveText('Detail')
      Expect(screen.queryByLabelText('Increment home')).toBeNull()
      await fireEventAsync.press(screen.getByLabelText('Back'))

      ExpectScreen(screen).toHaveText('Home count 1')
      Expect(screen.queryByLabelText('Back')).toBeNull()
      Expect(stack.back()).toBe(false)
    },
  )

  Test('renders keyed selection labels and preserves inactive item state', async () => {
    function StatefulHome(): ReactElement {
      const [count, setCount] = useState(0)
      return createElement(
        RN.View,
        null,
        createElement(RN.Text, null, `Home count ${count}`),
        createElement(RN.Pressable, {
          accessibilityLabel: 'Increment selection home',
          onPress: () => setCount(value => value + 1),
        }),
      )
    }

    const home = TR.Navigation.View({ name: 'Home', render: () => createElement(StatefulHome) })
    const settings = TR.Navigation.View({
      name: 'Settings',
      render: () => createElement(RN.Text, null, 'Settings content'),
    })
    const selection = configuredSelection({
      display: TR.Value('tabs'),
      initial: 'home',
      items: {
        home: { content: home, label: TR.Value('Home') },
        settings: { content: settings, label: TR.Value('Settings') },
      },
      name: 'Runtime Selection',
    })
    const app = TR.Navigation.App({
      name: 'Runtime Selection App',
      navigator: () => selection,
      auxiliaries: () => ({}),
    })
    const screen = render(createElement(TR.Navigation.AppHost, { app }))

    ExpectScreen(screen).toHaveText('Home')
    ExpectScreen(screen).toHaveText('Settings')
    ExpectScreen(screen).toHaveText('Home count 0')
    await fireEventAsync.press(screen.getByLabelText('Increment selection home'))
    ExpectScreen(screen).toHaveText('Home count 1')

    await fireEventAsync.press(screen.getByText('Settings'))
    ExpectScreen(screen).toHaveText('Settings content')
    Expect(screen.queryByLabelText('Increment selection home')).toBeNull()
    Expect(screen.queryByLabelText('Back')).toBeNull()

    await fireEventAsync.press(screen.getByText('Home'))
    ExpectScreen(screen).toHaveText('Home count 1')
    act(() => TR.Navigation.Activate({ app }, app, 'settings'))
    ExpectScreen(screen).toHaveText('Settings content')
    Expect(screen.queryByLabelText('Back')).toBeNull()
  })

  Test('keeps same-named generated app targets bound to their declaring module', async () => {
    const appSource = (label: string) => `
      use SlotNav, StackNav from @tao/nav
      use Col, FormButton, Text from @tao/ui

      app SharedGeneratedApp {
        Name "${label}"
        Navigator StackNav { Initial Home }
        @window SlotNav { Initial WindowRoot }
      }

      workspace scene Home() {
        Title "${label} home"
        action Open() {
          present Notice() in SharedGeneratedApp@window
        }
        render Col() {
          Text("${label} home")
          FormButton("Open ${label}") { on press Open }
        }
      }

      workspace view Notice() {
        render Text("${label} notice")
      }

      workspace view WindowRoot() {
        render Text("${label} window")
      }
    `

    await withTaoFiles('tao-runtime-first-app-identity-', {
      'App.tao': appSource('First'),
      'Project.tao': 'project { id "runtime-first" name "Runtime first" }',
    }, async firstPaths => {
      const first = await compileAndRenderApp(firstPaths['App.tao']!)
      await withTaoFiles(
        'tao-runtime-second-app-identity-',
        {
          'App.tao': appSource('Second'),
          'Project.tao': 'project { id "runtime-second" name "Runtime second" }',
        },
        async secondPaths => {
          let generatedRoot: string | undefined
          let primaryFailure: unknown
          try {
            generatedRoot = await FS.mkTmpDir('tao-runtime-app-identity-')
            await FS.symlink(
              FS.resolvePath('node_modules', RuntimeToolchainPaths.packageRoot),
              FS.resolvePath('node_modules', generatedRoot),
            )
            const second = await RuntimeTesting.TestCompiler.Worker.compileApp(secondPaths['App.tao']!, {
              runtimePackageRoot: generatedRoot,
            })
            // Evaluating the second generated module used to overwrite the first app's name-table entry.
            Expect((require(second.testAppPath) as { default?: unknown }).default).toBeDefined()

            await fireEventAsync.press(first.getByText('Open First'))
            ExpectScreen(first).toHaveText('First notice')
          } catch (error) {
            primaryFailure = error
            throw error
          } finally {
            if (generatedRoot !== undefined) {
              try {
                await FS.remove(generatedRoot)
              } catch (error) {
                if (primaryFailure === undefined) {
                  throw error
                }
                HCI.logProcessError(
                  'runtime-app-identity-cleanup',
                  `Cleanup also failed after the primary runtime failure: ${Errors.formatForLog(error)}`,
                )
              }
            }
          }
        },
      )
    })
  })

  Test('inherits generated app context for keyed toast presentation from a nested view', async () => {
    await testCompileApp(
      `
        use StackNav from @tao/nav
        use Col, FormButton, Text from @tao/ui

        app ToastApp {
          Name "Toast App"
          Navigator StackNav { Initial Home }
        }

        scene Home() { Title "Home" render Editor() }

        view Editor() {
          action Save() {
            present SavedToast() as toast (Key: "saved", Duration: 1.s)
          }
          render Col() {
            FormButton("Save") { on press Save }
          }
        }

        view SavedToast() { render Text("Saved") }
      `,
      async screen => {
        jest.useFakeTimers()
        try {
          await fireEventAsync.press(screen.getByText('Save'))
          ExpectScreen(screen).toHaveText('Saved')
          Expect(screen.queryByLabelText('Back')).toBeNull()
          act(() => jest.advanceTimersByTime(1_000))
          Expect(screen.queryByText('Saved')).toBeNull()
        } finally {
          jest.useRealTimers()
        }
      },
    )
  })

  Test('publishes reactive direct-view chrome with icons and deterministic Basic overflow', async () => {
    function Descendant(): ReactElement {
      TR.Navigation.UseHostSlots(undefined, { Title: () => TR.Value('Descendant must not publish') })
      return createElement(RN.Text, null, 'Descendant')
    }

    function Chrome(props: { host?: TR.HostReadChannel }): ReactElement {
      const [count, setCount] = useState(0)
      const [enabled, setEnabled] = useState(false)
      const [title, setTitle] = useState('Document')
      const commands = [
        navigationCommand({ icon: 'checkmark', invoke: () => setCount(count + 1), label: 'First' }),
        navigationCommand({ enabled, invoke: () => setCount(count + 1), label: 'Second' }),
        navigationCommand({ invoke: () => setCount(count + 1), label: 'Third' }),
        navigationCommand({ invoke: () => setCount(count + 1), label: 'Fourth' }),
      ]
      TR.Navigation.UseHostSlots(props.host, {
        Title: () => TR.Value(title),
        Toolbar: () => commands,
      })
      return createElement(
        RN.View,
        null,
        createElement(RN.Text, null, `Count ${count}`),
        createElement(RN.Pressable, {
          accessibilityLabel: 'Add ten',
          accessibilityRole: 'button',
          onPress: () => setCount(count + 10),
        }),
        createElement(RN.Pressable, {
          accessibilityLabel: 'Enable second',
          accessibilityRole: 'button',
          onPress: () => setEnabled(true),
        }),
        createElement(RN.Pressable, {
          accessibilityLabel: 'Rename',
          accessibilityRole: 'button',
          onPress: () => setTitle('Updated document'),
        }),
        createElement(Descendant),
      )
    }

    const home = TR.Navigation.View({
      name: 'Chrome',
      render: (_arguments, _taoProps, host) => createElement(Chrome, { host }),
    })
    const stack = configuredBasicStack('Basic chrome', home)
    const app = TR.Navigation.App({ name: 'Basic chrome app', navigator: () => stack, auxiliaries: () => ({}) })
    const screen = render(createElement(TR.Navigation.AppHost, { app }))

    Expect(screen.getByTestId(navigationTitleTestId).props.children).toBe('Document')
    Expect(screen.getByTestId(navigationCommandIconTestId('checkmark'))).toBeDefined()
    Expect(screen.getByLabelText('First').props.accessibilityLabel).toBe('First')
    Expect(screen.getByLabelText('Second').props.accessibilityState).toEqual({ disabled: true })
    Expect(screen.queryByLabelText('Third')).toBeNull()
    await fireEventAsync.press(screen.getByLabelText('More'))
    Expect(screen.getAllByRole('button').map(button => button.props.accessibilityLabel)).toEqual([
      'First',
      'Second',
      'More',
      'Add ten',
      'Enable second',
      'Rename',
    ])
    Expect(screen.getAllByRole('menuitem').map(item => item.props.accessibilityLabel)).toEqual([
      'Third',
      'Fourth',
    ])

    await fireEventAsync.press(screen.getByLabelText('Third'))
    Expect(screen.queryByLabelText('Third')).toBeNull()
    await fireEventAsync.press(screen.getByLabelText('First'))
    ExpectScreen(screen).toHaveText('Count 2')
    await fireEventAsync.press(screen.getByLabelText('Add ten'))
    await fireEventAsync.press(screen.getByLabelText('First'))
    ExpectScreen(screen).toHaveText('Count 13')
    await fireEventAsync.press(screen.getByLabelText('Enable second'))
    Expect(screen.getByLabelText('Second').props.accessibilityState).toEqual({ disabled: false })
    await fireEventAsync.press(screen.getByLabelText('Rename'))
    Expect(screen.getByTestId(navigationTitleTestId).props.children).toBe('Updated document')
  })

  Test('renders native toolbar icons and keeps its trailing command suffix behind More', async () => {
    const invoked: string[] = []
    const commands = [
      navigationCommand({ icon: 'safari', invoke: () => invoked.push('First'), label: 'First' }).read(),
      navigationCommand({ invoke: () => invoked.push('Second'), label: 'Second' }).read(),
      navigationCommand({ invoke: () => invoked.push('Third'), label: 'Third' }).read(),
      navigationCommand({ enabled: false, invoke: () => invoked.push('Fourth'), label: 'Fourth' }).read(),
    ]
    const FakeFontAwesome = Object.assign(
      (props: { name: string; testID: string }) =>
        createElement(RN.Text, { testID: props.testID }, `FontAwesome:${props.name}`),
      { hasIcon: (name: string) => name === 'safari' },
    )
    const restoreIcon = overrideNavigationCommandIconForTest(FakeFontAwesome)
    try {
      const screen = render(createElement(NativeToolbar, { commands }))

      const safariIcon = screen.getByTestId(navigationCommandIconTestId('safari'))
      Expect(safariIcon.props.children).toBe('FontAwesome:safari')
      Expect(screen.getByLabelText('First').props.accessibilityLabel).toBe('First')
      Expect(screen.queryByLabelText('Third')).toBeNull()
      await fireEventAsync.press(screen.getByLabelText('More'))
      Expect(screen.getAllByRole('menuitem').map(item => item.props.accessibilityLabel)).toEqual([
        'Third',
        'Fourth',
      ])
      Expect(screen.getByLabelText('Fourth').props.accessibilityState).toEqual({ disabled: true })
      await fireEventAsync.press(screen.getByLabelText('Fourth'))
      Expect(invoked).toEqual([])
      await fireEventAsync.press(screen.getByLabelText('Third'))
      Expect(invoked).toEqual(['Third'])
      Expect(screen.queryByLabelText('Third')).toBeNull()
      await fireEventAsync.press(screen.getByLabelText('More'))
      Expect(screen.getAllByRole('menuitem')).toHaveLength(2)
      screen.rerender(createElement(NativeToolbar, { commands: commands.slice(0, 2) }))
      Expect(screen.queryByLabelText('More')).toBeNull()
      Expect(screen.queryAllByRole('menuitem')).toHaveLength(0)
    } finally {
      restoreIcon()
    }
  })

  Test('adapts native stack entries to pinned screenId and headerConfig props', async () => {
    const restoreRuntime = jest.spyOn(TaoReactNative, 'requireReactNativeRuntime').mockReturnValue({
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
    })
    const itemProps: Array<Record<string, any>> = []
    const stackProps: Array<Record<string, any>> = []
    const restoreNative = overrideNativeNavigationModuleForTest({
      ScreenStack: props => {
        stackProps.push(props)
        return createElement(RN.View, null, props.children)
      },
      ScreenStackHeaderRightView: props => createElement(RN.View, { testID: 'native-right' }, props.children),
      ScreenStackItem: props => {
        itemProps.push(props)
        return createElement(RN.View, null, props.children, props.headerConfig.children)
      },
    })
    try {
      const host = new RuntimeHostReadChannel()
      host.publish({
        header: true,
        title: 'Native title',
        toolbar: [navigationCommand({ invoke: () => undefined, label: 'Native command' }).read()],
      })
      const activity = new Map<string, boolean | undefined>()
      const presentable = (name: string) =>
        TR.Navigation.View({
          name,
          render: (_arguments, taoProps) => {
            activity.set(name, taoProps?.navigationHostActive)
            return createElement(RN.Text, null, 'Native content')
          },
        })
      const home = presentable('Native home')
      const detail = presentable('Native detail')
      const stack = configuredStack('Native adapter', home)
      const screen = render(createElement(NativeStackSurface, {
        entries: [
          { arguments: {}, host, instanceId: 41, presentable: home },
          { arguments: {}, host, instanceId: 42, presentable: detail },
        ],
        navigation: stack as any,
      }))

      Expect(screen.getAllByText('Native content')).toHaveLength(2)
      Expect(screen.getByTestId('native-right')).toBeDefined()
      Expect(itemProps).toHaveLength(2)
      Expect(itemProps[0]?.['screenId']).toBe('41')
      Expect(itemProps[1]?.['screenId']).toBe('42')
      Expect(itemProps.map(props => props['activityState'])).toEqual([2, 2])
      Expect(itemProps[0]?.['headerConfig'].hidden).toBe(false)
      Expect(itemProps[0]?.['headerConfig'].title).toBe('Native title')
      Expect(itemProps[0]?.['headerConfig'].children).toBeDefined()
      Expect(activity).toEqual(new Map([['Native home', false], ['Native detail', true]]))
      const outline = TR.Interaction.Outline.read().nodes
      const activeRegion = outline.find(node => node.kind === 'region' && node.provenance['instanceId'] === 42)
      const toolbarCommand = outline.find(node => node.kind === 'action' && node.label === 'Native command')
      Expect(activeRegion).toBeDefined()
      Expect(toolbarCommand?.parent).toBe(activeRegion?.identity)

      const hiddenHost = new RuntimeHostReadChannel()
      hiddenHost.publish({ header: false, title: 'Ignored title', toolbar: host.read().toolbar })
      itemProps.length = 0
      screen.rerender(createElement(NativeStackSurface, {
        entries: [{ arguments: {}, host: hiddenHost, instanceId: 43, presentable: home }],
        navigation: stack as any,
      }))
      Expect(itemProps[0]?.['headerConfig']).toMatchObject({
        children: null,
        hidden: true,
        hideBackButton: true,
        title: '',
      })
      // A ScreenStack lays its screens out inside its own bounds: without a filling style it
      // measures as nothing on a device and every screen under it renders empty.
      Expect(RN.StyleSheet.flatten(stackProps[0]?.['style'])).toMatchObject({ flex: 1 })
    } finally {
      restoreNative()
      restoreRuntime.mockRestore()
    }
  })

  Test('gives a native StackNav inside a JS selection item definite height', () => {
    const restoreNative = overrideNativeNavigationModuleForTest({
      ScreenStack: props =>
        createElement(RN.View, { testID: 'selected-native-stack', style: props.style }, props.children),
      ScreenStackItem: props => createElement(RN.View, null, props.children),
    })
    try {
      const home = TR.Navigation.View({
        name: 'Selected native home',
        render: () => createElement(RN.Text, null, 'Selected native content'),
      })
      const stack = configuredStack('Selected native stack', home)
      const selection = configuredSelection({
        display: TR.Value('drawer'),
        initial: 'home',
        items: { home: { content: stack, label: TR.Value('Home') } },
        name: 'Selected native navigation',
      })
      const app = TR.Navigation.App({
        name: 'Selected native app',
        navigator: () => selection,
        auxiliaries: () => ({}),
      })
      const screen = render(createElement(TR.Navigation.AppHost, { app }))

      ExpectScreen(screen).toHaveText('Selected native content')
      // ScreenStack needs both its own flex and a filling selection level. Without the latter,
      // the iPhone lays the nested stack out at zero height and the selected app looks blank.
      const nativeStack = screen.getByTestId('selected-native-stack')
      Expect(RN.StyleSheet.flatten(nativeStack.props.style)).toMatchObject({ flex: 1 })
      Expect(RN.StyleSheet.flatten(nativeStack.parent?.props.style)).toMatchObject({ flex: 1 })
    } finally {
      restoreNative()
    }
  })

  Test('lets only the active selected Stack own chrome selectors and the web document title', async () => {
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { title: 'Host title' } })
    try {
      const titledView = (name: string, title: string) =>
        TR.Navigation.View({
          name,
          render: (_arguments, _taoProps, host) => {
            TR.Navigation.UseHostSlots(host, { Title: () => TR.Value(title) })
            return createElement(RN.Text, null, `${name} content`)
          },
        })
      const homeStack = configuredBasicStack('Home stack', titledView('Home', 'Home title'))
      const settingsStack = configuredBasicStack('Settings stack', titledView('Settings', 'Settings title'))
      const wrapper = (name: string, stack: TR.NavigationValue) =>
        TR.Navigation.View({
          name,
          render: (_arguments, taoProps) => stack.render(TR.TaoContext(taoProps)),
        })
      const selection = configuredSelection({
        display: TR.Value('tabs'),
        initial: 'home',
        items: {
          home: { content: wrapper('Home wrapper', homeStack), label: TR.Value('Home') },
          settings: { content: wrapper('Settings wrapper', settingsStack), label: TR.Value('Settings') },
        },
        name: 'Titled selection',
      })
      const app = TR.Navigation.App({ name: 'Titled app', navigator: () => selection, auxiliaries: () => ({}) })
      const screen = render(createElement(TR.Navigation.AppHost, { app }))

      Expect(screen.getAllByTestId(navigationTitleTestId)).toHaveLength(1)
      Expect(screen.getByTestId(navigationTitleTestId).props.children).toBe('Home title')
      Expect((globalThis as unknown as { document: { title: string } }).document.title).toBe('Home title')
      await fireEventAsync.press(screen.getByText('Settings'))
      Expect(screen.getAllByTestId(navigationTitleTestId)).toHaveLength(1)
      Expect(screen.getByTestId(navigationTitleTestId).props.children).toBe('Settings title')
      Expect((globalThis as unknown as { document: { title: string } }).document.title).toBe('Settings title')
      screen.unmount()
      Expect((globalThis as unknown as { document: { title: string } }).document.title).toBe('Host title')
    } finally {
      if (previousDocument) {
        Object.defineProperty(globalThis, 'document', previousDocument)
      } else {
        Reflect.deleteProperty(globalThis, 'document')
      }
    }
  })

  Test('publishes configured Title and Toolbar when a nav is itself a Stack entry', async () => {
    let invoked = 0
    let nested: TR.NavigationValue
    const detail = TR.Navigation.View({
      name: 'Nested detail',
      render: () => createElement(RN.Text, null, 'Nested detail'),
    })
    const nestedHome = TR.Navigation.View({
      name: 'Nested home',
      render: () =>
        createElement(
          RN.View,
          null,
          createElement(RN.Text, null, 'Nested content'),
          createElement(RN.Pressable, {
            accessibilityLabel: 'Open nested detail',
            onPress: () => nested.present(detail, {}),
          }),
        ),
    })
    nested = configuredBasicStack('Nested', nestedHome, {
      Title: TR.Value('Nested navigation'),
      Toolbar: [navigationCommand({ invoke: () => invoked += 1, label: 'Refresh' })],
    })
    const outer = configuredBasicStack('Outer', nested)
    const app = TR.Navigation.App({ name: 'Nested nav app', navigator: () => outer, auxiliaries: () => ({}) })
    const screen = render(createElement(TR.Navigation.AppHost, { app }))

    ExpectScreen(screen).toHaveText('Nested navigation')
    ExpectScreen(screen).toHaveText('Nested content')
    await fireEventAsync.press(screen.getByLabelText('Refresh'))
    Expect(invoked).toBe(1)
    await fireEventAsync.press(screen.getByLabelText('Open nested detail'))
    ExpectScreen(screen).toHaveText('Nested detail')
    Expect(screen.getAllByLabelText('Back')).toHaveLength(1)
    await fireEventAsync.press(screen.getByLabelText('Back'))
    ExpectScreen(screen).toHaveText('Nested content')
  })

  Test('removes underlying command focus while an auxiliary overlay owns interaction', async () => {
    let invoked = 0
    const home = TR.Navigation.View({
      name: 'Focused home',
      render: (_arguments, _taoProps, host) => {
        TR.Navigation.UseHostSlots(host, {
          Title: () => TR.Value('Focused title'),
          Toolbar: () => [navigationCommand({ invoke: () => invoked += 1, label: 'Save' })],
        })
        return createElement(RN.Text, null, `Invoked ${invoked}`)
      },
    })
    const windowRoot = TR.Navigation.View({
      name: 'Window root',
      render: () => createElement(RN.Text, null, 'Window root'),
    })
    const notice = TR.Navigation.View({
      name: 'Notice',
      render: () => createElement(RN.Text, null, 'Notice'),
    })
    const stack = configuredBasicStack('Focused stack', home)
    const window = configuredSlot('Focused window', windowRoot)
    const app = TR.Navigation.App({
      name: 'Focus app',
      navigator: () => stack,
      auxiliaries: () => ({ window }),
    })
    const screen = render(createElement(TR.Navigation.AppHost, { app }))

    Expect(screen.getByTestId(navigationTitleTestId)).toBeDefined()
    await fireEventAsync.press(screen.getByLabelText('Save'))
    Expect(invoked).toBe(1)
    await act(async () => TR.Navigation.PresentOverlay(undefined, window, notice, {}))
    ExpectScreen(screen).toHaveText('Notice')
    Expect(screen.queryByTestId(navigationTitleTestId)).toBeNull()
    Expect(screen.getByLabelText('Save').props.accessibilityState).toEqual({ disabled: true })
    await fireEventAsync.press(screen.getByLabelText('Save'))
    Expect(invoked).toBe(1)
    await act(async () => app.back())
    Expect(screen.getByTestId(navigationTitleTestId)).toBeDefined()
  })

  Test('preserves auxiliary defocus through the active SelectionNav item', async () => {
    let invoked = 0
    const home = TR.Navigation.View({
      name: 'Selected home',
      render: (_arguments, _taoProps, host) => {
        TR.Navigation.UseHostSlots(host, {
          Title: () => TR.Value('Selected title'),
          Toolbar: () => [navigationCommand({ invoke: () => invoked += 1, label: 'Selected save' })],
        })
        return createElement(RN.Text, null, 'Selected content')
      },
    })
    const homeStack = configuredBasicStack('Selected stack', home)
    const wrapper = TR.Navigation.View({
      name: 'Selected wrapper',
      render: (_arguments, taoProps) => homeStack.render(TR.TaoContext(taoProps)),
    })
    const selection = configuredSelection({
      display: TR.Value('tabs'),
      initial: 'home',
      items: { home: { content: wrapper, label: TR.Value('Home') } },
      name: 'Selected navigation',
    })
    const windowRoot = TR.Navigation.View({
      name: 'Window root',
      render: () => createElement(RN.Text, null, 'Window root'),
    })
    const notice = TR.Navigation.View({
      name: 'Selection notice',
      render: () => createElement(RN.Text, null, 'Selection notice'),
    })
    const window = configuredSlot('Selection window', windowRoot)
    const app = TR.Navigation.App({
      name: 'Selection focus app',
      navigator: () => selection,
      auxiliaries: () => ({ window }),
    })
    const screen = render(createElement(TR.Navigation.AppHost, { app }))

    Expect(screen.getByTestId(navigationTitleTestId).props.children).toBe('Selected title')
    await fireEventAsync.press(screen.getByLabelText('Selected save'))
    Expect(invoked).toBe(1)
    await act(async () => window.presentOverlay(notice, {}))
    ExpectScreen(screen).toHaveText('Selection notice')
    Expect(screen.queryByTestId(navigationTitleTestId)).toBeNull()
    Expect(screen.getByLabelText('Selected save').props.accessibilityState).toEqual({ disabled: true })
    await fireEventAsync.press(screen.getByLabelText('Selected save'))
    Expect(invoked).toBe(1)
  })

  Test('publishes inherited view slots from a configured SlotNav presented in a StackNav', async () => {
    await testCompileApp(
      `
        use SlotNav, StackNav from @tao/nav
        use Text from @tao/ui

        nav Nested = SlotNav {
          Initial Inner
          Title "Nested slot title"
          Toolbar { Refresh }
        }

        action Reload() { }

        command Refresh() {
           Title "Refresh"
           do Reload()
        }

        app NestedSlotApp {
          Name "Nested slot"
          Navigator StackNav { Initial Nested }
        }

        view Inner() { render Text("Inner") }
      `,
      async screen => {
        Expect(screen.getByTestId(navigationTitleTestId).props.children).toBe('Nested slot title')
        ExpectScreen(screen).toHaveText('Inner')
        await fireEventAsync.press(screen.getByLabelText('Refresh'))
      },
    )
  })
})
