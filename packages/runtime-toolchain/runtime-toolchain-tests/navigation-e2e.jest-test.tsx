import { jest } from '@jest/globals'
import { RuntimeTesting } from '@runtime-toolchain/testing/runtime-testing'
import TR from '@runtime/TR'
import * as TaoReactNative from '@runtime/TR-react-native'
import { FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { act, fireEvent, fireEventAsync, render } from '@testing-library/react-native'
import { createElement, type ReactElement, useState } from 'react'
import * as RN from 'react-native'
import { RuntimeToolchainPaths } from '../runtime-toolchain-src/runtime-toolchain-paths'
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

          workspace view Home() {
            action Open() { present Detail() in NestedStack }
            render Col() {
              Text("Home")
              FormButton("Open detail") { on press Open }
            }
          }

          view Detail() { render Text("Stable detail") }
        `,
      },
      screen => {
        fireEvent.press(screen.getByText('Open detail'))
        ExpectScreen(screen).toHaveText('Stable detail')
      },
    )
  })

  Test('dispatches visible and hardware Back through the configured app reducer and cleans up its subscription', () => {
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
      fireEvent.press(screen.getByLabelText('Back'))
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
  })

  Test('layers stacked StackNav overlays absolutely and preserves covered overlay state', () => {
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
    fireEvent.press(screen.getByLabelText('Increment overlay'))
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

    fireEvent.press(screen.getByLabelText('Back'))
    Expect(screen.queryByText('Second overlay')).toBeNull()
    ExpectScreen(screen).toHaveText('Overlay count 1')
    fireEvent.press(screen.getByLabelText('Back'))
    Expect(screen.queryByText('Overlay count 1')).toBeNull()
    ExpectScreen(screen).toHaveText('Home')
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

    act(() => {
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

    act(() => {
      TR.Navigation.Respond(occurrenceProps.get('First'), TR.Value('first-covered'))
    })
    Expect((await first).evaluate().jsValue).toBe('first-covered')
    ExpectScreen(screen).toHaveText('Question Second')

    await fireEventAsync.press(screen.getByLabelText('Back'))
    Expect((await second).evaluate().jsValue).toBe(null)
    Expect(screen.queryByText('Question Second')).toBeNull()
    ExpectScreen(screen).toHaveText('Home')
  })

  Test('replaces keyed app toasts, coexists across keys, restarts expiry, and ignores Back', () => {
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

  Test('resolves contextual overlays to a SlotNav and dismisses its overlay stack before content', () => {
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

    fireEvent.press(screen.getByLabelText('Open slot overlay'))
    act(() => {
      TR.Navigation.PresentOverlay(undefined, slot, second, {})
    })
    ExpectScreen(screen).toHaveText('Slot overlay two')
    Expect(screen.queryByText('Slot overlay one')).toBeNull()
    fireEvent.press(screen.getByLabelText('Back'))
    ExpectScreen(screen).toHaveText('Slot overlay one')
    fireEvent.press(screen.getByLabelText('Back'))
    ExpectScreen(screen).toHaveText('Slot home')
    Expect(slot.back()).toBe(false)
  })

  Test('inherits contextual present, overlay, and dismiss through nested generated view props', () => {
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

    fireEvent.press(screen.getByLabelText('Open nested detail'))
    Expect(screen.queryByText('Nested home')).toBeNull()
    fireEvent.press(screen.getByLabelText('Dismiss nested detail'))
    ExpectScreen(screen).toHaveText('Nested home')

    fireEvent.press(screen.getByLabelText('Open nested overlay'))
    ExpectScreen(screen).toHaveText('Nested overlay')
    fireEvent.press(screen.getByLabelText('Dismiss nested overlay'))
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

        view Home() { render Wrapper()[gap 9] }

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
        fireEvent.press(screen.getByText('Confirm nested ask'))
        await act(async () => {})
        Expect(screen.queryByText('Nested ask')).toBeNull()
        ExpectScreen(screen).toHaveText('Confirmed')
      },
    )
  })

  Test('keeps covered navigation entries mounted and returns through the accessible root-safe back reducer', () => {
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
    fireEvent.press(screen.getByLabelText('Increment home'))
    ExpectScreen(screen).toHaveText('Home count 1')

    fireEvent.press(screen.getByLabelText('Open detail'))
    ExpectScreen(screen).toHaveText('Detail')
    Expect(screen.queryByLabelText('Increment home')).toBeNull()
    fireEvent.press(screen.getByLabelText('Back'))

    ExpectScreen(screen).toHaveText('Home count 1')
    Expect(screen.queryByLabelText('Back')).toBeNull()
    Expect(stack.back()).toBe(false)
  })

  Test('renders keyed selection labels and preserves inactive item state', () => {
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
    fireEvent.press(screen.getByLabelText('Increment selection home'))
    ExpectScreen(screen).toHaveText('Home count 1')

    fireEvent.press(screen.getByText('Settings'))
    ExpectScreen(screen).toHaveText('Settings content')
    Expect(screen.queryByLabelText('Increment selection home')).toBeNull()
    Expect(screen.queryByLabelText('Back')).toBeNull()

    fireEvent.press(screen.getByText('Home'))
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

      workspace view Home() {
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

    await withTaoFiles('tao-runtime-first-app-identity-', { 'App.tao': appSource('First') }, async firstPaths => {
      const first = await compileAndRenderApp(firstPaths['App.tao']!)
      await withTaoFiles(
        'tao-runtime-second-app-identity-',
        { 'App.tao': appSource('Second') },
        async secondPaths => {
          const generatedRoot = FS.resolvePath(
            `_gen_tao-app-test/app-identity/${RuntimeTesting.TestRunId.create()}`,
            RuntimeToolchainPaths.packageRoot,
          )
          try {
            const second = await RuntimeTesting.TestCompiler.Worker.compileApp(secondPaths['App.tao']!, {
              runtimePackageRoot: generatedRoot,
            })
            // Evaluating the second generated module used to overwrite the first app's name-table entry.
            Expect((require(second.testAppPath) as { default?: unknown }).default).toBeDefined()

            fireEvent.press(first.getByText('Open First'))
            ExpectScreen(first).toHaveText('First notice')
          } finally {
            await FS.remove(generatedRoot)
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

        view Home() { render Editor() }

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
          fireEvent.press(screen.getByText('Save'))
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
})
