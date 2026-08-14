import { jest } from '@jest/globals'
import { RuntimeTesting } from '@runtime/testing/runtime-testing'
import TR from '@runtime/TR'
import { FS, Repo } from '@shared'
import { AfterAll, AfterEach, Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { act, cleanup, fireEvent, fireEventAsync, render } from '@testing-library/react-native'
import { createElement, type ReactElement, type ReactNode, useState } from 'react'
import * as RN from 'react-native'
import * as TaoReactNative from '../TaoRuntime-src/TR-react-native'
import { compileAndRenderApp, ExpectScreen, testCompileApp, testCompileFiles } from './test-compile-app'

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

AfterAll(async () => {
  await RuntimeTesting.stopTestCompiler()
})

AfterEach(() => {
  cleanup()
  TR.setDevMode()
})

Describe('Expo runtime', () => {
  Test('suppresses disabled pressable actions while retaining their accessible name', () => {
    let presses = 0
    const screen = render(
      TR.Views.Pressable(
        {
          action: {
            invoke: () => {
              presses += 1
            },
          },
          disabled: true,
          title: 'Save',
        },
        {
          nativeProps: {
            accessibilityLabel: 'Save',
            accessibilityRole: 'button',
            accessibilityState: { busy: true, disabled: true },
            disabled: true,
          },
        },
      ),
    )

    const button = screen.getByLabelText('Save')
    fireEvent.press(button)
    Expect(presses).toBe(0)
  })

  Test('suppresses disabled text-input changes and submissions', () => {
    let changes = 0
    let submissions = 0
    const screen = render(TR.Views.TextInput({
      disabled: true,
      label: 'Task title',
      onChange: () => {
        changes += 1
      },
      onSubmit: () => {
        submissions += 1
      },
      value: 'Draft',
    }))

    const input = screen.getByLabelText('Task title')
    fireEvent.changeText(input, 'Changed')
    fireEvent(input, 'submitEditing')

    Expect(input.props.accessibilityState).toEqual({ disabled: true })
    Expect(input.props.editable).toBe(false)
    Expect(changes).toBe(0)
    Expect(submissions).toBe(0)
  })

  Test('binds an app datasource after render without updating an existing query subscriber during render', async () => {
    const datasource = TR.Data.Configure(
      TR.Data.Declaration('Memory', TR.DataProvider.Memory()),
      {},
    )
    const schema = TR.Data.Schema({
      name: 'LifecycleSafeBinding',
      entities: {
        Entry: { collection: 'Entries', fields: {} },
      },
    })

    function QuerySubscriber(): ReactElement {
      const rows = TR.Data.Query(
        schema,
        { entity: 'Entry', filters: [] },
        TR.Value,
      ).evaluate().jsValue as unknown[] & { Error: string; Loading: boolean }
      const status = rows.Loading ? 'Loading' : rows.Error ? 'Provider error' : 'Bound'
      return createElement(RN.Text, null, status)
    }

    function ProviderBinding(): null {
      TR.Data.UseConfigured(schema, datasource)
      return null
    }

    const subscriber = render(createElement(QuerySubscriber))
    ExpectScreen(subscriber).toHaveText('Provider error')
    const consoleErrors: string[] = []
    const consoleError = jest.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
      consoleErrors.push(values.map(String).join(' '))
    })

    try {
      render(createElement(ProviderBinding))
      await act(async () => {
        await TR.Data.Settle(schema)
      })

      ExpectScreen(subscriber).toHaveText('Bound')
      Expect(consoleErrors.some(message =>
        message.includes('Cannot update a component')
        && message.includes('while rendering a different component')
      )).toBe(false)
    } finally {
      consoleError.mockRestore()
    }
  })

  Test('binds a declaration-owned provider and StorageKey through UseConfigured', async () => {
    const provider = TR.DataProvider.Memory()
    const declaration = TR.Data.Declaration('ConfiguredMemory', provider)
    const configured = TR.Data.Configure(declaration, { StorageKey: TR.Value('configured-runtime') })
    const schema = TR.Data.Schema({
      name: 'ConfiguredRuntimeSchema',
      entities: {
        Entry: { collection: 'Entries', fields: { Name: { kind: 'text' } } },
      },
    })

    function ProviderBinding(): null {
      TR.Data.UseConfigured(schema, configured)
      return null
    }

    const binding = render(createElement(ProviderBinding))
    await act(async () => {
      await TR.Data.Settle(schema)
    })
    act(() => {
      TR.Data.Create(schema, 'Entry', { Name: TR.Value('Declaration bound') })
    })
    await act(async () => {
      await TR.Data.Settle(schema)
    })
    const revision = schema.snapshot()

    binding.rerender(createElement(ProviderBinding))

    Expect(schema.snapshot()).toBe(revision)
    Expect(await provider.load('ConfiguredRuntimeSchema')).toBeUndefined()
    Expect(await provider.load('configured-runtime')).toContain('Declaration bound')
  })

  Test('dispatches visible and hardware Back through the configured app reducer and cleans up its subscription', () => {
    let handler: (() => boolean) | undefined
    let removes = 0
    const restoreReactNativeRuntime = jest.spyOn(TaoReactNative, 'requireReactNativeRuntime').mockReturnValue({
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
      KeyboardAvoidingView: RN.View,
      Pressable: RN.Pressable,
      ScrollView: RN.View,
      Text: RN.Text,
      TextInput: RN.TextInput,
      View: RN.View,
    })

    try {
      const home = TR.Navigation.UI({ name: 'Home', render: () => createElement(RN.Text, null, 'Home') })
      const windowRoot = TR.Navigation.UI({
        name: 'Window root',
        render: () => createElement(RN.Text, null, 'Window root'),
      })
      const detail = TR.Navigation.UI({ name: 'Detail', render: () => createElement(RN.Text, null, 'Detail') })
      const notice = TR.Navigation.UI({ name: 'Notice', render: () => createElement(RN.Text, null, 'Notice') })
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

    const home = TR.Navigation.UI({ name: 'Home', render: () => createElement(RN.Text, null, 'Home') })
    const first = TR.Navigation.UI({ name: 'First overlay', render: () => createElement(StatefulOverlay) })
    const second = TR.Navigation.UI({
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

  Test('stacks independent dialogue occurrences and settles only their own suspended asks', async () => {
    const home = TR.Navigation.UI({ name: 'Home', render: () => createElement(RN.Text, null, 'Home') })
    const occurrenceProps = new Map<string, TR.TaoProps | undefined>()
    const dialogue = TR.Navigation.Dialogue({
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
    const stack = configuredStack('DialogueHostStack', home)
    const app = TR.Navigation.App({
      name: 'Dialogue Host App',
      navigator: () => stack,
      auxiliaries: () => ({}),
    })
    const screen = render(createElement(TR.Navigation.AppHost, { app }))
    let first!: Promise<{ evaluate(): { jsValue: unknown } }>
    let second!: Promise<{ evaluate(): { jsValue: unknown } }>

    act(() => {
      first = TR.Navigation.Ask(
        { navigation: stack },
        dialogue,
        { Result: TR.Value('first'), Title: TR.Value('First') },
      )
      second = TR.Navigation.Ask(
        { navigation: stack },
        dialogue,
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
      const home = TR.Navigation.UI({ name: 'Home', render: () => createElement(RN.Text, null, 'Home') })
      const toast = (name: string, text: string) =>
        TR.Navigation.UI({ name, render: () => createElement(RN.Text, null, text) })
      const first = toast('First saved', 'First saved')
      const replacement = toast('Replacement saved', 'Replacement saved')
      const other = toast('Other notice', 'Other notice')
      const zero = toast('Zero notice', 'Zero notice')
      const stack = configuredStack('Toast host', home)
      const app = TR.Navigation.App({ name: 'Toast App', navigator: () => stack, auxiliaries: () => ({}) })
      const screen = render(createElement(TR.Navigation.AppHost, { app }))
      const taoProps: TR.TaoProps = { app }

      act(() => {
        TR.Navigation.PresentToast(taoProps, first, {}, {
          duration: TR.Value(3),
          key: TR.Value('saved'),
        })
        TR.Navigation.PresentToast(taoProps, other, {}, {
          duration: TR.Value(10),
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
          duration: TR.Value(3),
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
          duration: TR.Value(0),
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
    const first = TR.Navigation.UI({
      name: 'Slot overlay one',
      render: () => createElement(RN.Text, null, 'Slot overlay one'),
    })
    const second = TR.Navigation.UI({
      name: 'Slot overlay two',
      render: () => createElement(RN.Text, null, 'Slot overlay two'),
    })
    const home = TR.Navigation.UI({
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

    const detail = TR.Navigation.UI({
      name: 'Nested detail',
      render: (_arguments, taoProps) =>
        createElement(GeneratedViewBoundary, {
          __tao: taoProps,
          invoke: props => TR.Navigation.Dismiss(props),
          label: 'Dismiss nested detail',
        }),
    })
    const overlay = TR.Navigation.UI({
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
    const home = TR.Navigation.UI({
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

        enum ConfirmResult { Confirmed }

        ui Home { render Wrapper()[gap 9] }

        view Wrapper {
          render Col() {
            Editor()
          }
        }

        view Editor {
          state Status = "Ready"
          action Open {
            let Result = ask Confirm()
            if Result is Confirmed { set Status = "Confirmed" }
          }
          render Col() {
            Text(Status)
            Button("Open nested dialogue") { on press Open }
          }
        }

        dialogue Confirm responds ConfirmResult {
          action ConfirmIt { respond Confirmed }
          render Col() {
            Text("Nested dialogue")
            Button("Confirm nested dialogue") { on press ConfirmIt }
          }
        }
      `,
      async screen => {
        const gapNineViews = screen.UNSAFE_getAllByType(RN.View).filter(view => {
          const style = RN.StyleSheet.flatten(view.props.style)
          return style?.gap === 9
        })
        Expect(gapNineViews).toHaveLength(1)

        fireEvent.press(screen.getByText('Open nested dialogue'))
        await act(async () => {})
        ExpectScreen(screen).toHaveText('Nested dialogue')
        fireEvent.press(screen.getByText('Confirm nested dialogue'))
        await act(async () => {})
        Expect(screen.queryByText('Nested dialogue')).toBeNull()
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

    const home = TR.Navigation.UI({ name: 'Home', render: () => createElement(Home) })
    const detail = TR.Navigation.UI({ name: 'Detail', render: () => createElement(RN.Text, null, 'Detail') })
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

    const home = TR.Navigation.UI({ name: 'Home', render: () => createElement(StatefulHome) })
    const settings = TR.Navigation.UI({
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

      workspace ui Home {
        action Open {
          present Notice() in SharedGeneratedApp@window
        }
        render Col() {
          Text("${label} home")
          FormButton("Open ${label}") { on press Open }
        }
      }

      workspace ui Notice {
        render Text("${label} notice")
      }

      workspace ui WindowRoot {
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
            Repo.resolvePath('packages/runtime'),
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

        ui Home { render Editor() }

        view Editor {
          action Save {
            present SavedToast() as toast (Key: "saved", Duration: 1)
          }
          render Col() {
            FormButton("Save") { on press Save }
          }
        }

        ui SavedToast { render Text("Saved") }
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

  Test('runs Tao text expectations with duplicate rendered text', async () => {
    await withTaoFiles(
      'tao-runtime-test-plan-',
      {
        'Main.test.tao': `
        use DuplicateTextApp from ./

        test "Duplicate text" {
          check "matches at least one text node" {
            run DuplicateTextApp
            expect text "Repeated"
          }
        }
      `,
        'Main.tao': `
        app DuplicateTextApp { view MainView }
        view MainView {
          render Stack(){
            Text("Repeated")
            Text("Repeated")
          }
        }
        layout Stack {
          render inject \`\`\`ts
            return <>{_ViewProps.children}</>
          \`\`\`
        }
        view Text Value is text {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      },
      async paths => {
        await RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)
      },
    )
  })

  Test('runs Tao press text steps before later expectations', async () => {
    await withTaoFiles(
      'tao-runtime-test-plan-',
      {
        'Main.test.tao': `
        use PressTextApp from ./

        test "Press text" {
          check "updates rendered state" {
            run PressTextApp
            expect text "0"
            press text "Add"
            expect text "1"
          }
        }
      `,
        'Main.tao': `
        app PressTextApp { view MainView }
        view MainView {
          state Count = 0
          action AddOne {
            set Count += 1
          }
          render Stack(){
            NativeButton("Add", AddOne)
            Number(Count)
          }
        }
        layout Stack {
          render inject \`\`\`ts
            return <>{_ViewProps.children}</>
          \`\`\`
        }
        view NativeButton Title is text, Action is action {
          render inject Title, Action \`\`\`ts
            return (
              <RN.Pressable accessibilityRole="button" onPress={() => Action.invoke()}>
                <RN.Text>{Title}</RN.Text>
              </RN.Pressable>
            )
          \`\`\`
        }
        view Number Value is number {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      },
      async paths => {
        await RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)
      },
    )
  })

  Test('waits for guard fallthrough before running the next Tao test step', async () => {
    await withTaoFiles(
      'tao-runtime-async-action-test-plan-',
      {
        'Main.test.tao': `
        use AsyncActionApp from ./

        test "Async action" {
          check "observes state after guard fallthrough" {
            run AsyncActionApp
            expect text "0"
            press text "Advance"
            expect text "1"
          }
        }
      `,
        'Main.tao': `
        app AsyncActionApp { view MainView }
        view MainView {
          state Ready = false
          state Count = 0
          action Advance {
            guard Ready true -> {
              set Count = 10
            }
            set Count = 1
          }
          render Stack(){
            NativeButton("Advance", Advance)
            Number(Count)
          }
        }
        layout Stack {
          render inject \`\`\`ts
            return <>{_ViewProps.children}</>
          \`\`\`
        }
        view NativeButton Title is text, Action is action {
          render inject Title, Action \`\`\`ts
            return (
              <RN.Pressable accessibilityRole="button" onPress={() => Action.invoke()}>
                <RN.Text>{Title}</RN.Text>
              </RN.Pressable>
            )
          \`\`\`
        }
        view Number Value is number {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      },
      async paths => {
        await RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)
      },
    )
  })

  Test('lets Tao test steps answer an action suspended by ask', async () => {
    await withTaoFiles(
      'tao-runtime-dialogue-test-plan-',
      {
        'Main.test.tao': `
        use DialogueTestApp from ./

        test "Dialogue" {
          check "answers a suspended ask" {
            run DialogueTestApp
            press text "Ask"
            expect text "Question"
            press text "Confirm"
            expect text "Confirmed"
          }
        }
      `,
        'Main.tao': `
        use StackNav from @tao/nav
        use Button, Col, Text from @tao/ui

        enum ConfirmResult { Confirmed }

        app DialogueTestApp {
          Name "Dialogue test"
          Navigator StackNav { Initial Home }
        }

        ui Home {
          state Status = "Ready"
          action AskForConfirmation {
            let Result = ask Confirm()
            if Result is Confirmed { set Status = "Confirmed" }
          }
          render Col() {
            Text(Status)
            Button("Ask") { on press AskForConfirmation }
          }
        }

        dialogue Confirm responds ConfirmResult {
          action ConfirmIt { respond Confirmed }
          render Col() {
            Text("Question")
            Button("Confirm") { on press ConfirmIt }
          }
        }
      `,
      },
      async paths => {
        await RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)
      },
    )
  })

  Test('reports selector-neutral Tao press failures', async () => {
    await withTaoFiles(
      'tao-runtime-press-failure-test-plan-',
      {
        'Main.test.tao': `
        use MissingPressApp from ./

        test "Press failure" {
          check "reports the selector" {
            run MissingPressApp
            press text "Missing button"
          }
        }
      `,
        'Main.tao': `
        app MissingPressApp { view MainView }

        view MainView {
          render Text("Ready")
        }

        view Text Value is text {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      },
      async paths => {
        await Expect(RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)).rejects.toThrow(
          /press text "Missing button" expected one pressable but found 0 matches/,
        )
      },
    )
  })

  Test('runs Tao enter and submit steps through label and placeholder selectors', async () => {
    await withTaoFiles(
      'tao-runtime-input-test-plan-',
      {
        'Main.test.tao': `
        use InputApp from ./

        test "Input" {
          check "changes and submits" {
            run InputApp
            enter "Plan launch" into placeholder "Task title"
            expect text "Plan launch"
            expect input placeholder "Task title" value "Plan launch"
            submit label "Task title"
            expect text "Saved"
          }
        }
      `,
        'Main.tao': `
        app InputApp { view MainView }
        view MainView {
          state Draft = ""
          state Status = "Waiting"
          action ChangeDraft Value is text {
            set Draft = Value
          }
          action Submit {
            set Status = "Saved"
          }
          render Stack(){
            NativeInput(Value: Draft, Change: ChangeDraft, Submit: Submit, Label: "Task title")
            Text(Draft)
            Text(Status)
          }
        }
        layout Stack {
          render inject \`\`\`ts
            return <>{_ViewProps.children}</>
          \`\`\`
        }
        view NativeInput Value is text, Change is action(text), Submit is action(), Label is text {
          render inject Value, Change, Submit, Label \`\`\`ts
            return (
              <RN.TextInput
                accessibilityLabel={Label}
                placeholder="Task title"
                value={Value}
                onChangeText={value => Change.invoke(TR.Value(value))}
                onSubmitEditing={() => Submit.invoke()}
              />
            )
          \`\`\`
        }
        view Text Value is text {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      },
      async paths => {
        await RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)
      },
    )
  })

  Test('runs grouped and tag-scoped expectations, interactions, selected rows, and bare data status', async () => {
    await withTaoFiles(
      'tao-runtime-structured-test-plan-',
      {
        'Main.test.tao': `
        use TaggedApp from ./

        test "Structured selectors" {
          check "scopes every operation" {
            run TaggedApp
            expect {
              text "First"
              text "Second"
              missing text "Selected Second"
            }
            expect #field {
              placeholder "Name"
              input value ""
            }
            enter "Draft" into #field
            expect #field input value "Draft"
            submit #field
            expect text "Submitted"
            select #rows[2] {
              expect text "Second"
              press #choose
            }
            expect text "Selected Second"
            data loading
            expect {
              text "Loading"
              missing text "First"
            }
            data ready
            expect text "First"
          }
        }
      `,
        'Main.tao': `
        use Col, FormButton, Text, TextInput from @tao/ui
        use Memory from @tao/data
        use StackNav from @tao/nav

        data Items / Item { Name text }

        app TaggedApp {
          Name "Tagged"
          Navigator StackNav { Initial Main }
          Datasource Memory
        }

        ui Main {
          state Draft = ""
          state Status = "Waiting"
          state Selection = "Nothing selected"
          query Items { }
          render Col() {
            guard Items {
              loading -> { Text("Loading") }
              error -> Message { Text(Message) }
            }
            #field
            TextInput(Value: Draft, Label: "Name", Placeholder: "Name") {
              on submit -> { set Status = "Submitted" }
            }
            Text(Status)
            Text(Selection)
            #rows
            loop ["First", "Second"] / Row {
              Col() {
                Text(Row)
                #choose
                FormButton("Choose") {
                  on press -> { set Selection = "Selected { Row }" }
                }
              }
            }
          }
        }
      `,
      },
      async paths => {
        await RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)
      },
    )
  })

  Test('tagged loops preserve the same native row hierarchy as untagged loops', async () => {
    await testCompileApp(
      `
        use Col, Text from @tao/ui
        app LoopHierarchyApp { view Main }
        view Main {
          render Col() {
            #taggedRows
            loop ["Tagged"] / Row {
              Col() { Text(Row) }
            }
            loop ["Untagged"] / Row {
              Col() { Text(Row) }
            }
          }
        }
      `,
      screen => {
        const taggedRow = screen.getByTestId('taggedRows')
        let untaggedRow = screen.getByText('Untagged').parent
        while (untaggedRow && untaggedRow.type !== taggedRow.type) {
          untaggedRow = untaggedRow.parent
        }
        Expect(untaggedRow).not.toBeNull()
        Expect(taggedRow.type).toBe(untaggedRow?.type)
        Expect(taggedRow.children.map((child: any) => typeof child === 'string' ? 'string' : child.type))
          .toEqual(untaggedRow?.children.map((child: any) => typeof child === 'string' ? 'string' : child.type))
        Expect(taggedRow.props.testID).toBe('taggedRows')
        Expect(untaggedRow?.props.testID).toBeUndefined()
      },
    )
  })

  Test('runs standalone Tao back through the active navigation host', async () => {
    await withTaoFiles(
      'tao-runtime-navigation-test-plan-',
      {
        'Main.test.tao': `
        use NavigationApp from ./

        test "Navigation" {
          check "returns to the active stack root" {
            run NavigationApp
            expect text "Home"
            press text "Open"
            expect text "Detail"
            back
            expect text "Home"
            expect missing text "Detail"
          }
        }
      `,
        'Main.tao': `
        use StackNav from @tao/nav

        app NavigationApp {
          Name "Navigation"
          Navigator StackNav { Initial Home }
        }

        workspace ui Home {
          action Open { present Detail() }
          render Stack(){
            Text("Home")
            Button("Open") { on press Open }
          }
        }

        workspace ui Detail {
          render Text("Detail")
        }

        layout Stack {
          render inject \`\`\`ts
            return <>{_ViewProps.children}</>
          \`\`\`
        }

        view Button Title is text, Press is action() {
          render inject Title, Press \`\`\`ts
            return (
              <RN.Pressable accessibilityRole="button" onPress={() => Press.invoke()}>
                <RN.Text>{Title}</RN.Text>
              </RN.Pressable>
            )
          \`\`\`
        }

        view Text Value is text {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      },
      async paths => {
        await RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)
      },
    )
  })

  Test('reports Tao suite and check context for failed text expectations', async () => {
    await withTaoFiles(
      'tao-runtime-test-plan-',
      {
        'Main.test.tao': `
        use BrokenTextApp from ./

        test "Broken text" {
          check "misses expected text" {
            run BrokenTextApp
            expect text "Expected"
          }
        }
      `,
        'Main.tao': `
        app BrokenTextApp { view MainView }
        view MainView {
          render Text("Actual")
        }
        view Text Value is text {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      },
      async paths => {
        await Expect(RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)).rejects.toThrow(
          /Tao check failed: Broken text > misses expected text[\s\S]*expect text "Expected"[\s\S]*Main\.test\.tao:/,
        )
      },
    )
  })

  Test('reports Tao suite and check context for failed missing text expectations', async () => {
    await withTaoFiles(
      'tao-runtime-test-plan-',
      {
        'Main.test.tao': `
        use BrokenTextApp from ./

        test "Broken missing text" {
          check "still renders unexpected text" {
            run BrokenTextApp
            expect missing text "Actual"
          }
        }
      `,
        'Main.tao': `
        app BrokenTextApp { view MainView }
        view MainView {
          render Text("Actual")
        }
        view Text Value is text {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      },
      async paths => {
        await Expect(RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)).rejects.toThrow(
          /Tao check failed: Broken missing text > still renders unexpected text[\s\S]*expect missing text "Actual"[\s\S]*Main\.test\.tao:/,
        )
      },
    )
  })

  Test('runs multiple Tao suites and cleans up rendered apps between Tao checks', async () => {
    await withTaoFiles(
      'tao-runtime-test-plan-',
      {
        'Main.test.tao': `
        use FirstApp, SecondApp from ./

        test "First isolated suite" {
          check "first app" {
            run FirstApp
            expect text "First"
          }
        }

        test "Second isolated suite" {
          check "second app" {
            run SecondApp
            expect missing text "First"
            expect text "Second"
          }
        }
      `,
        'First.tao': `
        app FirstApp { view MainView }
        view MainView {
          render Text("First")
        }
        view Text Value is text {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
        'Second.tao': `
        app SecondApp { view MainView }
        view MainView {
          render Text("Second")
        }
        view Text Value is text {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      },
      async paths => {
        await RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)
      },
    )
  })

  Test('compiles and renders runtime stdlib imports', async () => {
    const runtimeStdlibTestsPath = Repo.resolvePath('Apps/Test Apps/Runtime Stdlib Tests/Runtime Stdlib Tests.tao')
    const screen = await compileAndRenderApp(runtimeStdlibTestsPath)

    ExpectScreen(screen).toHaveText('Runtime stdlib smoke')
    ExpectScreen(screen).toHaveText('3')
    ExpectScreen(screen).toHaveText('Tap me')
    ExpectScreen(screen).toHaveText('Label')
    ExpectScreen(screen).toHaveText('Wrapped')

    Expect(screen.getByText('Runtime stdlib smoke').props).toMatchObject({
      ellipsizeMode: 'tail',
      numberOfLines: 1,
    })
    Expect(screen.getByText('3').props).toMatchObject({
      ellipsizeMode: 'tail',
      numberOfLines: 1,
    })
    Expect(screen.getByText('Label').props).toMatchObject({
      ellipsizeMode: 'clip',
      numberOfLines: 1,
    })
    Expect(screen.getByText('Wrapped').props.ellipsizeMode).toBeUndefined()
    Expect(screen.getByText('Wrapped').props.numberOfLines).toBeUndefined()
    Expect(ancestorProp(screen.getByText('Tap me'), 'accessibilityRole')).toBe('button')
  })

  Test('passes action values through render inject arguments', async () => {
    await testCompileApp(
      `
        app InjectedActionApp {
          view MainView
        }

        view MainView {
          state Count = 0
          action AddOne {
            set Count += 1
          }
          render Stack(){
            NativeButton("Native add", AddOne)
            Number(Count)
          }
        }

        layout Stack {
          render inject \`\`\`ts
            return <>{_ViewProps.children}</>
          \`\`\`
        }

        view NativeButton Title is text, Action is action() {
          render inject Title, Action \`\`\`ts
            return (
              <RN.Pressable accessibilityRole="button" onPress={() => Action.invoke()}>
                <RN.Text>{Title}</RN.Text>
              </RN.Pressable>
            )
          \`\`\`
        }

        view Number Value is number {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      screen => {
        ExpectScreen(screen).toHaveText('0')

        fireEvent.press(screen.getByText('Native add'))
        ExpectScreen(screen).toHaveText('1')
      },
    )
  })

  Test('applies typed defaults for functions, views, layouts, and actions', async () => {
    await testCompileApp(
      `
        app DefaultsApp {
          view MainView
        }

        function Greeting Name is text default "world" returns text = "Hello, { Name }"

        view MainView {
          state Result = ""
          action Save Message is text default "Saved" {
            set Result = Message
          }
          render Stack(){
            Text(Greeting())
            GreetingView()
            NativeButton("Save", Save)
            Text(Result)
          }
        }

        view GreetingView Title is text default "Welcome" {
          render Text(Title)
        }

        layout Stack Gap is number default 8 {
          render inject Gap \`\`\`ts
            return <>
              <RN.Text>{\`Gap \${Gap}\`}</RN.Text>
              {_ViewProps.children}
            </>
          \`\`\`
        }

        view NativeButton Title is text, Action is action {
          render inject Title, Action \`\`\`ts
            return (
              <RN.Pressable accessibilityRole="button" onPress={() => Action.invoke()}>
                <RN.Text>{Title}</RN.Text>
              </RN.Pressable>
            )
          \`\`\`
        }

        view Text Value is text {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      screen => {
        ExpectScreen(screen).toHaveText('Hello, world')
        ExpectScreen(screen).toHaveText('Welcome')
        ExpectScreen(screen).toHaveText('Gap 8')

        fireEvent.press(screen.getByText('Save'))
        ExpectScreen(screen).toHaveText('Saved')
      },
    )
  })

  Test('renders an all-defaulted initial destination', async () => {
    await testCompileApp(
      `
        use StackNav from @tao/nav

        app DefaultsNavigationApp {
          Name "Defaults"
          Navigator StackNav { Initial Home }
        }

        workspace ui Home Title is text default "Welcome home" {
          render Text(Title)
        }

        view Text Value is text {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      screen => {
        ExpectScreen(screen).toHaveText('Welcome home')
      },
    )
  })

  Test('invokes action parameters in declaration order after type-based binding', async () => {
    await testCompileApp(
      `
        app ReorderedActionApp {
          view MainView
        }

        view MainView {
          state Count = 0
          action AddTagged Step is number, Label is text {
            set Count += Step
          }
          action RunAddTagged {
            do AddTagged("tag", 3)
          }
          render Stack(){
            NativeButton("Run reordered action", RunAddTagged)
            Number(Count)
          }
        }

        layout Stack {
          render inject \`\`\`ts
            return <>{_ViewProps.children}</>
          \`\`\`
        }

        view NativeButton Title is text, Action is action {
          render inject Title, Action \`\`\`ts
            return (
              <RN.Pressable accessibilityRole="button" onPress={() => Action.invoke()}>
                <RN.Text>{Title}</RN.Text>
              </RN.Pressable>
            )
          \`\`\`
        }

        view Number Value is number {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      screen => {
        ExpectScreen(screen).toHaveText('0')

        fireEvent.press(screen.getByText('Run reordered action'))
        ExpectScreen(screen).toHaveText('3')
      },
    )
  })

  Test('renders imported project actions as runtime values', async () => {
    await testCompileFiles(
      'Main.tao',
      {
        'Main.tao': `
          app ImportedActionApp {
            view MainView
          }

          use Save from ./Actions.tao

          view MainView {
            render Button("Imported action", Save)
          }

          view Button Title is text, Action is action {
            render inject Title, Action \`\`\`ts
              return <RN.Text>{Title}</RN.Text>
            \`\`\`
          }
        `,
        'Actions.tao': `
          workspace action Save { }
        `,
      },
      screen => {
        ExpectScreen(screen).toHaveText('Imported action')
      },
    )
  })

  Test('emits item constructor fields in declaration order after type-based binding', async () => {
    await testCompileApp(
      `
        app ItemOrderApp {
          view MainView
        }

        type Name is text
        type Age is number
        type Person is {
          Name
          Age
        }

        let Ada = Person { Age: 40, Name: "Ada" }

        view MainView {
          render Keys(Ada)
        }

        view Keys Person {
          render inject Person \`\`\`ts
            return <RN.Text>{Object.keys(Person).join(",")}</RN.Text>
          \`\`\`
        }
      `,
      screen => {
        ExpectScreen(screen).toHaveText('Name,Age')
      },
    )
  })

  Test('rerenders state-backed item member access after state updates', async () => {
    await testCompileApp(
      `
        app StatefulItemMemberApp {
          view MainView
        }

        type Name is text
        type Person is {
          Name
        }

        view MainView {
          state Current = Person { Name: "Ada" }
          action Rename {
            set Current = Person { Name: "Grace" }
          }
          render Stack(){
            Button("Rename", Rename)
            Text(Current.Name)
          }
        }

        layout Stack {
          render inject \`\`\`ts
            return <>{_ViewProps.children}</>
          \`\`\`
        }

        view Button Title is text, Action is action {
          render inject Title, Action \`\`\`ts
            return (
              <RN.Pressable accessibilityRole="button" onPress={() => Action.invoke()}>
                <RN.Text>{Title}</RN.Text>
              </RN.Pressable>
            )
          \`\`\`
        }

        view Text Value is text {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      screen => {
        ExpectScreen(screen).toHaveText('Ada')

        fireEvent.press(screen.getByText('Rename'))
        ExpectScreen(screen).toHaveText('Grace')
      },
    )
  })

  Test('compiles and renders the Layout and App Shell app', async () => {
    const layoutAppPath = Repo.resolvePath('Apps/Test Apps/Layout and App Shell/Layout and App Shell.tao')
    const screen = await compileAndRenderApp(layoutAppPath)
    const viewStyles = screen.UNSAFE_getAllByType(RN.View)
      .map(view => RN.StyleSheet.flatten(view.props.style))
      .filter(Boolean)

    ExpectScreen(screen).toHaveText('Layout and app shell')
    ExpectScreen(screen).toHaveText('This screen should sit inside the default Tao app shell.')
    ExpectScreen(screen).toHaveText('Safe default app frame')
    ExpectScreen(screen).toHaveText('Primary action')
    ExpectScreen(screen).toHaveText('Deterministic')
    Expect(viewStyles.some(style => style.gap === 12 && style.padding === 16 && style.flexGrow === 1)).toBe(true)
    Expect(viewStyles.some(style => style.gap === 8 && style.padding === 12 && style.alignSelf === 'stretch')).toBe(
      true,
    )
    Expect(viewStyles.some(style => style.flexShrink === 1)).toBe(true)
    Expect(viewStyles.some(style => String(style.backgroundColor).startsWith('hsl('))).toBe(false)
  })

  Test('renders the app shell with safe-area padding and keyboard scroll defaults', () => {
    const safeAreaMock = safeAreaContextTestMock()
    safeAreaMock.setSafeAreaInsetsForTests({ bottom: 5, left: 2, right: 3, top: 7 })
    try {
      const screen = render(createElement(
        TR.AppShell,
        null,
        createElement(RN.Text, null, 'Shell content'),
      ))
      const scrollView = screen.UNSAFE_getByType(RN.ScrollView)
      const keyboardView = screen.UNSAFE_getByType(RN.KeyboardAvoidingView)
      const contentStyle = RN.StyleSheet.flatten(scrollView.props.contentContainerStyle)

      ExpectScreen(screen).toHaveText('Shell content')
      Expect(contentStyle).toMatchObject({
        flexGrow: 1,
        paddingBottom: 17,
        paddingLeft: 14,
        paddingRight: 15,
        paddingTop: 19,
      })
      Expect(scrollView.props.keyboardShouldPersistTaps).toBe('handled')
      Expect(keyboardView.props.style).toBeDefined()
    } finally {
      safeAreaMock.setSafeAreaInsetsForTests({ bottom: 0, left: 0, right: 0, top: 0 })
    }
  })

  Test('blocks provider load failures until local data is reset and the app remounts', async () => {
    let firstLoad = true
    let stored: string | undefined
    const provider: TR.DataProvider = {
      load: () => {
        if (firstLoad) {
          firstLoad = false
          throw new Error('storage unavailable')
        }
        return stored
      },
      persist: (_storageKey, snapshot) => {
        stored = snapshot
      },
    }
    const schema = TR.Data.Schema({
      name: 'RecoveryOverlayData',
      schemaVersion: 1,
      entities: {
        Note: {
          collection: 'Notes',
          fields: { Title: { kind: 'text' } },
        },
      },
    }, provider)
    await TR.Data.Settle(schema)
    let mounts = 0

    function RecoveryRoot(): ReactElement {
      const [mount] = useState(() => ++mounts)
      return createElement(RN.Text, null, `Recovery root ${mount}`)
    }

    const screen = render(createElement(
      TR.AppShell,
      null,
      createElement(RecoveryRoot),
    ))

    ExpectScreen(screen).toHaveText("Couldn't load app data")
    ExpectScreen(screen).toHaveText('Could not load local data: storage unavailable')
    Expect(screen.queryByText('Dismiss')).toBeNull()
    await fireEventAsync.press(screen.getByLabelText('Reset local data and reload'))
    await TR.Data.Settle(schema)

    Expect(screen.queryByLabelText('App data load failure')).toBeNull()
    ExpectScreen(screen).toHaveText('Recovery root 2')
    Expect((schema.query({ entity: 'Note', filters: [] }) as unknown[] & { Error: string }).Error).toBe('')
    Expect((JSON.parse(stored!) as { rows: { Note: unknown[] } }).rows.Note).toEqual([])
  })

  Test('provides a runtime parent direction to app root content', async () => {
    await testCompileApp(
      `
        app RootDirectionApp {
            view MainView
        }

        use Text from @tao/ui

        view MainView {
            render Text("Root width fill") [width fill]
        }
      `,
      screen => {
        const textStyle = RN.StyleSheet.flatten(screen.getByText('Root width fill').props.style)

        ExpectScreen(screen).toHaveText('Root width fill')
        Expect(textStyle).toMatchObject({ alignSelf: 'stretch' })
      },
    )
  })

  Test('provides default Tao props to app root injected layouts', async () => {
    await testCompileApp(
      `
        app RootInjectedLayoutDirectionApp {
            view MainView
        }

        layout Screen {
            render inject \`\`\`ts
                const style = TR.Layout.resolve({
                  parentDirection: _ViewProps.__tao?.parentDirection,
                  entries: _ViewProps.__tao?.layout?.entries ?? [],
                })
                return <RN.View testID="root-screen" style={style}>{_ViewProps.children}</RN.View>
            \`\`\`
        }

        view Text Value is text {
            render inject Value \`\`\`ts
                return <RN.Text>{Value}</RN.Text>
            \`\`\`
        }

        view MainView {
            render Screen()[width fill] {
                Text("Root injected fill")
            }
        }
      `,
      screen => {
        const rootScreenStyle = RN.StyleSheet.flatten(screen.getByTestId('root-screen').props.style)

        ExpectScreen(screen).toHaveText('Root injected fill')
        Expect(rootScreenStyle).toMatchObject({ alignSelf: 'stretch' })
      },
    )
  })

  Test('keeps dev chrome disabled by default outside React Native dev mode', () => {
    const restoreDevGlobal = setReactNativeDevModeForTest(false)
    TR.setDevMode()
    try {
      const screen = render(createElement(
        TR.AppShell,
        null,
        createElement(
          TaoRuntimeRow,
          null,
          createElement(TR.Views.Text, null, 'Production shell'),
        ),
      ))
      const viewStyle = RN.StyleSheet.flatten(screen.UNSAFE_getAllByType(RN.View)[0]?.props.style)

      ExpectScreen(screen).toHaveText('Production shell')
      Expect(screen.queryByLabelText('Tao dev menu')).toBeNull()
      Expect(layoutBoundWidth(viewStyle)).toBeUndefined()
    } finally {
      restoreDevGlobal()
    }
  })

  Test('renders a dev menu overlay that toggles layout bounds when dev mode is enabled', () => {
    TR.setDevMode({ layoutBounds: true })

    function MenuApp(): ReactElement {
      return createElement(
        TR.AppShell,
        null,
        createElement(
          TaoRuntimeRow,
          null,
          createElement(TR.Views.Text, null, 'Menu target'),
        ),
      )
    }

    const screen = render(createElement(MenuApp))
    const menuButton = screen.getByLabelText('Tao dev menu')
    const menuStyle = RN.StyleSheet.flatten(menuButton.props.style)

    Expect(menuStyle).toMatchObject({
      bottom: 16,
      borderRadius: 15,
      height: 30,
      position: 'absolute',
      right: 16,
      width: 30,
    })
    Expect(screen.getByText('Τ')).toBeDefined()
    Expect(screen.queryByLabelText('Tao dev overlay')).toBeNull()

    fireEvent.press(menuButton)
    Expect(screen.getByLabelText('Tao dev overlay')).toBeDefined()
    Expect(screen.getByText('Layout bounds On')).toBeDefined()

    fireEvent.press(screen.getByLabelText('Toggle layout bounds'))
    Expect(screen.getByText('Layout bounds Off')).toBeDefined()
    Expect(TR.Dev.isLayoutBoundsEnabled()).toBe(false)
    Expect(
      screen.UNSAFE_getAllByType(RN.View).some(view => {
        const style = RN.StyleSheet.flatten(view.props.style)
        return layoutBoundWidth(style) === 0.5
      }),
    ).toBe(false)

    fireEvent.press(screen.getByLabelText('Tao dev overlay'))
    Expect(screen.queryByLabelText('Tao dev overlay')).toBeNull()
  })

  Test('preserves app state when toggling layout bounds', () => {
    TR.setDevMode({ layoutBounds: true })

    function StatefulChild(): ReactElement {
      const [count, setCount] = useState(0)
      return createElement(
        RN.Pressable,
        { accessibilityRole: 'button', onPress: () => setCount(value => value + 1) },
        createElement(RN.Text, null, `Stateful count ${count}`),
      )
    }

    function StatefulApp(): ReactElement {
      return createElement(
        TR.AppShell,
        null,
        createElement(StatefulChild),
      )
    }

    const screen = render(createElement(StatefulApp))

    fireEvent.press(screen.getByText('Stateful count 0'))
    ExpectScreen(screen).toHaveText('Stateful count 1')

    fireEvent.press(screen.getByLabelText('Tao dev menu'))
    fireEvent.press(screen.getByLabelText('Toggle layout bounds'))

    ExpectScreen(screen).toHaveText('Stateful count 1')
  })

  Test('repositions the dev menu through drag responder events', () => {
    TR.setDevMode({ enabled: true })

    const screen = render(createElement(
      TR.AppShell,
      null,
      createElement(RN.Text, null, 'Drag target'),
    ))

    act(() => {
      const menuButton = screen.getByLabelText('Tao dev menu')
      menuButton.props.onTouchStart({ nativeEvent: { pageX: 100, pageY: 100 } })
      menuButton.props.onTouchMove({ nativeEvent: { pageX: 90, pageY: 80 } })
    })

    const movedStyle = RN.StyleSheet.flatten(screen.getByLabelText('Tao dev menu').props.style)
    Expect(movedStyle).toMatchObject({
      bottom: 36,
      right: 26,
    })

    act(() => {
      const menuButton = screen.getByLabelText('Tao dev menu')
      menuButton.props.onTouchStart({ nativeEvent: { pageX: 100, pageY: 100 } })
      menuButton.props.onTouchMove({ nativeEvent: { pageX: 1000, pageY: 1000 } })
    })

    const clampedStyle = RN.StyleSheet.flatten(screen.getByLabelText('Tao dev menu').props.style)
    Expect(clampedStyle).toMatchObject({
      bottom: 8,
      right: 8,
    })

    act(() => {
      const menuButton = screen.getByLabelText('Tao dev menu')
      menuButton.props.onTouchStart({ nativeEvent: { pageX: 100, pageY: 100 } })
      menuButton.props.onTouchMove({ nativeEvent: { pageX: -10000, pageY: -10000 } })
    })

    const frame = RN.Dimensions.get('window')
    const upperClampedStyle = RN.StyleSheet.flatten(screen.getByLabelText('Tao dev menu').props.style)
    Expect(upperClampedStyle).toMatchObject({
      bottom: Math.max(8, frame.height - 38),
      right: Math.max(8, frame.width - 38),
    })
  })

  Test('does not draw layout bounds when Tao dev mode is disabled', () => {
    TR.setDevMode({ enabled: false })

    const screen = render(createElement(
      TaoRuntimeRow,
      null,
      createElement(TR.Views.Text, null, 'Normal bounds'),
    ))
    const style = RN.StyleSheet.flatten(screen.UNSAFE_getByType(RN.View).props.style)

    Expect(layoutBoundWidth(style)).toBeUndefined()
  })

  Test('draws layout bounds when Tao dev mode enables them', () => {
    TR.setDevMode({ layoutBounds: true })
    const screen = render(createElement(
      TaoRuntimeRow,
      null,
      createElement(TR.Views.Text, null, 'Debug bounds'),
    ))
    const viewStyle = RN.StyleSheet.flatten(screen.UNSAFE_getByType(RN.View).props.style)
    const textStyle = RN.StyleSheet.flatten(screen.getByText('Debug bounds').props.style)

    Expect(layoutBoundWidth(viewStyle)).toBe(0.5)
    Expect(String(layoutBoundColor(viewStyle))).toMatch(/^#[0-9a-f]{6}$/)
    if (viewStyle.boxShadow) {
      Expect(String(viewStyle.boxShadow)).toContain(String(layoutBoundColor(viewStyle)))
    }
    Expect(layoutBoundWidth(textStyle)).toBe(0.5)
    Expect(layoutBoundColor(textStyle)).not.toBe(layoutBoundColor(viewStyle))
  })

  Test('keeps layout bound colors stable across rerenders', () => {
    TR.setDevMode({ layoutBounds: true })

    function RerenderingChild(): ReactElement {
      const [count, setCount] = useState(0)
      return createElement(
        RN.View,
        null,
        createElement(TR.Views.Text, null, 'Stable debug color'),
        createElement(
          RN.Pressable,
          { accessibilityRole: 'button', onPress: () => setCount(value => value + 1) },
          createElement(RN.Text, null, `Force render ${count}`),
        ),
      )
    }

    const screen = render(createElement(RerenderingChild))
    const initialColor = layoutBoundColor(RN.StyleSheet.flatten(screen.getByText('Stable debug color').props.style))

    fireEvent.press(screen.getByText('Force render 0'))

    const nextColor = layoutBoundColor(RN.StyleSheet.flatten(screen.getByText('Stable debug color').props.style))
    Expect(nextColor).toBe(initialColor)
  })

  Test('does not override existing bounding-box styles with dev layout bounds', () => {
    TR.setDevMode({ layoutBounds: true })

    const screen = render(createElement(
      TaoRuntimeBox,
      { __tao: { style: { borderWidth: 1 } } },
      'Already bounded',
    ))
    const style = RN.StyleSheet.flatten(screen.UNSAFE_getByType(RN.View).props.style)

    Expect(style.borderWidth).toBe(1)
    Expect(style.borderColor).toBeUndefined()
    Expect(style.outlineWidth).toBeUndefined()
  })

  Test('preserves resolved Tao layout styles when adding dev layout bounds', () => {
    TR.setDevMode({ layoutBounds: true })

    const screen = render(createElement(
      TaoRuntimeBox,
      { __tao: { layout: TR.Layout.create([['gap', 4]]) } },
      'Resolved style bounds',
    ))
    const style = RN.StyleSheet.flatten(screen.UNSAFE_getByType(RN.View).props.style)

    Expect(style.gap).toBe(4)
    Expect(layoutBoundWidth(style)).toBe(0.5)
  })

  Test('resolves chained Tao props downstream in runtime views', () => {
    TR.setDevMode({ enabled: false })

    const screen = render(createElement(
      TaoRuntimeBox,
      {
        __tao: TR.TaoProps(
          {
            layout: TR.Layout.create([['gap', 4]]),
            style: { borderWidth: 1 },
          },
          {
            layout: TR.Layout.create([['pad', 6]]),
            style: { borderColor: 'red' },
          },
        ),
      },
      'Chained props',
    ))
    const style = RN.StyleSheet.flatten(screen.UNSAFE_getByType(RN.View).props.style)

    Expect(style.gap).toBe(4)
    Expect(style.padding).toBe(6)
    Expect(style.borderColor).toBe('red')
    Expect(style.borderWidth).toBe(1)
  })

  Test('uses the immediate runtime parent direction for children', () => {
    TR.setDevMode({ enabled: false })

    const screen = render(createElement(
      TaoRuntimeRow,
      null,
      createElement(
        TR.Views.Text,
        {
          __tao: TR.TaoProps({
            layout: TR.Layout.create([['width', 'fill']]),
            parentDirection: 'column',
          }),
        },
        'Immediate direction',
      ),
    ))
    const style = RN.StyleSheet.flatten(screen.getByText('Immediate direction').props.style)

    Expect(style.flexGrow).toBe(1)
    Expect(style.alignSelf).toBeUndefined()
  })

  Test('preserves existing child caller props when adding parent direction', () => {
    TR.setDevMode({ enabled: false })

    const screen = render(createElement(
      TaoRuntimeRow,
      null,
      createElement(
        TR.Views.Text,
        {
          __tao: TR.TaoProps(
            { layout: TR.Layout.create([['width', 'fill']]) },
            {
              parentDirection: 'column',
              style: { borderWidth: 2 },
            },
          ),
        },
        'Preserved caller props',
      ),
    ))
    const style = RN.StyleSheet.flatten(screen.getByText('Preserved caller props').props.style)

    Expect(style.borderWidth).toBe(2)
    Expect(style.flexGrow).toBe(1)
    Expect(style.alignSelf).toBeUndefined()
  })

  Test('forwards content layout through custom layout wrappers', async () => {
    await testCompileApp(
      `
        app WrapperLayout {
            view MainView
        }

        use Col, Text from @tao/ui

        layout Screen {
            render Col(){
                Text("Wrapped center")
            }
        }

        view MainView {
            render Screen()[content center]
        }
      `,
      screen => {
        const centeredView = screen.UNSAFE_getAllByType(RN.View).find(view => {
          const style = RN.StyleSheet.flatten(view.props.style)
          return style?.alignItems === 'center' && style.justifyContent === 'center'
        })

        ExpectScreen(screen).toHaveText('Wrapped center')
        Expect(centeredView).toBeDefined()
      },
    )
  })

  Test('does not forward caller layout into nested render statements', async () => {
    await testCompileApp(
      `
        app NestedRenderLayout {
            view MainView
        }

        use Col, Row, Text from @tao/ui

        layout Card {
            render Col(){
                render Row(){
                    Text("Nested render layout")
                }
            }
        }

        view MainView {
            render Card()[gap 9]
        }
      `,
      screen => {
        const gapNineViews = screen.UNSAFE_getAllByType(RN.View).filter(view => {
          const style = RN.StyleSheet.flatten(view.props.style)
          return style?.gap === 9
        })

        ExpectScreen(screen).toHaveText('Nested render layout')
        Expect(gapNineViews).toHaveLength(1)
      },
    )
  })

  Test('runs actions whose parameters shadow generated runtime names', async () => {
    await testCompileApp(
      `
        app ShadowedActionParameterApp {
          view MainView
        }

        view MainView {
          state Count = 0
          action AddStep _Scope is number {
            set Count += _Scope
          }
          action AddOne {
            do AddStep(1)
          }
          render Stack(){
            NativeButton("Add with shadowed parameter", AddOne)
            Number(Count)
          }
        }

        layout Stack {
          render inject \`\`\`ts
            return <>{_ViewProps.children}</>
          \`\`\`
        }

        view NativeButton Title is text, Action is action {
          render inject Title, Action \`\`\`ts
            return (
              <RN.Pressable accessibilityRole="button" onPress={() => Action.invoke()}>
                <RN.Text>{Title}</RN.Text>
              </RN.Pressable>
            )
          \`\`\`
        }

        view Number Value is number {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      screen => {
        ExpectScreen(screen).toHaveText('0')

        fireEvent.press(screen.getByText('Add with shadowed parameter'))
        ExpectScreen(screen).toHaveText('1')
      },
    )
  })

  Test('lets caller layout override custom layout wrapper root layout', async () => {
    await testCompileApp(
      `
        app WrapperLayoutOverride {
            view MainView
        }

        use Row, Text from @tao/ui

        layout Screen {
            render Row()[gap 12, content spread center] {
                Text("Wrapped gap")
            }
        }

        view MainView {
            render Screen()[gap 8]
        }
      `,
      screen => {
        const viewStyles = screen.UNSAFE_getAllByType(RN.View)
          .map(view => RN.StyleSheet.flatten(view.props.style))
          .filter(Boolean)

        ExpectScreen(screen).toHaveText('Wrapped gap')
        Expect(viewStyles.some(style => style.gap === 8)).toBe(true)
        Expect(viewStyles.some(style => style.gap === 12)).toBe(false)
      },
    )
  })

  Test('overlays compiled layout clauses over stdlib layout defaults', async () => {
    await testCompileApp(
      `
        app ExplicitRowLayout {
            view MainView
        }

        use Row, Text from @tao/ui

        view MainView {
            render Row()[content right, gap 4, claim 2] {
                Text("Explicit row")
            }
        }
      `,
      screen => {
        const rowStyle = screen.UNSAFE_getAllByType(RN.View)
          .map(view => RN.StyleSheet.flatten(view.props.style))
          .find(style => style?.gap === 4)

        ExpectScreen(screen).toHaveText('Explicit row')
        Expect(rowStyle).toMatchObject({
          alignItems: 'baseline',
          alignSelf: 'stretch',
          flexDirection: 'row',
          flexGrow: 2,
          gap: 4,
          justifyContent: 'flex-end',
        })
      },
    )
  })

  Test('applies axis-relative fill through custom layout root layout clauses', async () => {
    await testCompileApp(
      `
        app WrapperLayoutFill {
            view MainView
        }

        use Box, Row, Text from @tao/ui

        layout Screen {
            render Box()[fill] {
                Text("Root fill")
            }
        }

        view MainView {
            render Row()[gap 3] {
                Screen()
            }
        }
      `,
      screen => {
        const boxStyle = screen.UNSAFE_getAllByType(RN.View)
          .map(view => RN.StyleSheet.flatten(view.props.style))
          .find(style =>
            style?.gap === undefined
            && style?.flexDirection === 'row'
            && style?.flexGrow === 1
            && style?.alignSelf === 'stretch'
          )

        ExpectScreen(screen).toHaveText('Root fill')
        Expect(boxStyle).toBeDefined()
      },
    )
  })

  Test('does not apply stdlib layout identity to local stdlib-named views', async () => {
    await testCompileApp(
      `
        app LocalRowIdentity {
            view MainView
        }

        view Row {
            render inject \`\`\`ts
                const style = TR.Layout.resolve({
                  entries: _ViewProps.__tao?.layout?.entries ?? [],
                })
                return <RN.View style={style}>{_ViewProps.children}</RN.View>
            \`\`\`
        }

        view Text Value is text {
            render inject Value \`\`\`ts
                return <RN.Text>{Value}</RN.Text>
            \`\`\`
        }

        view MainView {
            render Row()[gap 4] {
                Text("Local row")
            }
        }
      `,
      screen => {
        const localRowStyle = screen.UNSAFE_getAllByType(RN.View)
          .map(view => RN.StyleSheet.flatten(view.props.style))
          .find(style => style?.gap === 4)

        ExpectScreen(screen).toHaveText('Local row')
        Expect(localRowStyle).toMatchObject({ gap: 4 })
        Expect(localRowStyle?.flexDirection).toBeUndefined()
      },
    )
  })

  Test('renders imported alias references through circular module imports', async () => {
    await testCompileFiles(
      'Main.tao',
      {
        'Main.tao': `
          app CircularAliasApp {
              view MainView
          }

          use AView from ./

          view MainView {
              render AView()
          }
        `,
        'A.tao': `
          use BView from ./

          workspace let SharedTitle = "Circular alias"

          workspace view AView {
              render BView()
          }
        `,
        'B.tao': `
          use SharedTitle from ./

          let ImportedTitle = SharedTitle

          workspace view BView {
              render Text(ImportedTitle)
          }

          view Text Value is text {
              render inject Value \`\`\`ts
                  return <RN.Text>{Value}</RN.Text>
              \`\`\`
          }
        `,
      },
      screen => {
        ExpectScreen(screen).toHaveText('Circular alias')
      },
    )
  })

  Test('renders alias references to earlier aliases', async () => {
    await testCompileApp(
      `
        app OrderedAlias {
            view MainView
        }

        let Message = "Ordered output"
        let Greeting = Message

        view MainView {
            render Text(Greeting) { }
        }

        view Text Value is text {
            render inject Value \`\`\`ts
                return <RN.Text>{Value}</RN.Text>
            \`\`\`
        }
      `,
      screen => {
        ExpectScreen(screen).toHaveText('Ordered output')
      },
    )
  })

  Test('renders block-local aliases that shadow file-level aliases', async () => {
    await testCompileApp(
      `
        app ScopedAlias {
            view MainView
        }

        let Greeting = "Outer"

        view MainView {
            let OuterGreeting = Greeting
            render Stack(){
                let Greeting = "Inner"
                Text(Greeting)
                Text(OuterGreeting)
            }
        }

        layout Stack {
            render inject \`\`\`ts
                return <>{_ViewProps.children}</>
            \`\`\`
        }

        view Text Value is text {
            render inject Value \`\`\`ts
                return <RN.Text>{Value}</RN.Text>
            \`\`\`
        }
      `,
      screen => {
        ExpectScreen(screen).toHaveText('Inner')
        ExpectScreen(screen).toHaveText('Outer')
      },
    )
  })
})

type SafeAreaContextTestMock = {
  setSafeAreaInsetsForTests(insets: { bottom: number; left: number; right: number; top: number }): void
}

function safeAreaContextTestMock(): SafeAreaContextTestMock {
  return require('react-native-safe-area-context') as SafeAreaContextTestMock
}

function layoutBoundWidth(style: { borderWidth?: unknown; outlineWidth?: unknown } | undefined): unknown {
  return style?.outlineWidth ?? style?.borderWidth
}

function layoutBoundColor(style: { borderColor?: unknown; outlineColor?: unknown } | undefined): unknown {
  return style?.outlineColor ?? style?.borderColor
}

function setReactNativeDevModeForTest(value: boolean): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, '__DEV__')
  Object.defineProperty(globalThis, '__DEV__', {
    configurable: true,
    value,
    writable: true,
  })
  return () => {
    if (descriptor) {
      Object.defineProperty(globalThis, '__DEV__', descriptor)
      return
    }
    delete (globalThis as { __DEV__?: unknown }).__DEV__
  }
}

function TaoRuntimeBox(props: { __tao?: TR.TaoProps; children?: ReactNode }): ReactElement {
  return TR.Views.View(props, {
    direction: 'row',
    layout: TR.Layout.create([['content', 'left', 'center'], ['hug']]),
  })
}

function TaoRuntimeRow(props: { __tao?: TR.TaoProps; children?: ReactNode }): ReactElement {
  return TR.Views.View(props, {
    direction: 'row',
    layout: TR.Layout.create([['content', 'baseline', 'left'], ['fill']]),
  })
}

function ancestorProp(node: { parent?: any }, prop: string): unknown {
  let current = node.parent
  while (current) {
    if (current.props?.[prop] !== undefined) {
      return current.props[prop]
    }
    current = current.parent
  }
  return undefined
}
