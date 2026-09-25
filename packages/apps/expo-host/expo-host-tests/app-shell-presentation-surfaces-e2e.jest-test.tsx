import { jest } from '@jest/globals'
import TR from '@runtime/TR'
import * as TaoReactNative from '@runtime/TR-react-native'
import { Describe, Expect, Test } from '@shared/test'
import { act, fireEvent, render, type screen as Screen } from '@testing-library/react-native'
import React from 'react'
import * as RN from 'react-native'
import { ExpectScreen, registerRuntimeE2ELifecycle, testCompileApp } from './test-compile-app'

type TestInstance = ReturnType<typeof Screen.UNSAFE_getAllByType>[number]

const askConfirmView = `
  type ConfirmResult is one of Confirmed

  view Confirm() responds ConfirmResult {
    action Yes() { respond Confirmed }
    render Button("Yes") [] { on press Yes }
  }
`

// A synthesized SlotNav (\`app X { view Y }\`) does not own its window: the app host renders it
// inside one AppSurfaceFrame, whose content is already padded by the live insets.
const askSlotSource = `
  use Button from @tao/ui/basic

  ${askConfirmView}

  app AskDialogApp {
    view Editor
  }

  view Editor() {
    action OpenAsk() {
      let Result = ask Confirm()
      if Result is Confirmed { dismiss }
    }
    render Button("Open ask") [] { on press OpenAsk }
  }
`

// An explicit StackNav owns its window: the app host does not wrap it, so its own overlay lane
// fills the true window and must add the live insets itself.
const askStackSource = `
  use Button from @tao/ui/basic
  use StackNav from @tao/nav

  ${askConfirmView}

  app AskDialogStackApp {
    Name "Ask Dialog Stack"
    Navigator StackNav { Initial Editor }
  }

  scene Editor() {
    Title "Editor"
    action OpenAsk() {
      let Result = ask Confirm()
      if Result is Confirmed { dismiss }
    }
    render Button("Open ask") [] { on press OpenAsk }
  }
`

const sheetContentView = `
  view SheetContent() {
    state Draft = ""
    render TextInput(Value: Draft, Label: "Draft") {
      on submit -> { }
    }
  }
`

const sheetSlotSource = `
  use Button from @tao/ui/basic
  use TextInput from @tao/ui

  app SheetApp {
    view Editor
  }

  view Editor() {
    action OpenSheet() { present SheetContent() as sheet }
    render Button("Open sheet") [] { on press OpenSheet }
  }

  ${sheetContentView}
`

const sheetStackSource = `
  use Button from @tao/ui/basic
  use TextInput from @tao/ui
  use StackNav from @tao/nav

  app SheetStackApp {
    Name "Sheet Stack"
    Navigator StackNav { Initial Editor }
  }

  scene Editor() {
    Title "Editor"
    action OpenSheet() { present SheetContent() as sheet }
    render Button("Open sheet") [] { on press OpenSheet }
  }

  ${sheetContentView}
`

registerRuntimeE2ELifecycle()

const insets = { bottom: 5, left: 2, right: 3, top: 7 }
const zeroInsets = { bottom: 0, left: 0, right: 0, top: 0 }

function safeAreaMock(): {
  setSafeAreaInsetsForTests(value: typeof insets): void
  setNestedSafeAreaInsetsForTests(value: typeof insets): void
} {
  return require('react-native-safe-area-context')
}

function setInsets(): void {
  safeAreaMock().setSafeAreaInsetsForTests(insets)
}

function resetInsets(): void {
  safeAreaMock().setSafeAreaInsetsForTests(zeroInsets)
}

function askScrim(screen: { UNSAFE_getAllByType(type: typeof RN.View): TestInstance[] }): TestInstance {
  const scrim = screen.UNSAFE_getAllByType(RN.View).find(view => {
    const style = RN.StyleSheet.flatten(view.props.style) ?? {}
    return style.backgroundColor === 'rgba(0, 0, 0, 0.45)'
  })
  Expect(scrim).toBeDefined()
  return scrim!
}

function hasAncestorOfType(instance: TestInstance, type: unknown): boolean {
  for (let current = instance.parent; current; current = current.parent) {
    if (current.type === type) {
      return true
    }
  }
  return false
}

