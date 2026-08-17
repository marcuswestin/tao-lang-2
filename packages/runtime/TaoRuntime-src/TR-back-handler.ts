import React from 'react'

export type TaoBackHandlerAction = {
  invoke(): void
}

export type TaoBackHandlerExitedAction = {
  invoke(): void
}

export type TaoBackPressAction = {
  invoke(): boolean
}

export type TaoBackHandlerDriver = {
  addEventListener(type: 'hardwareBackPress', handler: () => boolean): { remove(): void }
  exitApp(): void
}

let testDriver: TaoBackHandlerDriver | undefined

/** BackHandler exposes Android hardware-back helpers for generated Tao apps. */
export const BackHandler = {
  /** onPress registers a hardware-back handler for the lifetime of the current rendered view. */
  onPress(handler: TaoBackPressAction): void {
    const driver = backHandlerDriver()
    React.useEffect(() => {
      const subscription = driver.addEventListener('hardwareBackPress', () => handler.invoke())
      return () => subscription.remove()
    }, [driver, handler])
  },

  /** exitApp delegates to React Native's native app-exit request. */
  exitApp(): void {
    backHandlerDriver().exitApp()
  },

  /** exitAppAction creates a Pressable-compatible app-exit action. */
  exitAppAction(exited?: TaoBackHandlerExitedAction): TaoBackHandlerAction {
    return {
      invoke() {
        BackHandler.exitApp()
        exited?.invoke()
      },
    }
  },

  /** exitedAction adapts app-exit completion into a BackHandler-compatible action. */
  exitedAction(work: () => void): TaoBackHandlerExitedAction {
    return {
      invoke() {
        work()
      },
    }
  },

  /** pressAction adapts hardware-back handling into a BackHandler-compatible action. */
  pressAction(work: () => boolean): TaoBackPressAction {
    return {
      invoke() {
        return work()
      },
    }
  },

  /** setDriverForTests replaces React Native BackHandler for deterministic runtime tests. */
  setDriverForTests(driver?: TaoBackHandlerDriver): void {
    testDriver = driver
  },
} as const

function backHandlerDriver(): TaoBackHandlerDriver {
  if (testDriver) {
    return testDriver
  }

  if (isJestRuntime()) {
    return {
      addEventListener() {
        return { remove() {} }
      },
      exitApp() {},
    }
  }

  const RN = require('react-native') as { BackHandler: TaoBackHandlerDriver }
  return RN.BackHandler
}

function isJestRuntime(): boolean {
  return typeof process !== 'undefined'
    && (process.env['JEST_WORKER_ID'] !== undefined || process.env['NODE_ENV'] === 'test')
}
