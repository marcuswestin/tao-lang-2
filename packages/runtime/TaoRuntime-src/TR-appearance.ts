import React from 'react'

export type TaoColorScheme = 'dark' | 'light' | 'no-preference'

export type TaoAppearanceDriver = {
  addChangeListener(listener: (preferences: { colorScheme?: string | null }) => void): { remove(): void }
  getColorScheme(): string | null | undefined
}

let testDriver: TaoAppearanceDriver | undefined

/** Appearance exposes React Native visual preference helpers. */
export const Appearance = {
  /** colorScheme reads the current system color scheme and re-renders when it changes. */
  colorScheme(): TaoColorScheme {
    const driver = appearanceDriver()
    const [scheme, setScheme] = React.useState<TaoColorScheme>(() => normalizeColorScheme(driver.getColorScheme()))

    React.useEffect(() => {
      const subscription = driver.addChangeListener(preferences => {
        setScheme(normalizeColorScheme(preferences.colorScheme))
      })
      return () => subscription.remove()
    }, [driver])

    return scheme
  },

  /** setDriverForTests replaces React Native Appearance for deterministic runtime tests. */
  setDriverForTests(driver?: TaoAppearanceDriver): void {
    testDriver = driver
  },
} as const

function appearanceDriver(): TaoAppearanceDriver {
  if (testDriver) {
    return testDriver
  }

  if (isJestRuntime()) {
    return {
      addChangeListener() {
        return { remove() {} }
      },
      getColorScheme() {
        return null
      },
    }
  }

  const RN = require('react-native') as { Appearance: TaoAppearanceDriver }
  return RN.Appearance
}

function normalizeColorScheme(scheme: string | null | undefined): TaoColorScheme {
  return scheme === 'dark' || scheme === 'light' ? scheme : 'no-preference'
}

function isJestRuntime(): boolean {
  return typeof process !== 'undefined'
    && (process.env['JEST_WORKER_ID'] !== undefined || process.env['NODE_ENV'] === 'test')
}
