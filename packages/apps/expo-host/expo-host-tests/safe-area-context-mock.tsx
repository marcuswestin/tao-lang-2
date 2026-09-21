import * as React from 'react'

type Insets = { bottom: number; left: number; right: number; top: number }

let rootInsets: Insets = { bottom: 0, left: 0, right: 0, top: 0 }
// Queued for the next `SafeAreaProvider` that mounts after the root one — the shape a nested
// provider inside a native Modal takes in the real library, which measures its own window rather
// than inheriting an ancestor's.
let nextNestedInsets: Insets | undefined
const safeAreaFrame = { height: 0, width: 0, x: 0, y: 0 }

export const SafeAreaInsetsContext = React.createContext(rootInsets)
export const SafeAreaFrameContext = React.createContext(safeAreaFrame)
export const initialWindowMetrics = null

/**
 * SafeAreaProvider renders children directly in runtime Jest tests. Each instance captures its
 * insets once, at mount, from a queued nested override if one is pending, else the shared root
 * value — mirroring how a real nested provider measures its own window once rather than re-reading
 * an ancestor's on every render.
 */
export function SafeAreaProvider(props: { children?: React.ReactNode }) {
  const [insets] = React.useState<Insets>(() => {
    if (nextNestedInsets) {
      const queued = nextNestedInsets
      nextNestedInsets = undefined
      return queued
    }
    return rootInsets
  })
  return React.createElement(
    SafeAreaFrameContext.Provider,
    { value: safeAreaFrame },
    React.createElement(SafeAreaInsetsContext.Provider, { value: insets }, props.children),
  )
}

export function useSafeAreaInsets() {
  return React.useContext(SafeAreaInsetsContext)
}

/**
 * setSafeAreaInsetsForTests sets the mocked root-window safe-area insets for runtime tests. Also
 * clears any queued nested override: a test that queues one but whose sheet never opens (a failure
 * partway through, an early return) would otherwise leak that value into an unrelated later test's
 * root provider.
 */
export function setSafeAreaInsetsForTests(insets: Insets): void {
  rootInsets = insets
  nextNestedInsets = undefined
}

/**
 * setNestedSafeAreaInsetsForTests queues insets for the next `SafeAreaProvider` mounted after the
 * root one, so a test can prove a nested provider (a native Modal's own window) reads different
 * insets than the root window.
 */
export function setNestedSafeAreaInsetsForTests(insets: Insets): void {
  nextNestedInsets = insets
}