function noModalRuntimeOverride(): ReturnType<typeof TaoReactNative.requireReactNativeRuntime> {
  return {
    ActivityIndicator: RN.ActivityIndicator,
    Image: RN.Image,
    KeyboardAvoidingView: RN.KeyboardAvoidingView,
    Platform: { OS: 'ios' },
    Pressable: RN.Pressable,
    ScrollView: RN.ScrollView,
    Switch: RN.Switch,
    Text: RN.Text,
    TextInput: RN.TextInput,
    View: RN.View,
  } as unknown as ReturnType<typeof TaoReactNative.requireReactNativeRuntime>
}

Describe('Expo runtime: presentation surfaces', () => {
  Test(
    "draws an asked dialog in the app host's window layer, outside the padded frame, when its navigator does not own the window",
    async () => {
      setInsets()
      try {
        await testCompileApp(askSlotSource, async screen => {
          await act(async () => {
            fireEvent.press(screen.getByText('Open ask'))
          })
          ExpectScreen(screen).toHaveText('Yes')

          const scrim = askScrim(screen)
          // The synthesized SlotNav renders inside the app host's AppSurfaceFrame, whose scroll content
          // is padded away from the window edges. Drawn there, the scrim would dim the padded content
          // box only; drawn in the window layer beside that frame it covers the window, and so adds
          // the live insets itself to keep the card off the notch and the home indicator.
          Expect(hasAncestorOfType(scrim, RN.ScrollView)).toBe(false)
          Expect(RN.StyleSheet.flatten(scrim.props.style)).toMatchObject({
            paddingBottom: 24 + insets.bottom,
            paddingLeft: 24 + insets.left,
            paddingRight: 24 + insets.right,
            paddingTop: 24 + insets.top,
          })
        })
      } finally {
        resetInsets()
      }
    },
  )

  Test(
    'draws an asked dialog in the window layer with the same insets when its navigator owns the window',
    async () => {
      setInsets()
      try {
        await testCompileApp(askStackSource, async screen => {
          await act(async () => {
            fireEvent.press(screen.getByText('Open ask'))
          })
          ExpectScreen(screen).toHaveText('Yes')

          const scrim = askScrim(screen)
          Expect(hasAncestorOfType(scrim, RN.ScrollView)).toBe(false)
          Expect(RN.StyleSheet.flatten(scrim.props.style)).toMatchObject({
            paddingBottom: 24 + insets.bottom,
            paddingLeft: 24 + insets.left,
            paddingRight: 24 + insets.right,
            paddingTop: 24 + insets.top,
          })
        })
      } finally {
        resetInsets()
      }
    },
  )

  Test('hides an asked dialog while an enclosing level covers its presenter, and shows it again after', async () => {
    const innerHome = TR.Navigation.View({
      name: 'InnerHome',
      render: () => React.createElement(RN.Text, null, 'Inner home'),
    })
    const innerSlot = TR.Navigation.Mount(TR.Navigation.Configure(
      TR.Navigation.Declaration('InnerSlot', TR.NavKind.Slot()),
      { Initial: innerHome },
    ))
    // Home renders InnerSlot inline, the way a scene renders a `nav` it names, so InnerSlot's whole
    // surface lives inside Home's stack level.
    const home = TR.Navigation.View({
      name: 'Home',
      render: (_arguments, taoProps) =>
        React.createElement(TR.Navigation.Occurrence, { __tao: taoProps, name: 'InnerSlot', value: innerSlot }),
    })
    const detail = TR.Navigation.View({
      name: 'Detail',
      render: () => React.createElement(RN.Text, null, 'Detail body'),
    })
    const confirm = TR.Navigation.View({
      name: 'Confirm',
      render: () => React.createElement(RN.Text, null, 'Question'),
    })
    const stack = TR.Navigation.Mount(TR.Navigation.Configure(
      TR.Navigation.Declaration('Covered ask stack', TR.NavKind.Stack()),
      { Initial: home },
    ))
    const app = TR.Navigation.App({ name: 'Covered ask app', navigator: () => stack, auxiliaries: () => ({}) })
    const screen = render(React.createElement(TR.Navigation.AppHost, { app }))
    ExpectScreen(screen).toHaveText('Inner home')

    await act(async () => {
      void innerSlot.ask(confirm, {})
    })
    ExpectScreen(screen).toHaveText('Question')

    // A person cannot reach past a modal ask, but an action already running can still present over
    // its presenter. The dialog draws in the window layer, outside Home's subtree — so what hides
    // Home when Detail covers it must hide the dialog too, or the window dims behind a screen that
    // is not showing.
    await act(async () => {
      stack.present(detail, {})
    })
    ExpectScreen(screen).toHaveText('Detail body')
    Expect(screen.queryByText('Question')).toBeNull()

    await act(async () => {
      app.back()
    })
    ExpectScreen(screen).toHaveText('Question')
  })

  Test('draws an asked dialog in place when no window layer encloses its navigator', async () => {
    const home = TR.Navigation.View({ name: 'Home', render: () => React.createElement(RN.Text, null, 'Home') })
    const confirm = TR.Navigation.View({
      name: 'Confirm',
      render: () => React.createElement(RN.Text, null, 'Question'),
    })
    const stack = TR.Navigation.Mount(TR.Navigation.Configure(
      TR.Navigation.Declaration('Bare stack', TR.NavKind.Stack()),
      { Initial: home },
    ))
    // A navigator rendered on its own, with no app host and so no window layer, keeps its ask in
    // its own overlay lane rather than dropping it.
    const screen = render(stack.render() as React.ReactElement)
    await act(async () => {
      void TR.Navigation.Ask({ navigation: stack }, confirm, {})
    })
    screen.rerender(stack.render() as React.ReactElement)
    ExpectScreen(screen).toHaveText('Question')
    askScrim(screen)
  })

  Test(
    'insets an inline sheet (no native Modal host) with base padding only inside an already-inset frame',
    async () => {
      const restoreRuntime = jest.spyOn(TaoReactNative, 'requireReactNativeRuntime')
        .mockReturnValue(noModalRuntimeOverride())
      setInsets()
      try {
        await testCompileApp(sheetSlotSource, async screen => {
          await act(async () => {
            fireEvent.press(screen.getByText('Open sheet'))
          })
          ExpectScreen(screen).toHaveText('Draft')

          const card = screen.UNSAFE_getAllByType(RN.View).find(view => {
            const style = RN.StyleSheet.flatten(view.props.style) ?? {}
            return style.backgroundColor === '#ffffff' && style.borderTopLeftRadius === 16
          })
          Expect(card).toBeDefined()
          Expect(RN.StyleSheet.flatten(card!.props.style)).toMatchObject({
            paddingBottom: 20,
            paddingLeft: 20,
            paddingRight: 20,
            paddingTop: 20,
          })
        })
      } finally {
        resetInsets()
        restoreRuntime.mockRestore()
      }
    },
  )

  Test(
    'insets an inline sheet (no native Modal host) with live insets when its navigator owns the window',
    async () => {
      const restoreRuntime = jest.spyOn(TaoReactNative, 'requireReactNativeRuntime')
        .mockReturnValue(noModalRuntimeOverride())
      setInsets()
      try {
        await testCompileApp(sheetStackSource, async screen => {
          await act(async () => {
            fireEvent.press(screen.getByText('Open sheet'))
          })
          ExpectScreen(screen).toHaveText('Draft')

          const card = screen.UNSAFE_getAllByType(RN.View).find(view => {
            const style = RN.StyleSheet.flatten(view.props.style) ?? {}
            return style.backgroundColor === '#ffffff' && style.borderTopLeftRadius === 16
          })
          Expect(card).toBeDefined()
          Expect(RN.StyleSheet.flatten(card!.props.style)).toMatchObject({
            paddingBottom: 20 + insets.bottom,
            paddingLeft: 20 + insets.left,
            paddingRight: 20 + insets.right,
            paddingTop: 20,
          })
        })
      } finally {
        resetInsets()
        restoreRuntime.mockRestore()
      }
    },
  )

  Test(
    "insets a sheet presented through the native Modal host using the modal window's own insets, and gives it its own keyboard avoidance",
    async () => {
      setInsets()
      // The page sheet's own native window: on iOS its card starts below the status bar, so its top
      // inset is near zero while the root window's top inset (set above) covers the status bar.
      const modalInsets = { bottom: 21, left: 0, right: 0, top: 0 }
      try {
        await testCompileApp(sheetSlotSource, async screen => {
          // Queued after the root provider has already mounted (above), so it is the sheet's own
          // nested provider — mounted only once the Modal opens below — that consumes it, not root.
          safeAreaMock().setNestedSafeAreaInsetsForTests(modalInsets)
          await act(async () => {
            fireEvent.press(screen.getByText('Open sheet'))
          })
          ExpectScreen(screen).toHaveText('Draft')
          Expect(screen.UNSAFE_getByType(RN.Modal)).toBeDefined()

          const card = screen.UNSAFE_getAllByType(RN.View).find(view => {
            const style = RN.StyleSheet.flatten(view.props.style) ?? {}
            return style.backgroundColor === '#ffffff' && style.flex === 1 && !('borderTopLeftRadius' in style)
          })
          Expect(card).toBeDefined()
          // Proves the modal content used the NESTED provider's insets, not the root window's —
          // asserting the root's values here would fail, since they differ on every edge but `left`
          // and `right`, which are 0 in both. This proves the structural property (modal content
          // reads its nearest, own provider); the library's real per-window native measurement is
          // not something Jest can observe.
          Expect(RN.StyleSheet.flatten(card!.props.style)).toMatchObject({
            paddingBottom: 20 + modalInsets.bottom,
            paddingLeft: 20 + modalInsets.left,
            paddingRight: 20 + modalInsets.right,
            paddingTop: 20 + modalInsets.top,
          })

          // The root AppShell's own KeyboardAvoidingView cannot reach content mounted inside RN's
          // Modal, which is a separate native window; the sheet needs a second one of its own so the
          // TextInput above clears the keyboard.
          const keyboardViews = screen.UNSAFE_getAllByType(RN.KeyboardAvoidingView)
          Expect(keyboardViews).toHaveLength(2)
          const expectedBehavior = RN.Platform.OS === 'ios' ? 'padding' : undefined
          Expect(keyboardViews.every(view => view.props.behavior === expectedBehavior)).toBe(true)
        })
      } finally {
        resetInsets()
      }
    },
  )

  Test(
    "draws an ask asked from inside a native sheet in the sheet's own window layer, with the sheet window's insets",
    async () => {
      setInsets()
      // The page sheet's own native window (see the sheet test above): its insets differ from the
      // root window's on every edge but `left` and `right`.
      const modalInsets = { bottom: 21, left: 0, right: 0, top: 0 }
      try {
        await testCompileApp(
          `
            use Button from @tao/ui/basic
            use SlotNav from @tao/nav

            ${askConfirmView}

            app SheetAskApp {
              view Editor
            }

            view Editor() {
              action OpenSheet() { present SheetContent() as sheet }
              render Button("Open sheet") [] { on press OpenSheet }
            }

            nav InnerSlot = SlotNav { Initial InnerHome }

            view SheetContent() {
              render InnerSlot()
            }

            scene InnerHome() {
              Title "Inner Home"
              action OpenAsk() {
                let Result = ask Confirm()
                if Result is Confirmed { dismiss }
              }
              render Button("Open ask") [] { on press OpenAsk }
            }
          `,
          async screen => {
            // The ask below is asked from inside the sheet's own nested SlotNav (InnerSlot), a
            // descendant of the native Modal. A native Modal lies above the root window's layer, so
            // an ask drawn there would be hidden behind the sheet; the sheet keeps a window layer of
            // its own, and the ask must draw in that one — which the sheet window's own insets, read
            // from the sheet's nested SafeAreaProvider rather than the root's, prove.
            safeAreaMock().setNestedSafeAreaInsetsForTests(modalInsets)
            await act(async () => {
              fireEvent.press(screen.getByText('Open sheet'))
            })
            await act(async () => {
              fireEvent.press(screen.getByText('Open ask'))
            })
            ExpectScreen(screen).toHaveText('Yes')

            const scrim = askScrim(screen)
            Expect(hasAncestorOfType(scrim, RN.Modal)).toBe(true)
            // Inside the sheet's own keyboard avoidance too, so an input in the asked view clears
            // the keyboard the way the sheet's content does.
            Expect(hasAncestorOfType(scrim, RN.KeyboardAvoidingView)).toBe(true)
            Expect(RN.StyleSheet.flatten(scrim.props.style)).toMatchObject({
              paddingBottom: 24 + modalInsets.bottom,
              paddingLeft: 24 + modalInsets.left,
              paddingRight: 24 + modalInsets.right,
              paddingTop: 24 + modalInsets.top,
            })
          },
        )
      } finally {
        resetInsets()
      }
    },
  )

  Test("keeps a sheet showing while an overlay presented from inside it draws in the sheet's window", async () => {
    await testCompileApp(
      `
        use Button from @tao/ui/basic
        use Text from @tao/ui

        app SheetOverlayApp {
          view Editor
        }

        view Editor() {
          action OpenSheet() { present SheetContent() as sheet }
          render Button("Open sheet") [] { on press OpenSheet }
        }

        view SheetContent() {
          action OpenCover() { present Cover() as overlay }
          render Button("Open cover") [] { on press OpenCover }
        }

        view Cover() {
          render Text("Cover body")
        }
      `,
      async screen => {
        await act(async () => {
          fireEvent.press(screen.getByText('Open sheet'))
        })
        await act(async () => {
          fireEvent.press(screen.getByText('Open cover'))
        })
        // The overlay tops the presenter's stack, but it was presented while the sheet showed, so
        // the sheet hosts it: the Modal stays visible and the overlay draws inside its window.
        ExpectScreen(screen).toHaveText('Cover body')
        Expect(screen.UNSAFE_getByType(RN.Modal).props.visible).toBe(true)
        Expect(hasAncestorOfType(screen.getByText('Cover body'), RN.Modal)).toBe(true)
        ExpectScreen(screen).toHaveText('Open cover')

        // The platform dismissing the sheet itself (swiped down) takes the sheet and what it hosts:
        // the stack cannot keep a sheet the platform no longer shows.
        await act(async () => {
          screen.UNSAFE_getByType(RN.Modal).props.onRequestClose()
        })
        Expect(screen.queryByText('Cover body')).toBeNull()
        Expect(screen.queryByText('Open cover')).toBeNull()
        ExpectScreen(screen).toHaveText('Open sheet')
      },
    )
  })

  Test(
    "draws an ask asked from a sheet's own content in the sheet's window, with the sheet still showing",
    async () => {
      await testCompileApp(
        `
        use Button from @tao/ui/basic

        ${askConfirmView}

        app SheetAskOwnApp {
          view Editor
        }

        view Editor() {
          action OpenSheet() { present SheetContent() as sheet }
          render Button("Open sheet") [] { on press OpenSheet }
        }

        view SheetContent() {
          action OpenAsk() {
            let Result = ask Confirm()
            if Result is Confirmed { dismiss }
          }
          render Button("Open ask") [] { on press OpenAsk }
        }
      `,
        async screen => {
          await act(async () => {
            fireEvent.press(screen.getByText('Open sheet'))
          })
          await act(async () => {
            fireEvent.press(screen.getByText('Open ask'))
          })
          ExpectScreen(screen).toHaveText('Yes')
          Expect(screen.UNSAFE_getByType(RN.Modal).props.visible).toBe(true)
          const scrim = askScrim(screen)
          Expect(hasAncestorOfType(scrim, RN.Modal)).toBe(true)
          // A modal entry hosted by the sheet hides the sheet's own content from accessibility, as a
          // navigator's content hides beneath its own ask.
          Expect(screen.queryByText('Open ask')).toBeNull()
        },
      )
    },
  )

  Test('insets a toast off the home indicator and any side notch', async () => {
    setInsets()
    try {
      await testCompileApp(
        `
          use Button from @tao/ui/basic
          use Text from @tao/ui

          app ToastApp {
            view Editor
          }

          view Editor() {
            action ShowToast() { present Notice() as toast (Key: "notice", Duration: 3.s) }
            render Button("Show toast") [] { on press ShowToast }
          }

          view Notice() {
            render Text("Saved")
          }
        `,
        async screen => {
          await act(async () => {
            fireEvent.press(screen.getByText('Show toast'))
          })
          ExpectScreen(screen).toHaveText('Saved')

          // The toast layer is always a sibling of the app host's AppSurfaceFrame — never inside it,
          // regardless of whether the main navigator owns its window — so it always needs the live
          // insets, unlike the ask scrim and the inline sheet above.
          const toastLayer = screen.UNSAFE_getAllByType(RN.View).find(view => {
            const style = RN.StyleSheet.flatten(view.props.style) ?? {}
            return style.alignItems === 'center' && style.bottom === 0 && style.zIndex === 2
          })
          Expect(toastLayer).toBeDefined()
          Expect(RN.StyleSheet.flatten(toastLayer!.props.style)).toMatchObject({
            paddingBottom: 24 + insets.bottom,
            paddingLeft: 16 + insets.left,
            paddingRight: 16 + insets.right,
          })
        },
      )
    } finally {
      resetInsets()
    }
  })
})
