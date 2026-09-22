import { Describe, Expect, Test } from '@shared/test'
import type { screen as Screen } from '@testing-library/react-native'
import * as RN from 'react-native'
import { ExpectScreen, registerRuntimeE2ELifecycle, testCompileApp } from './test-compile-app'

registerRuntimeE2ELifecycle()

const insets = { bottom: 5, left: 2, right: 3, top: 7 }

function setInsets(): void {
  ;(require('react-native-safe-area-context') as {
    setSafeAreaInsetsForTests(value: typeof insets): void
  }).setSafeAreaInsetsForTests(insets)
}

function resetInsets(): void {
  ;(require('react-native-safe-area-context') as {
    setSafeAreaInsetsForTests(value: typeof insets): void
  }).setSafeAreaInsetsForTests({ bottom: 0, left: 0, right: 0, top: 0 })
}

function hasScrollViewAncestor(instance: ReturnType<typeof Screen.UNSAFE_getAllByType>[number]): boolean {
  for (let current = instance.parent; current; current = current.parent) {
    if (current.type === RN.ScrollView) {
      return true
    }
  }
  return false
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

  Test('frames a SplitNav with only plain panes pane by pane, on the window edges each pane meets', async () => {
    setInsets()
    try {
      await testCompileApp(
        `
          use SplitNav from @tao/nav
          use Text from @tao/ui

          app PlainSplitApp {
            Name "Plain Split"
            Navigator SplitNav {
              @sidebar {
                Content Sidebar
                Width 240
                Resizable false
              }
              @main {
                Content Main
                Width 640
                Resizable false
              }
            }
          }

          view Sidebar() {
            render Text("Sidebar body")
          }

          view Main() {
            render Text("Main body")
          }
        `,
        screen => {
          ExpectScreen(screen).toHaveText('Sidebar body')
          ExpectScreen(screen).toHaveText('Main body')
          // A split always takes the window and frames each pane itself, so the panes scroll
          // independently; each insets only the window edges it meets and never the shared one.
          const scrollViews = screen.UNSAFE_getAllByType(RN.ScrollView)
          Expect(scrollViews).toHaveLength(2)
          const paddings = scrollViews.map(scrollView => RN.StyleSheet.flatten(scrollView.props.contentContainerStyle))
          Expect(paddings).toEqual(expect.arrayContaining([
            expect.objectContaining({
              paddingBottom: 12 + insets.bottom,
              paddingLeft: 12 + insets.left,
              paddingRight: 12,
              paddingTop: 12 + insets.top,
            }),
            expect.objectContaining({
              paddingBottom: 12 + insets.bottom,
              paddingLeft: 12,
              paddingRight: 12 + insets.right,
              paddingTop: 12 + insets.top,
            }),
          ]))
          for (const scrollView of scrollViews) {
            Expect(hasScrollViewAncestor(scrollView)).toBe(false)
          }
        },
      )
    } finally {
      resetInsets()
    }
  })

  Test("insets a SplitNav nested in another split's pane on the edges both splits say it meets", async () => {
    setInsets()
    try {
      await testCompileApp(
        `
          use SplitNav from @tao/nav
          use Text from @tao/ui

          nav InnerSplit = SplitNav {
            @left {
              Content InnerLeft
              Width 200
              Resizable false
            }
            @right {
              Content InnerRight
              Width 300
              Resizable false
            }
          }

          app NestedSplitApp {
            Name "Nested Split"
            Navigator SplitNav {
              @sidebar {
                Content Sidebar
                Width 240
                Resizable false
              }
              @main {
                Content InnerSplit
                Width 640
                Resizable false
              }
            }
          }

          view Sidebar() {
            render Text("Sidebar body")
          }

          view InnerLeft() {
            render Text("Inner left")
          }

          view InnerRight() {
            render Text("Inner right")
          }
        `,
        screen => {
          ExpectScreen(screen).toHaveText('Inner left')
          // The inner split frames its own panes; its left pane sits on the outer split's shared
          // edge, not the window's, so it takes no left inset — the defaults compose, never replace.
          const scrollViews = screen.UNSAFE_getAllByType(RN.ScrollView)
          Expect(scrollViews).toHaveLength(3)
          const paddings = scrollViews.map(scrollView => RN.StyleSheet.flatten(scrollView.props.contentContainerStyle))
          Expect(paddings).toEqual(expect.arrayContaining([
            expect.objectContaining({ paddingLeft: 12 + insets.left, paddingRight: 12 }),
            expect.objectContaining({ paddingLeft: 12, paddingRight: 12 }),
            expect.objectContaining({ paddingLeft: 12, paddingRight: 12 + insets.right }),
          ]))
        },
      )
    } finally {
      resetInsets()
    }
  })

  Test('leaves a SplitNav pane that holds a window-owning navigator to frame its own screens', async () => {
    setInsets()
    try {
      await testCompileApp(
        `
          use SplitNav, StackNav from @tao/nav
          use Text from @tao/ui

          nav MainStack = StackNav { Initial MainHome }

          app SplitPaneApp {
            Name "Split Pane"
            Navigator SplitNav {
              @sidebar {
                Content Sidebar
                Width 240
                Resizable false
              }
              @main {
                Content MainStack
                Width 640
                Resizable false
              }
            }
          }

          view Sidebar() {
            render Text("Sidebar body")
          }

          scene MainHome() {
            Title "Main Home"
            render Text("Main Home body")
          }
        `,
        screen => {
          ExpectScreen(screen).toHaveText('Sidebar body')
          ExpectScreen(screen).toHaveText('Main Home body')
          // The stack pane frames its own screen, so the app host must not frame the whole split
          // around it: the split takes the window and frames the plain sidebar pane itself. Each
          // pane insets only the window edges it meets — the sidebar its left edge, the stack's
          // screen its right — and neither the edge they share.
          const scrollViews = screen.UNSAFE_getAllByType(RN.ScrollView)
          Expect(scrollViews).toHaveLength(2)
          const paddings = scrollViews.map(scrollView => RN.StyleSheet.flatten(scrollView.props.contentContainerStyle))
          Expect(paddings).toEqual(expect.arrayContaining([
            expect.objectContaining({
              paddingBottom: 12 + insets.bottom,
              paddingLeft: 12 + insets.left,
              paddingRight: 12,
              paddingTop: 12 + insets.top,
            }),
            expect.objectContaining({
              paddingBottom: 12 + insets.bottom,
              paddingLeft: 12,
              paddingRight: 12 + insets.right,
              paddingTop: 12 + insets.top,
            }),
          ]))
          for (const scrollView of scrollViews) {
            Expect(hasScrollViewAncestor(scrollView)).toBe(false)
          }
        },
      )
    } finally {
      resetInsets()
    }
  })

  Test('adds no second live inset to a window-owning navigator a scene renders inline', async () => {
    setInsets()
    try {
      await testCompileApp(
        `
          use StackNav from @tao/nav
          use Col, Text from @tao/ui

          nav Inner = StackNav { Initial InnerHome }

          app InlineNavApp {
            Name "Inline Nav"
            view Shell
          }

          view Shell() {
            render Col() [fill] {
              Text("Shell body")
              Inner() [fill]
            }
          }

          scene InnerHome() {
            Title "Inner Home"
            render Text("Inner Home body")
          }
        `,
        screen => {
          ExpectScreen(screen).toHaveText('Shell body')
          ExpectScreen(screen).toHaveText('Inner Home body')
          // The shell's own frame, from the app host, already stands between the inline stack and
          // the window: the stack's screen keeps its fixed gutter and adds no live inset of its own.
          const scrollViews = screen.UNSAFE_getAllByType(RN.ScrollView)
          Expect(scrollViews).toHaveLength(2)
          const paddings = scrollViews.map(scrollView => RN.StyleSheet.flatten(scrollView.props.contentContainerStyle))
          Expect(paddings).toEqual(expect.arrayContaining([
            expect.objectContaining({
              paddingBottom: 12 + insets.bottom,
              paddingLeft: 12 + insets.left,
              paddingRight: 12 + insets.right,
              paddingTop: 12 + insets.top,
            }),
            expect.objectContaining({ paddingBottom: 12, paddingLeft: 12, paddingRight: 12, paddingTop: 12 }),
          ]))
        },
      )
    } finally {
      resetInsets()
    }
  })

  Test("carries a toggle bar's bottom clearance through a nested window-owning navigator", async () => {
    setInsets()
    try {
      await testCompileApp(
        `
          use SelectionNav, StackNav from @tao/nav
          use Text from @tao/ui

          nav InnerStack = StackNav {
            Initial InnerHome
            Title "Inner Stack"
          }

          let ItemStack = StackNav { Initial InnerStack }

          let MainSelection = SelectionNav {
            Initial @home
            Display "toggle"
            @home { Label "Home" Content ItemStack }
          }

          app ToggleNestedApp {
            Name "Toggle Nested"
            Navigator MainSelection
          }

          scene InnerHome() {
            Title "Inner Home"
            render Text("Inner Home body")
          }
        `,
        screen => {
          ExpectScreen(screen).toHaveText('Inner Home body')
          // Only one screen renders anywhere in this tree (the toggle item's stack holds another
          // stack, whose own entry is the only non-window-owning content), so its AppSurfaceFrame is
          // the only ScrollView — a nested one clearing the floating toggle bar's own 64px, on top of
          // the ordinary frame padding and inset, the same as `RuntimeSelectionNav.itemEntryLevels`
          // gives a toggle item's own direct (non-nested) content.
          const scrollViews = screen.UNSAFE_getAllByType(RN.ScrollView)
          Expect(scrollViews).toHaveLength(1)
          const toggleBarClearance = 64
          Expect(RN.StyleSheet.flatten(scrollViews[0]!.props.contentContainerStyle)).toMatchObject({
            paddingBottom: 12 + insets.bottom + toggleBarClearance,
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
})
