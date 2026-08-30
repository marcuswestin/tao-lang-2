import TR from '@runtime/TR'
import { Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { fireEvent, render } from '@testing-library/react-native'
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

    ExpectScreen(screen).toHaveText('Layout and app shell')
    ExpectScreen(screen).toHaveText('This screen should sit inside the default Tao app shell.')
    ExpectScreen(screen).toHaveText('Safe default app frame')
    ExpectScreen(screen).toHaveText('Primary action')
    ExpectScreen(screen).toHaveText('Deterministic')
    ExpectScreen(screen).toHaveText('Adaptive primary pane')
    ExpectScreen(screen).toHaveText('Adaptive secondary pane')
    Expect(viewStyles.some(style => style.gap === 12 && style.padding === 16 && style.flexGrow === 1)).toBe(true)
    Expect(viewStyles.some(style => style.gap === 8 && style.padding === 12 && style.alignSelf === 'stretch')).toBe(
      true,
    )
    Expect(viewStyles.some(style => style.flexShrink === 1)).toBe(true)
    Expect(viewStyles.some(style => String(style.backgroundColor).startsWith('hsl('))).toBe(false)

    const panes = screen.getByTestId('layoutPanes')
    Expect(RN.StyleSheet.flatten(panes.props.style)).toMatchObject({ flexDirection: 'column', gap: 16 })
    fireEvent(panes, 'layout', { nativeEvent: { layout: { width: 656 } } })
    Expect(RN.StyleSheet.flatten(panes.props.style)).toMatchObject({ flexDirection: 'row', gap: 16 })

    const scrollView = screen.getByTestId('layoutScroll')
    Expect(RN.StyleSheet.flatten(scrollView.props.style)).toMatchObject({ flexGrow: 2 })
    Expect(RN.StyleSheet.flatten(scrollView.props.contentContainerStyle)).toMatchObject({
      flexDirection: 'column',
      flexGrow: 1,
      gap: 6,
      padding: 8,
    })
    Expect(RN.StyleSheet.flatten(screen.getByTestId('layoutReadable').props.style)).toMatchObject({ maxWidth: 720 })
    Expect(RN.StyleSheet.flatten(screen.getByTestId('layoutSecondary').props.style)).toMatchObject({ flexGrow: 1 })
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

        ExpectScreen(screen).toHaveText('Root width fill')
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
