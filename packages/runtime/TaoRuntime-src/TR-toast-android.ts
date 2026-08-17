export type TaoToastAndroidDuration = 'long' | 'short'

export type TaoToastAndroidGravity = 'bottom' | 'center' | 'top'

export type TaoToastAndroidOptions = {
  duration?: TaoToastAndroidDuration
  gravity?: TaoToastAndroidGravity
  xOffset?: number
  yOffset?: number
}

export type TaoToastAndroidAction = {
  invoke(): void
}

export type TaoToastAndroidShownAction = {
  invoke(): void
}

export type TaoToastAndroidDriver = {
  BOTTOM?: number
  CENTER?: number
  LONG?: number
  SHORT?: number
  TOP?: number
  show(message: string, duration: number): void
  showWithGravity(message: string, duration: number, gravity: number): void
  showWithGravityAndOffset(message: string, duration: number, gravity: number, xOffset: number, yOffset: number): void
}

let testDriver: TaoToastAndroidDriver | undefined

/** ToastAndroid exposes React Native Android toast helpers. */
export const ToastAndroid = {
  /** show displays a native Android toast. */
  show(message: string, options: TaoToastAndroidOptions = {}): void {
    const driver = toastAndroidDriver()
    const duration = toastDuration(driver, options.duration)
    const gravity = options.gravity
    const hasOffset = options.xOffset !== undefined || options.yOffset !== undefined
    if (gravity && hasOffset) {
      driver.showWithGravityAndOffset(
        message,
        duration,
        toastGravity(driver, gravity),
        options.xOffset ?? 0,
        options.yOffset ?? 0,
      )
      return
    }
    if (gravity) {
      driver.showWithGravity(message, duration, toastGravity(driver, gravity))
      return
    }
    driver.show(message, duration)
  },

  /** showAction creates a Pressable-compatible Android toast action. */
  showAction(
    message: string,
    options?: TaoToastAndroidOptions,
    shown?: TaoToastAndroidShownAction,
  ): TaoToastAndroidAction {
    return {
      invoke() {
        ToastAndroid.show(message, options)
        shown?.invoke()
      },
    }
  },

  /** shownAction adapts toast display completion into a ToastAndroid-compatible action. */
  shownAction(work: () => void): TaoToastAndroidShownAction {
    return {
      invoke() {
        work()
      },
    }
  },

  /** setDriverForTests replaces React Native ToastAndroid for deterministic runtime tests. */
  setDriverForTests(driver?: TaoToastAndroidDriver): void {
    testDriver = driver
  },
} as const

function toastAndroidDriver(): TaoToastAndroidDriver {
  if (testDriver) {
    return testDriver
  }

  if (isJestRuntime()) {
    return {
      BOTTOM: 1,
      CENTER: 2,
      LONG: 1,
      SHORT: 0,
      TOP: 3,
      show() {},
      showWithGravity() {},
      showWithGravityAndOffset() {},
    }
  }

  const RN = require('react-native') as { ToastAndroid: TaoToastAndroidDriver }
  return RN.ToastAndroid
}

function toastDuration(driver: TaoToastAndroidDriver, duration: TaoToastAndroidDuration | undefined): number {
  return duration === 'long' ? driver.LONG ?? 1 : driver.SHORT ?? 0
}

function toastGravity(driver: TaoToastAndroidDriver, gravity: TaoToastAndroidGravity): number {
  if (gravity === 'bottom') {
    return driver.BOTTOM ?? 1
  }
  if (gravity === 'center') {
    return driver.CENTER ?? 2
  }
  return driver.TOP ?? 3
}

function isJestRuntime(): boolean {
  return typeof process !== 'undefined'
    && (process.env['JEST_WORKER_ID'] !== undefined || process.env['NODE_ENV'] === 'test')
}
