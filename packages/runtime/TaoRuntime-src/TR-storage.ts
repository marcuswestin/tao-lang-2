import React from 'react'
import type { RuntimeTextInputValue } from './TR-views'

type AsyncStorageModule = {
  default?: TaoStorageDriver
  getItem(key: string): Promise<string | null>
  removeItem(key: string): Promise<void>
  setItem(key: string, value: string): Promise<void>
}

export type TaoStorageDriver = {
  getItem(key: string): Promise<string | null>
  removeItem(key: string): Promise<void>
  setItem(key: string, value: string): Promise<void>
}

export type TaoTextStorageState = {
  isLoaded: boolean
  set(value: string): void
  value: string
}

export type TaoTextStorageAction = {
  invoke(): void
}

export type TaoTextStorageInputAction = {
  invoke(value: RuntimeTextInputValue): void
}

let testDriver: TaoStorageDriver | undefined

/** Storage exposes React Native AsyncStorage-backed local persistence helpers. */
export const Storage = {
  /** textState creates controlled text state that loads and persists through AsyncStorage. */
  textState(options: { initialValue: string; key: string }): TaoTextStorageState {
    const driver = storageDriver()
    const [value, setValue] = React.useState(options.initialValue)
    const [isLoaded, setIsLoaded] = React.useState(false)

    React.useEffect(() => {
      let active = true
      void driver.getItem(options.key).then(stored => {
        if (!active) {
          return
        }
        if (stored !== null) {
          setValue(stored)
        }
        setIsLoaded(true)
      })
      return () => {
        active = false
      }
    }, [driver, options.key])

    const set = React.useCallback(
      (next: string) => {
        setValue(next)
        void driver.setItem(options.key, next)
      },
      [driver, options.key],
    )

    return { isLoaded, set, value }
  },

  /** textStateAction adapts local text storage state into a Pressable-compatible action. */
  textStateAction(state: TaoTextStorageState, value: string): TaoTextStorageAction {
    return {
      invoke() {
        state.set(value)
      },
    }
  },

  /** textInputAction adapts local text storage state into a TextInput-compatible change action. */
  textInputAction(state: TaoTextStorageState): TaoTextStorageInputAction {
    return {
      invoke(value) {
        state.set(value.evaluate().jsValue)
      },
    }
  },

  /** remove deletes one persisted value from local storage. */
  async remove(key: string): Promise<void> {
    await storageDriver().removeItem(key)
  },

  /** setDriverForTests replaces the storage driver for deterministic runtime tests. */
  setDriverForTests(driver?: TaoStorageDriver): void {
    testDriver = driver
  },
} as const

function storageDriver(): TaoStorageDriver {
  if (testDriver) {
    return testDriver
  }
  const module = require('@react-native-async-storage/async-storage') as AsyncStorageModule
  return module.default ?? module
}
