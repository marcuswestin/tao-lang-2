import React from 'react'
import { Dev } from './dev-runtime/TR-dev'
import { DevMenu } from './dev-runtime/TR-dev-menu'
import { createElement } from './TR-create-element'
import { DataLoadRecoveryBoundary } from './TR-data-load-recovery'
import { mountedDesignStyle } from './TR-mounted-design'
import { ParentDirectionContext } from './TR-parent-direction'
import { requireReactNativeRuntime } from './TR-react-native'
import { SchemeControls, type TaoScheme } from './TR-scheme'
import type { TaoProps } from './TR-TaoProps'

type AppShellProps = {
  children?: React.ReactNode
}

export type SafeAreaInsets = {
  readonly bottom: number
  readonly left: number
  readonly right: number
  readonly top: number
}

export type SafeAreaContextModule = {
  /**
   * `SafeAreaProvider` renders nothing until it has insets, so a provider with no parent and no
   * `initialMetrics` withholds its whole subtree for one native layout round trip. Passing
   * `initialWindowMetrics` — the values the native side captured at startup — means the first frame
   * renders instead of a blank one.
   */
  readonly initialWindowMetrics?: { frame: unknown; insets: SafeAreaInsets } | null
  readonly SafeAreaProvider: React.ComponentType<{
    children?: React.ReactNode
    initialMetrics?: { frame: unknown; insets: SafeAreaInsets } | null
  }>
  useSafeAreaInsets(): SafeAreaInsets
}

/** The inset every full-screen Tao surface keeps between its content and the window edge. */
export const appFramePadding = 12

const ReactAppSurfaceInsetContext = React.createContext(false)

/**
 * AppSurfaceInsetContext says whether the nearest enclosing AppSurfaceFrame already padded its
 * content away from the window edge — true inside both the computed-insets branch and the
 * `nativeInsets` branch, since either way the frame already stands between its content and the true
 * window. A presentation surface (ask, sheet, an overlay lane) reads this to decide whether it must
 * add the live safe-area insets itself or whether doing so would pad twice.
 *
 * React context still reaches across an RN `Modal` boundary (it is a portal, not a separate React
 * tree), so a `Modal`'s content would otherwise inherit `true` from whatever frame encloses the
 * presenter — even though the modal is its own window, one that enclosing frame never padded. A
 * `Modal`'s own surface resets this back to `false` for its children with `{ value: false }`.
 */
export const AppSurfaceInsetContext = {
  Provider: AppSurfaceInsetProvider,
  use,
} as const

function AppSurfaceInsetProvider(props: { children?: React.ReactNode; value?: boolean }): React.ReactElement {
  return createElement(ReactAppSurfaceInsetContext.Provider, { value: props.value ?? true }, props.children)
}

function use(): boolean {
  return React.useContext(ReactAppSurfaceInsetContext)
}

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
  return createElement(
    SafeAreaContext.SafeAreaProvider,
    null,
    createElement(AppShellFrame, { ...props, SafeAreaContext }),
  )
}

function AppShellFrame(props: AppShellProps & { SafeAreaContext: SafeAreaContextModule }): React.JSX.Element {
  const RN = requireReactNativeRuntime()
  const platformOS = RN.Platform?.OS ?? 'web'
  // Subscribing to dev mode re-renders the frame on every change, including layout-bounds toggles.
  const devMode = Dev.useMode()
  const scheme = SchemeControls.use()

  return createElement(
    RN.KeyboardAvoidingView,
    {
      behavior: platformOS === 'ios' ? 'padding' : undefined,
      style: rootStyle,
    },
    createElement(
      DataLoadRecoveryBoundary,
      null,
      appRootChildren(props.children, devMode, scheme.resolved),
    ),
    devMode.enabled && !Dev.isMenuHidden() ? createElement(DevMenu) : null,
  )
}

/**
 * AppSurfaceFrame is the safe-area-padded scrollable frame around one full-screen content surface.
 * The app host applies it around its navigator, and a navigator that hands the window to a native
 * surface (the platform tab bar) applies it inside each of its screens instead — a native surface
 * must own true window bounds, and an enclosing scroll frame would push its bar offscreen.
 */
export function AppSurfaceFrame(props: {
  /** Chrome floating over the bottom edge; the content scrolls beneath it and clears it at the end. */
  bottomInset?: number
  children?: React.ReactNode
  /** Inside a native screen the platform supplies the safe-area and bar insets itself. */
  nativeInsets?: boolean
  taoProps?: TaoProps
}): React.JSX.Element {
  const RN = requireReactNativeRuntime()
  const platformOS = RN.Platform?.OS ?? 'web'
  const insets = requireSafeAreaContext().useSafeAreaInsets()
  const bottomInset = props.bottomInset ?? 0
  const contentPadding = props.nativeInsets
    ? {
      paddingBottom: appFramePadding + bottomInset,
      paddingLeft: appFramePadding,
      paddingRight: appFramePadding,
      paddingTop: appFramePadding,
    }
    : {
      paddingBottom: appFramePadding + insets.bottom + bottomInset,
      paddingLeft: appFramePadding + insets.left,
      paddingRight: appFramePadding + insets.right,
      paddingTop: appFramePadding + insets.top,
    }
  return createElement(
    RN.ScrollView,
    {
      ...(props.nativeInsets ? { contentInsetAdjustmentBehavior: 'automatic' } : {}),
      contentContainerStyle: [contentStyle, contentPadding],
      keyboardDismissMode: platformOS === 'ios' ? 'interactive' : 'on-drag',
      keyboardShouldPersistTaps: 'handled',
      style: [rootStyle, mountedDesignStyle(props.taoProps, 'AppSurface')],
    },
    createElement(
      AppSurfaceInsetContext.Provider,
      null,
      createElement(
        ParentDirectionContext.Provider,
        { direction: ParentDirectionContext.defaultProps.parentDirection },
        props.children,
      ),
    ),
  )
}

// The generated app root reaches AppShell as a stable `children` element, so React skips
// re-rendering that subtree when only the frame re-renders. Cloning the root hands React fresh
// elements for dev-mode repaints and supplies default Tao layout props to root injected layouts.
function appRootChildren(children: React.ReactNode, devMode: unknown, scheme: TaoScheme): React.ReactNode {
  return React.Children.map(children, child => {
    if (!React.isValidElement(child)) {
      return child
    }

    const childProps = child.props as { __tao?: TaoProps }
    const taoProps: TaoProps = { ...ParentDirectionContext.propsWithDefault(childProps.__tao), scheme }
    return React.cloneElement(child as React.ReactElement<{ __tao?: TaoProps; __taoDevMode?: unknown }>, {
      __tao: taoProps,
      __taoDevMode: devMode,
    })
  })
}

export function requireSafeAreaContext(): SafeAreaContextModule {
  return require('react-native-safe-area-context') as SafeAreaContextModule
}
