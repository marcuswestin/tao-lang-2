import React from 'react'

export type TaoAccessibilityPreferences = {
  reduceMotionEnabled: boolean
  screenReaderEnabled: boolean
}

export type TaoAccessibilityInfoDriver = {
  addEventListener(
    type: 'reduceMotionChanged' | 'screenReaderChanged',
    listener: (enabled: boolean) => void,
  ): { remove(): void }
  isReduceMotionEnabled(): Promise<boolean>
  isScreenReaderEnabled(): Promise<boolean>
}

let testDriver: TaoAccessibilityInfoDriver | undefined

/** AccessibilityInfo exposes native accessibility preference helpers. */
export const AccessibilityInfo = {
  /** preferences reads current native accessibility preferences and re-renders when they change. */
  preferences(): TaoAccessibilityPreferences {
    const driver = accessibilityInfoDriver()
    const [preferences, setPreferences] = React.useState<TaoAccessibilityPreferences>({
      reduceMotionEnabled: false,
      screenReaderEnabled: false,
    })

    React.useEffect(() => {
      let isMounted = true

      void driver.isReduceMotionEnabled().then(enabled => {
        if (isMounted) {
          setPreferences(current => ({ ...current, reduceMotionEnabled: enabled }))
        }
      })

      void driver.isScreenReaderEnabled().then(enabled => {
        if (isMounted) {
          setPreferences(current => ({ ...current, screenReaderEnabled: enabled }))
        }
      })

      const reduceMotionSubscription = driver.addEventListener('reduceMotionChanged', enabled => {
        setPreferences(current => ({ ...current, reduceMotionEnabled: enabled }))
      })
      const screenReaderSubscription = driver.addEventListener('screenReaderChanged', enabled => {
        setPreferences(current => ({ ...current, screenReaderEnabled: enabled }))
      })

      return () => {
        isMounted = false
        reduceMotionSubscription.remove()
        screenReaderSubscription.remove()
      }
    }, [driver])

    return preferences
  },

  /** setDriverForTests replaces React Native AccessibilityInfo for deterministic runtime tests. */
  setDriverForTests(driver?: TaoAccessibilityInfoDriver): void {
    testDriver = driver
  },
} as const

function accessibilityInfoDriver(): TaoAccessibilityInfoDriver {
  if (testDriver) {
    return testDriver
  }

  if (isJestRuntime()) {
    return {
      addEventListener() {
        return { remove() {} }
      },
      async isReduceMotionEnabled() {
        return false
      },
      async isScreenReaderEnabled() {
        return false
      },
    }
  }

  const RN = require('react-native') as { AccessibilityInfo: TaoAccessibilityInfoDriver }
  return RN.AccessibilityInfo
}

function isJestRuntime(): boolean {
  return typeof process !== 'undefined'
    && (process.env['JEST_WORKER_ID'] !== undefined || process.env['NODE_ENV'] === 'test')
}
