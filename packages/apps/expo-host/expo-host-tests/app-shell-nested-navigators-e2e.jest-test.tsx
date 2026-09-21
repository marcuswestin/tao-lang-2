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

/**
 * A window-owning navigator (a stack) frames its own screens; the surrounding host — a SlotNav, an
 * enclosing stack entry, or the app host itself — must not add a second AppSurfaceFrame around
 * something that already insets itself. Each test below asserts a single ScrollView with padding
 * derived from the mocked insets exactly once, rather than doubled.
 */
Describe('Expo runtime: nested window-owning navigators', () => {
  Test('insets a StackNav held as a SlotNav Initial value exactly once', async () => {
    setInsets()
    try {
      await testCompileApp(
        `
          use SlotNav, StackNav from @tao/nav
          use Text from @tao/ui

          let InnerStack = StackNav { Initial InnerHome }

          app NestedSlotApp {
            Name "Nested Slot"
            Navigator SlotNav { Initial InnerStack }
          }

          scene InnerHome() {
            Title "Inner Home"
            render Text("Inner Home body")
          }
        `,
        screen => {
          ExpectScreen(screen).toHaveText('Inner Home body')
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

  Test('insets a StackNav held as another StackNav Initial value exactly once', async () => {
    setInsets()
    try {
      await testCompileApp(
        `
          use StackNav from @tao/nav
          use Text from @tao/ui

          nav InnerStack = StackNav {
            Initial InnerHome
            Title "Inner Stack"
          }

          app NestedStackApp {
            Name "Nested Stack"
            Navigator StackNav { Initial InnerStack }
          }

          scene InnerHome() {
            Title "Inner Home"
            render Text("Inner Home body")
          }
        `,
        screen => {
          ExpectScreen(screen).toHaveText('Inner Home body')
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

  Test('insets an app auxiliary independently of a window-owning main navigator', async () => {
    setInsets()
    try {
      await testCompileApp(
        `
          use SlotNav, StackNav from @tao/nav
          use Text from @tao/ui

          app AuxiliaryApp {
            Name "Auxiliary"
            Navigator StackNav { Initial Home }
            @window SlotNav { Initial AuxiliaryScreen }
          }

          scene Home() {
            Title "Home"
            render Text("Home body")
          }

          scene AuxiliaryScreen() {
            Title "Auxiliary"
            render Text("Auxiliary content")
          }
        `,
        screen => {
          ExpectScreen(screen).toHaveText('Home body')
          ExpectScreen(screen).toHaveText('Auxiliary content')
          // The main StackNav screen and the `@window` auxiliary each get their own AppSurfaceFrame:
          // the main navigator owns its window and frames itself; the auxiliary does not, and needs
          // one from the app host regardless of what the main navigator does.
          const scrollViews = screen.UNSAFE_getAllByType(RN.ScrollView)
          Expect(scrollViews).toHaveLength(2)
          for (const scrollView of scrollViews) {
            Expect(RN.StyleSheet.flatten(scrollView.props.contentContainerStyle)).toMatchObject({
              paddingBottom: 12 + insets.bottom,
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
