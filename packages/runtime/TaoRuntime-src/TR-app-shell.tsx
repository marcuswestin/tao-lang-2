import React from 'react'
import { Dev } from './dev-runtime/TR-dev'
import { DevMenu } from './dev-runtime/TR-dev-menu'
import { DataLoadRecoveryBoundary } from './TR-data-load-recovery'
import type { TaoLayoutProps } from './TR-layout'
import { mountedDesignStyle } from './TR-mounted-design'
import { ParentDirectionContext } from './TR-parent-direction'
import { requireReactNativeRuntime } from './TR-react-native'
import type { TaoProps } from './TR-TaoProps'

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
  // Subscribing to dev mode re-renders the frame on every change, including layout-bounds toggles.
  const devMode = Dev.useMode()

  return React.createElement(
    RN.KeyboardAvoidingView,
    {
      behavior: platformOS === 'ios' ? 'padding' : undefined,
      style: rootStyle,
    },
    React.createElement(
      DataLoadRecoveryBoundary,
      null,
      appRootChildren(props.children, devMode),
    ),
    devMode.enabled ? React.createElement(DevMenu) : null,
  )
}

/**
 * AppSurfaceFrame is the safe-area-padded scrollable frame around one full-screen content surface.
 * The app host applies it around its navigator, and a navigator that hands the window to a native
 * surface (the platform tab bar) applies it inside each of its screens instead — a native surface
 * must own true window bounds, and an enclosing scroll frame would push its bar offscreen.
 */
export function AppSurfaceFrame(props: {
  children?: React.ReactNode
  /** Inside a native screen the platform supplies the safe-area and bar insets itself. */
  nativeInsets?: boolean
  taoProps?: TaoProps
}): React.JSX.Element {
  const RN = requireReactNativeRuntime()
  const platformOS = RN.Platform?.OS ?? 'web'
  const insets = requireSafeAreaContext().useSafeAreaInsets()
  const contentPadding = props.nativeInsets
    ? {
      paddingBottom: appFramePadding,
      paddingLeft: appFramePadding,
      paddingRight: appFramePadding,
      paddingTop: appFramePadding,
    }
    : {
      paddingBottom: appFramePadding + insets.bottom,
      paddingLeft: appFramePadding + insets.left,
      paddingRight: appFramePadding + insets.right,
      paddingTop: appFramePadding + insets.top,
    }
  return React.createElement(
    RN.ScrollView,
    {
      ...(props.nativeInsets ? { contentInsetAdjustmentBehavior: 'automatic' } : {}),
      contentContainerStyle: [contentStyle, contentPadding],
      keyboardDismissMode: platformOS === 'ios' ? 'interactive' : 'on-drag',
      keyboardShouldPersistTaps: 'handled',
      style: [rootStyle, mountedDesignStyle(props.taoProps, 'AppSurface')],
    },
    React.createElement(
      ParentDirectionContext.Provider,
      { direction: ParentDirectionContext.defaultProps.parentDirection },
      props.children,
    ),
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
