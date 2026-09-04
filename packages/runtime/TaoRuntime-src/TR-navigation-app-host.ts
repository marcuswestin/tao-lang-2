import React from 'react'
import { appFramePadding, AppSurfaceFrame, requireSafeAreaContext } from './TR-app-shell'
import { DataControls } from './TR-data'
import { TaoErrorBoundary } from './TR-error-containment'
import { RuntimeAppDefinition } from './TR-navigation-app'
import { browserNavigationHistoryDriver } from './TR-navigation-browser-history'
import {
  backNavigation,
  clearActiveBackTarget,
  setActiveBackTarget,
} from './TR-navigation-registry'
import type { Subscription } from './TR-navigation-state'
import { NavigationBackAffordance, navigationHostStyle } from './TR-navigation-surfaces'
import { requireReactNativeRuntime } from './TR-react-native'
import type { TaoProps } from './TR-TaoProps'

export function NavigationAppHost(props: { app: RuntimeAppDefinition; __tao?: TaoProps }): React.JSX.Element {
  return React.createElement(
    TaoErrorBoundary,
    {
      app: props.app,
      boundaryId: `app:${props.app.declaration.canonicalIdentity?.canonical ?? props.app.definition.name}`,
      frame: { boundary: 'app', declaration: props.app.definition.name },
      stateKey: props.app.snapshot(),
    },
    React.createElement(NavigationAppHostContent, props),
  )
}

function NavigationAppHostContent(props: { app: RuntimeAppDefinition; __tao?: TaoProps }): React.JSX.Element {
  const ready = useNavigationRestoration(props.app)
  const runtime = requireReactNativeRuntime()
  if (!ready) {
    return React.createElement(runtime.View, { style: navigationHostStyle })
  }
  return React.createElement(MountedNavigationAppHost, props)
}

function MountedNavigationAppHost(props: { app: RuntimeAppDefinition; __tao?: TaoProps }): React.JSX.Element {
  useSubscription(props.app)
  const navigator = props.app.navigator
  const auxiliaries = Object.values(props.app.auxiliaries)
  useSubscription(navigator)
  // App auxiliary declarations are static, so hook cardinality is stable for the mounted app.
  for (const auxiliary of auxiliaries) {
    useSubscription(auxiliary)
  }
  React.useSyncExternalStore(DataControls.subscribeAll, DataControls.revision, DataControls.revision)
  usePlatformBack(props.app)
  const runtime = requireReactNativeRuntime()
  const appTaoProps = { ...props.__tao, app: props.app }
  const focusedAuxiliary = auxiliaries.findLast(auxiliary => auxiliary.historyDepth() > 0)
  const navigatorTaoProps = {
    ...appTaoProps,
    navigationHostActive: focusedAuxiliary === undefined,
  }
  const toasts = props.app.renderToasts(appTaoProps)
  // A navigator that hands the window to a native surface gets true window bounds; every other
  // navigator renders inside the app's safe-area scroll frame, exactly as before.
  const ownsWindow = navigator.ownsWindowSurface()
  const content = React.createElement(
    React.Fragment,
    { key: 'levels' },
    props.app.canGoBack && (focusedAuxiliary !== undefined || !navigator.ownsBackAffordance())
      ? React.createElement(AppBackAffordance, { inset: ownsWindow, target: props.app })
      : null,
    navigator.render(navigatorTaoProps),
    ...auxiliaries.map(auxiliary =>
      auxiliary.render({
        ...appTaoProps,
        navigationHostActive: auxiliary === focusedAuxiliary,
      })
    ),
  )
  return React.createElement(runtime.View, {
    children: [
      ownsWindow
        ? content
        : React.createElement(AppSurfaceFrame, { key: 'content', taoProps: appTaoProps }, content),
      React.Children.count(toasts) > 0
        ? React.createElement(runtime.View, {
          children: toasts,
          key: 'app-toasts',
          style: toastLayerStyle,
        })
        : null,
    ],
    style: navigationAppHostStyle,
  })
}

/**
 * The app's own Back control, inset when nothing above it is.
 *
 * A navigator that owns the window surface renders outside the app's safe-area frame, and this
 * control is its sibling — so without the inset it draws in the status bar, where the notch clips
 * it and the system takes its taps. Every other navigator renders inside `AppSurfaceFrame`, which
 * already insets this along with the content.
 */
function AppBackAffordance(props: { inset: boolean; target: RuntimeAppDefinition }): React.JSX.Element {
  const runtime = requireReactNativeRuntime()
  const insets = requireSafeAreaContext().useSafeAreaInsets()
  const affordance = React.createElement(NavigationBackAffordance, { target: props.target })
  return props.inset
    ? React.createElement(runtime.View, {
      children: affordance,
      // The frame padding as well as the insets: this control is standing in for one that would
      // otherwise sit inside `AppSurfaceFrame`, and a Back button flush against the window edge
      // reads as a mistake next to content that is never flush against it.
      style: {
        paddingLeft: appFramePadding + insets.left,
        paddingRight: appFramePadding + insets.right,
        paddingTop: appFramePadding + insets.top,
      },
    })
    : React.createElement(runtime.View, { children: affordance })
}

function useNavigationRestoration(app: RuntimeAppDefinition): boolean {
  const [ready, setReady] = React.useState(() => !app.restorationRequiresInitialLoad())
  React.useEffect(() => {
    let active = true
    let detach: (() => void) | undefined
    void app.attachRestoration().then(dispose => {
      if (!active) {
        dispose()
        return
      }
      detach = dispose
      setReady(true)
    })
    return () => {
      active = false
      detach?.()
    }
  }, [app])
  return ready
}

function useSubscription(subscription: Subscription): void {
  React.useSyncExternalStore(subscription.subscribe, subscription.snapshot, subscription.snapshot)
}

function usePlatformBack(target: RuntimeAppDefinition): void {
  React.useEffect(() => {
    setActiveBackTarget(target)
    const browserHistory = browserNavigationHistoryDriver()
    if (browserHistory) {
      const detachBrowserHistory = target.attachBrowserHistory(browserHistory)
      return () => {
        detachBrowserHistory()
        clearActiveBackTarget(target)
      }
    }
    const subscription = requireReactNativeRuntime().BackHandler?.addEventListener(
      'hardwareBackPress',
      () => backNavigation(target),
    )
    return () => {
      subscription?.remove()
      clearActiveBackTarget(target)
    }
  }, [target])
}

const navigationAppHostStyle = {
  ...navigationHostStyle,
  pointerEvents: 'box-none',
} as const

const toastLayerStyle = {
  alignItems: 'center',
  bottom: 0,
  left: 0,
  paddingBottom: 24,
  paddingHorizontal: 16,
  pointerEvents: 'box-none',
  position: 'absolute',
  right: 0,
  zIndex: 2,
} as const
