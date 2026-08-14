import React from 'react'
import { Dev } from './dev-runtime/TR-dev'
import { DevMenu } from './dev-runtime/TR-dev-menu'
import { DataLoadRecoveryBoundary } from './TR-data-load-recovery'
import type { TaoLayoutProps } from './TR-layout'
import { ParentDirectionContext } from './TR-parent-direction'
import { requireReactNativeRuntime } from './TR-react-native'

type AppShellProps = {
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
      DataLoadRecoveryBoundary,
      null,
      React.createElement(
        RN.ScrollView,
        {
          contentContainerStyle: [contentStyle, contentPadding],
          keyboardDismissMode: platformOS === 'ios' ? 'interactive' : 'on-drag',
          keyboardShouldPersistTaps: 'handled',
          style: rootStyle,
        },
        React.createElement(
          ParentDirectionContext.Provider,
          { direction: ParentDirectionContext.defaultProps.parentDirection },
          appRootChildren(props.children, devMode),
        ),
      ),
    ),
    devMode.enabled ? React.createElement(DevMenu) : null,
  )
}

// The generated app root reaches AppShell as a stable `children` element, so React skips
// re-rendering that subtree when only the frame re-renders. Cloning the root hands React fresh
// elements for dev-mode repaints and supplies default Tao layout props to root injected layouts.
function appRootChildren(children: React.ReactNode, devMode: unknown): React.ReactNode {
  return React.Children.map(children, child => {
    if (!React.isValidElement(child)) {
      return child
    }

    const childProps = child.props as { __tao?: TaoLayoutProps }
    return React.cloneElement(child as React.ReactElement<{ __tao?: TaoLayoutProps; __taoDevMode?: unknown }>, {
      __tao: ParentDirectionContext.propsWithDefault(childProps.__tao),
      __taoDevMode: devMode,
    })
  })
}

function requireSafeAreaContext(): SafeAreaContextModule {
  return require('react-native-safe-area-context') as SafeAreaContextModule
}
