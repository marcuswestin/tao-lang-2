import { jest } from '@jest/globals'
import TR from '@runtime/TR'
import { Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { act, fireEvent, fireEventAsync, render } from '@testing-library/react-native'
import { createElement, type ReactElement, type ReactNode, useState } from 'react'
import * as RN from 'react-native'
import {
  compileAndRenderApp,
  ExpectScreen,
  registerRuntimeE2ELifecycle,
  testCompileApp,
} from './test-compile-app'

registerRuntimeE2ELifecycle()

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
