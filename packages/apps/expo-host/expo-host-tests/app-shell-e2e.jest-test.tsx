import { jest } from '@jest/globals'
import TR from '@runtime/TR'
import * as TaoReactNative from '@runtime/TR-react-native'
import { Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { render } from '@testing-library/react-native'
import { createElement } from 'react'
import * as RN from 'react-native'
import {
  compileAndRenderApp,
  ExpectScreen,
  registerRuntimeE2ELifecycle,
  testCompileApp,
} from './test-compile-app'

registerRuntimeE2ELifecycle()

Describe('Expo runtime', () => {
  Test('compiles and renders the Layout and App Shell app', async () => {
    const layoutAppPath = Repo.resolvePath('Apps/Test Apps/Layout and App Shell/Layout and App Shell.tao')
    const screen = await compileAndRenderApp(layoutAppPath)
    const viewStyles = screen.UNSAFE_getAllByType(RN.View)
      .map(view => RN.StyleSheet.flatten(view.props.style))
      .filter(Boolean)

    Expect(screen.getAllByText('Layout and app shell')).toHaveLength(2)
    Expect(screen.getByRole('header').props.children).toBe('Layout and app shell')
    ExpectScreen(screen).toHaveText('Safe default app frame')
    ExpectScreen(screen).toHaveText('Primary action')
    Expect(viewStyles.some(style => style.gap === 12 && style.padding === 16 && style.flexGrow === 1)).toBe(true)
    Expect(viewStyles.some(style => style.gap === 8 && style.padding === 12 && style.alignSelf === 'stretch')).toBe(
      true,
    )
    Expect(viewStyles.some(style => String(style.backgroundColor).startsWith('hsl('))).toBe(false)
  })

  Test('renders the app shell with safe-area padding and keyboard scroll defaults', () => {
    const safeAreaMock = safeAreaContextTestMock()
    safeAreaMock.setSafeAreaInsetsForTests({ bottom: 5, left: 2, right: 3, top: 7 })
    try {
      // The app host composes AppSurfaceFrame inside AppShell around every navigator that does not
      // hand the window to a native surface; this renders that same composition directly.
      const screen = render(createElement(
        TR.AppShell,
        null,
        createElement(TR.AppSurfaceFrame, null, createElement(RN.Text, null, 'Shell content')),
      ))
      const scrollView = screen.UNSAFE_getByType(RN.ScrollView)
      screen.UNSAFE_getByType(RN.KeyboardAvoidingView)
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
    } finally {
      safeAreaMock.setSafeAreaInsetsForTests({ bottom: 0, left: 0, right: 0, top: 0 })
    }
  })

  Test('adjusts every native iPad inset while preserving other platforms and manual safe-area padding', () => {
    const safeAreaMock = safeAreaContextTestMock()
    safeAreaMock.setSafeAreaInsetsForTests({ bottom: 5, left: 240, right: 3, top: 7 })
    const runtime = {
      ActivityIndicator: RN.ActivityIndicator,
      Image: RN.Image,
      KeyboardAvoidingView: RN.KeyboardAvoidingView,
      Pressable: RN.Pressable,
      ScrollView: RN.ScrollView,
      Switch: RN.Switch,
      Text: RN.Text,
      TextInput: RN.TextInput,
      View: RN.View,
    }
    const restoreRuntime = jest.spyOn(TaoReactNative, 'requireReactNativeRuntime')
    try {
      for (
        const scenario of [
          { isPad: true, isMacCatalyst: false, nativeInsets: true, adjustment: 'always' },
          { isPad: false, isMacCatalyst: false, nativeInsets: true, adjustment: 'automatic' },
          { isPad: true, isMacCatalyst: true, nativeInsets: true, adjustment: 'automatic' },
          { isPad: true, isMacCatalyst: false, nativeInsets: false, adjustment: undefined },
        ]
      ) {
        const platform = { OS: 'ios', isPad: scenario.isPad, isMacCatalyst: scenario.isMacCatalyst }
        restoreRuntime.mockReturnValue({ ...runtime, Platform: platform })
        const screen = render(createElement(
          TR.AppShell,
          null,
          createElement(
            TR.AppSurfaceFrame,
            { nativeInsets: scenario.nativeInsets },
            createElement(RN.Text, null, 'Inset content'),
          ),
        ))
        try {
          const scrollView = screen.UNSAFE_getByType(RN.ScrollView)
          Expect(scrollView.props.contentInsetAdjustmentBehavior).toBe(scenario.adjustment)
          Expect(RN.StyleSheet.flatten(scrollView.props.contentContainerStyle)).toMatchObject(
            scenario.nativeInsets
              ? { paddingBottom: 12, paddingLeft: 12, paddingRight: 12, paddingTop: 12 }
              : { paddingBottom: 17, paddingLeft: 252, paddingRight: 15, paddingTop: 19 },
          )
        } finally {
          screen.unmount()
        }
      }
    } finally {
      restoreRuntime.mockRestore()
      safeAreaMock.setSafeAreaInsetsForTests({ bottom: 0, left: 0, right: 0, top: 0 })
    }
  })

  Test('provides a runtime parent direction to app root content', async () => {
    await testCompileApp(
      `
        app RootDirectionApp {
            view MainView
        }

        use Text from @tao/ui

        view MainView() {
            render Text("Root width fill") [width fill]
        }
      `,
      screen => {
        const textStyle = RN.StyleSheet.flatten(screen.getByText('Root width fill').props.style)

        Expect(textStyle).toMatchObject({ alignSelf: 'stretch' })
      },
    )
  })

  Test('provides default Tao props to app root injected views', async () => {
    await testCompileApp(
      `
        app RootInjectedLayoutDirectionApp {
            view MainView
        }

        view Screen() {
            render inject Content @@content, Layout @@layout \`\`\`ts
                return TR.Views.View(
                  { children: Content, layout: Layout },
                  { nativeProps: { testID: 'root-screen' } },
                )
            \`\`\`
        }

        view Text(Value text) {
            render inject Value \`\`\`ts
                return <RN.Text>{Value}</RN.Text>
            \`\`\`
        }

        view MainView() {
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
})

type SafeAreaContextTestMock = {
  setSafeAreaInsetsForTests(insets: { bottom: number; left: number; right: number; top: number }): void
}

function safeAreaContextTestMock(): SafeAreaContextTestMock {
  return require('react-native-safe-area-context') as SafeAreaContextTestMock
}
