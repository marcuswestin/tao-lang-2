export type TaoKeyboardDriver = {
  dismiss(): void
}

export type TaoKeyboardAction = {
  invoke(): void
}

export type TaoKeyboardDismissedAction = {
  invoke(): void
}

let testDriver: TaoKeyboardDriver | undefined

/** Keyboard exposes React Native keyboard helpers. */
export const Keyboard = {
  /** dismiss hides the native keyboard when it is open. */
  dismiss(): void {
    keyboardDriver().dismiss()
  },

  /** dismissAction creates a Pressable-compatible action that hides the native keyboard. */
  dismissAction(dismissed?: TaoKeyboardDismissedAction): TaoKeyboardAction {
    return {
      invoke() {
        Keyboard.dismiss()
        dismissed?.invoke()
      },
    }
  },

  /** dismissedAction adapts keyboard dismissal completion into a Keyboard-compatible action. */
  dismissedAction(work: () => void): TaoKeyboardDismissedAction {
    return {
      invoke() {
        work()
      },
    }
  },

  /** setDriverForTests replaces React Native Keyboard for deterministic runtime tests. */
  setDriverForTests(driver?: TaoKeyboardDriver): void {
    testDriver = driver
  },
} as const

function keyboardDriver(): TaoKeyboardDriver {
  if (testDriver) {
    return testDriver
  }

  const RN = require('react-native') as { Keyboard: TaoKeyboardDriver }
  return RN.Keyboard
}
