import { jest } from '@jest/globals'
import * as TaoReactNative from '@runtime/TR-react-native'
import { Describe, Expect, Test } from '@shared/test'
import { act, fireEvent } from '@testing-library/react-native'
import * as RN from 'react-native'
import { ExpectScreen, registerRuntimeE2ELifecycle, testCompileApp } from './test-compile-app'

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
  Test('insets an asked dialog with base padding only inside an already-inset frame', async () => {
    setInsets()
    try {
      await testCompileApp(askSlotSource, async screen => {
        await act(async () => {
          fireEvent.press(screen.getByText('Open ask'))
        })
        ExpectScreen(screen).toHaveText('Yes')

        const scrim = screen.UNSAFE_getAllByType(RN.View).find(view => {
          const style = RN.StyleSheet.flatten(view.props.style) ?? {}
          return style.backgroundColor === 'rgba(0, 0, 0, 0.45)'
        })
        Expect(scrim).toBeDefined()
        // The synthesized SlotNav does not own its window, so AppSurfaceFrame already padded this
        // scrim's ancestor content by the live insets; adding them again here would double-pad.
        Expect(RN.StyleSheet.flatten(scrim!.props.style)).toMatchObject({
          paddingBottom: 24,
          paddingLeft: 24,
          paddingRight: 24,
          paddingTop: 24,
        })
      })
    } finally {
      resetInsets()
    }
  })

  Test('insets an asked dialog with base padding plus live insets when its navigator owns the window', async () => {
    setInsets()
    try {
      await testCompileApp(askStackSource, async screen => {
        await act(async () => {
          fireEvent.press(screen.getByText('Open ask'))
        })
        ExpectScreen(screen).toHaveText('Yes')

        const scrim = screen.UNSAFE_getAllByType(RN.View).find(view => {
          const style = RN.StyleSheet.flatten(view.props.style) ?? {}
          return style.backgroundColor === 'rgba(0, 0, 0, 0.45)'
        })
        Expect(scrim).toBeDefined()
        Expect(RN.StyleSheet.flatten(scrim!.props.style)).toMatchObject({
          paddingBottom: 24 + insets.bottom,
          paddingLeft: 24 + insets.left,
          paddingRight: 24 + insets.right,
          paddingTop: 24 + insets.top,
        })
      })
    } finally {
      resetInsets()
    }
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
          // and `right`, which are 0 in both.
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
