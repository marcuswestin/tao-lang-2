import React from 'react'
import { Dev } from './dev-runtime/TR-dev'
import { DevMenu } from './dev-runtime/TR-dev-menu'
import { requireReactNativeRuntime } from './TR-react-native'

export type AppShellProps = {
  children?: React.ReactNode
}

type SafeAreaInsets = {
  readonly bottom: number
  readonly left: number
  readonly right: number
  readonly top: number
}

type SafeAreaContextModule = {
  readonly SafeAreaProvider: React.ComponentType<{ children?: React.ReactNode }>
  useSafeAreaInsets(): SafeAreaInsets
}

const appFramePadding = 12

const contentStyle = {
  flexGrow: 1,
  minHeight: '100%',
} as const

const rootStyle = {
  backgroundColor: '#fff',
  flex: 1,
} as const

/** AppShell renders the safe default Tao app frame around generated app roots. */
export const AppShell = AppShellComponent

function AppShellComponent(props: AppShellProps): React.JSX.Element {
  const SafeAreaContext = requireSafeAreaContext()
  return React.createElement(
    SafeAreaContext.SafeAreaProvider,
    null,
    React.createElement(AppShellFrame, { ...props, SafeAreaContext }),
  )
}

function AppShellFrame(props: AppShellProps & { SafeAreaContext: SafeAreaContextModule }): React.JSX.Element {
  const RN = requireReactNativeRuntime()
  const platformOS = RN.Platform?.OS ?? 'web'
  const insets = props.SafeAreaContext.useSafeAreaInsets()
  // Subscribing to dev mode re-renders the frame on every change, including layout-bounds toggles.
  const devMode = Dev.useMode()
  const contentPadding = {
    paddingBottom: appFramePadding + insets.bottom,
    paddingLeft: appFramePadding + insets.left,
    paddingRight: appFramePadding + insets.right,
    paddingTop: appFramePadding + insets.top,
  }

  return React.createElement(
    RN.KeyboardAvoidingView,
    {
      behavior: platformOS === 'ios' ? 'padding' : undefined,
      style: rootStyle,
    },
    React.createElement(
      RN.ScrollView,
      {
        contentContainerStyle: [contentStyle, contentPadding],
        keyboardDismissMode: platformOS === 'ios' ? 'interactive' : 'on-drag',
        keyboardShouldPersistTaps: 'handled',
        style: rootStyle,
      },
      repaintOnDevModeChange(props.children, devMode),
    ),
    devMode.enabled ? React.createElement(DevMenu) : null,
  )
}

// The generated app root reaches AppShell as a stable `children` element, so React skips
// re-rendering that subtree when only the frame re-renders. Cloning with the current dev mode
// hands React fresh elements, repainting the whole app (e.g. to add or remove layout bounds)
// while preserving its component state.
function repaintOnDevModeChange(children: React.ReactNode, devMode: unknown): React.ReactNode {
  return React.Children.map(children, child => {
    return React.isValidElement(child)
      ? React.cloneElement(child as React.ReactElement<{ __taoDevMode?: unknown }>, { __taoDevMode: devMode })
      : child
  })
}

function requireSafeAreaContext(): SafeAreaContextModule {
  return require('react-native-safe-area-context') as SafeAreaContextModule
}
