export type TaoVibrationPattern = number | readonly number[]

export type TaoVibrationDriver = {
  cancel(): void
  vibrate(pattern?: TaoVibrationPattern, repeat?: boolean): void
}

export type TaoVibrationAction = {
  invoke(): void
}

export type TaoVibrationCompleteAction = {
  invoke(): void
}

let testDriver: TaoVibrationDriver | undefined

/** Vibration exposes React Native vibration helpers. */
export const Vibration = {
  /** vibrate triggers native vibration using an optional duration or pattern. */
  vibrate(pattern?: TaoVibrationPattern, repeat = false): void {
    vibrationDriver().vibrate(pattern, repeat)
  },

  /** vibrateAction creates a Pressable-compatible vibration action. */
  vibrateAction(
    pattern?: TaoVibrationPattern,
    repeat = false,
    vibrated?: TaoVibrationCompleteAction,
  ): TaoVibrationAction {
    return {
      invoke() {
        Vibration.vibrate(pattern, repeat)
        vibrated?.invoke()
      },
    }
  },

  /** cancel stops any active vibration pattern. */
  cancel(): void {
    vibrationDriver().cancel()
  },

  /** cancelAction creates a Pressable-compatible vibration-cancel action. */
  cancelAction(canceled?: TaoVibrationCompleteAction): TaoVibrationAction {
    return {
      invoke() {
        Vibration.cancel()
        canceled?.invoke()
      },
    }
  },

  /** vibratedAction adapts vibration completion into a Vibration-compatible action. */
  vibratedAction(work: () => void): TaoVibrationCompleteAction {
    return {
      invoke() {
        work()
      },
    }
  },

  /** canceledAction adapts vibration cancellation into a Vibration-compatible action. */
  canceledAction(work: () => void): TaoVibrationCompleteAction {
    return {
      invoke() {
        work()
      },
    }
  },

  /** setDriverForTests replaces React Native Vibration for deterministic runtime tests. */
  setDriverForTests(driver?: TaoVibrationDriver): void {
    testDriver = driver
  },
} as const

function vibrationDriver(): TaoVibrationDriver {
  if (testDriver) {
    return testDriver
  }

  const RN = require('react-native') as { Vibration: TaoVibrationDriver }
  return RN.Vibration
}
