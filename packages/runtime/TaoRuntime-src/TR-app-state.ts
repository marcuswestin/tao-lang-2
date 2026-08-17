import React from 'react'

export type TaoAppStateStatus = 'active' | 'background' | 'extension' | 'inactive' | 'unknown'

export type TaoAppStateDriver = {
  addEventListener(type: 'change', listener: (status: TaoAppStateStatus) => void): { remove(): void }
  currentState?: string | null
}

let testDriver: TaoAppStateDriver | undefined

/** AppState exposes React Native foreground/background state helpers. */
export const AppState = {
  /** status returns current app state and re-renders when React Native reports changes. */
  status(): TaoAppStateStatus {
    const driver = appStateDriver()
    const [status, setStatus] = React.useState<TaoAppStateStatus>(() => normalizeStatus(driver.currentState))

    React.useEffect(() => {
      const subscription = driver.addEventListener('change', next => setStatus(normalizeStatus(next)))
      return () => subscription.remove()
    }, [driver])

    return status
  },

  /** setDriverForTests replaces React Native AppState for deterministic runtime tests. */
  setDriverForTests(driver?: TaoAppStateDriver): void {
    testDriver = driver
  },
} as const

function appStateDriver(): TaoAppStateDriver {
  if (testDriver) {
    return testDriver
  }

  const RN = require('react-native') as { AppState: TaoAppStateDriver }
  return RN.AppState
}

function normalizeStatus(status: string | null | undefined): TaoAppStateStatus {
  return status === 'active' || status === 'background' || status === 'extension' || status === 'inactive'
    ? status
    : 'unknown'
}
