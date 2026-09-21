import { Describe, Expect, Test } from '@shared/test'
import * as RN from 'react-native'
import { ExpectScreen, registerRuntimeE2ELifecycle, testCompileApp } from './test-compile-app'

registerRuntimeE2ELifecycle()

const insets = { bottom: 5, left: 2, right: 3, top: 7 }

function setInsets(): void {
  (require('react-native-safe-area-context') as {
    setSafeAreaInsetsForTests(value: typeof insets): void
  }).setSafeAreaInsetsForTests(insets)
}

function resetInsets(): void {
  (require('react-native-safe-area-context') as {
    setSafeAreaInsetsForTests(value: typeof insets): void
  }).setSafeAreaInsetsForTests({ bottom: 0, left: 0, right: 0, top: 0 })
}

Describe('Expo runtime: SelectionNav display modes', () => {
  Test('insets a "tabs" display exactly once through the shared app-host frame', async () => {
    setInsets()
    try {
      await testCompileApp(
        `
          use SelectionNav from @tao/nav
          use Text from @tao/ui

          let MainSelection = SelectionNav {
            Initial @home
            Display "tabs"
            @home { Label "Home" Content Home }
            @settings { Label "Settings" Content Settings }
          }

          app TabsApp {
            Name "Tabs"
            Navigator MainSelection
          }

          scene Home() {
            Title "Home"
            render Text("Home body")
          }
          scene Settings() {
            Title "Settings"
            render Text("Settings body")
          }
        `,
        screen => {
          ExpectScreen(screen).toHaveText('Home body')
          const scrollViews = screen.UNSAFE_getAllByType(RN.ScrollView)
          Expect(scrollViews).toHaveLength(1)
          Expect(RN.StyleSheet.flatten(scrollViews[0]!.props.contentContainerStyle)).toMatchObject({
            paddingBottom: 12 + insets.bottom,
            paddingLeft: 12 + insets.left,
            paddingRight: 12 + insets.right,
            paddingTop: 12 + insets.top,
          })
        },
      )
    } finally {
      resetInsets()
    }
  })

  Test('insets a "toggle" display\'s content independently of its floating bar', async () => {
    setInsets()
    try {
      await testCompileApp(
        `
          use SelectionNav from @tao/nav
          use Text from @tao/ui

          let MainSelection = SelectionNav {
            Initial @home
            Display "toggle"
            @home { Label "Home" Content Home }
            @settings { Label "Settings" Content Settings }
          }

          app ToggleApp {
            Name "Toggle"
            Navigator MainSelection
          }

          scene Home() {
            Title "Home"
            render Text("Home body")
          }
          scene Settings() {
            Title "Settings"
            render Text("Settings body")
          }
        `,
        screen => {
          ExpectScreen(screen).toHaveText('Home body')
          // The toggle bar computes its own bottom offset from the live insets (TR-navigation-toggle-bar);
          // this asserts each item's own AppSurfaceFrame instead — both items stay mounted (one hidden),
          // each framed once, and the app host does not also wrap them because a "toggle" SelectionNav
          // owns its window.
          const scrollViews = screen.UNSAFE_getAllByType(RN.ScrollView)
          Expect(scrollViews).toHaveLength(2)
          // Content also clears the floating toggle bar itself (barHeight 48 + barGap 8 * 2 = 64), on
          // top of the ordinary frame padding and inset.
          const toggleBarClearance = 64
          for (const scrollView of scrollViews) {
            Expect(RN.StyleSheet.flatten(scrollView.props.contentContainerStyle)).toMatchObject({
              paddingBottom: 12 + insets.bottom + toggleBarClearance,
              paddingLeft: 12 + insets.left,
              paddingRight: 12 + insets.right,
              paddingTop: 12 + insets.top,
            })
          }
        },
      )
    } finally {
      resetInsets()
    }
  })
})
