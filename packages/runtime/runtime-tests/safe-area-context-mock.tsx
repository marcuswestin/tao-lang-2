import * as React from 'react'

let safeAreaInsets = { bottom: 0, left: 0, right: 0, top: 0 }
const safeAreaFrame = { height: 0, width: 0, x: 0, y: 0 }

export const SafeAreaInsetsContext = React.createContext(safeAreaInsets)
export const SafeAreaFrameContext = React.createContext(safeAreaFrame)
export const initialWindowMetrics = null

/** SafeAreaProvider renders children directly in runtime Jest tests. */
export function SafeAreaProvider(props: { children?: React.ReactNode }) {
  return React.createElement(
    SafeAreaFrameContext.Provider,
    { value: safeAreaFrame },
    React.createElement(SafeAreaInsetsContext.Provider, { value: safeAreaInsets }, props.children),
  )
}

/** SafeAreaView renders children directly in runtime Jest tests. */
export function SafeAreaView(props: { children?: React.ReactNode }) {
  return React.createElement('SafeAreaView', props, props.children)
}

export function useSafeAreaInsets() {
  return React.useContext(SafeAreaInsetsContext)
}

/** setSafeAreaInsetsForTests sets mocked safe-area insets for runtime tests. */
export function setSafeAreaInsetsForTests(insets: typeof safeAreaInsets): void {
  safeAreaInsets = insets
}
