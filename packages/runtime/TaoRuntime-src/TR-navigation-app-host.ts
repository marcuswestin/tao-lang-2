import React from 'react'
import { AppSurfaceFrame } from './TR-app-shell'
import { DataControls } from './TR-data'
import { TaoErrorBoundary } from './TR-error-containment'
import { InteractionControls } from './TR-interaction-catalog'
import {
  dispatchInteractionHardwareKey,
  type TaoHardwareKeyEvent,
} from './TR-interaction-keys'
import { InteractionLayersHost } from './TR-interaction-layers'
import { interactionMeasurements } from './TR-interaction-outline'
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
  const onKeyDown = runtime.Platform?.OS === 'web'
    ? (event: TaoAppHostKeyEvent) => {
      const handled = dispatchInteractionHardwareKey(
        event.nativeEvent ?? event,
        InteractionControls.PressKey,
        {
          navigatorPlatform: (globalThis as { navigator?: { platform?: string } }).navigator?.platform,
          platformOS: runtime.Platform?.OS,
        },
      )
      if (handled) {
        event.preventDefault?.()
      }
    }
    : undefined
  const onPointerDown = runtime.Platform?.OS === 'web'
    ? (event: TaoAppHostPointerEvent) => {
      if (event.target === event.currentTarget) {
        event.currentTarget?.focus?.()
      }
    }
    : undefined
  // A navigator that hands the window to a native surface gets true window bounds; every other
  // navigator renders inside the app's safe-area scroll frame, exactly as before.
  const content = React.createElement(
    React.Fragment,
    { key: 'levels' },
    props.app.canGoBack && (focusedAuxiliary !== undefined || !navigator.ownsBackAffordance())
      ? React.createElement(NavigationBackAffordance, { target: props.app })
      : null,
    navigator.render(navigatorTaoProps),
    ...auxiliaries.map(auxiliary =>
      auxiliary.render({
        ...appTaoProps,
        navigationHostActive: auxiliary === focusedAuxiliary,
      })
    ),
  )
  const hostProps = interactionMeasurements.bindRoot({
    children: [
      navigator.ownsWindowSurface()
        ? content
        : React.createElement(AppSurfaceFrame, { key: 'content', taoProps: appTaoProps }, content),
      React.Children.count(toasts) > 0
        ? React.createElement(runtime.View, {
          children: toasts,
          key: 'app-toasts',
          style: toastLayerStyle,
        })
        : null,
      React.createElement(InteractionLayersHost, { key: 'interaction-layers', taoProps: appTaoProps }),
    ],
    onKeyDown,
    onPointerDown,
    style: navigationAppHostStyle,
    tabIndex: runtime.Platform?.OS === 'web' ? 0 : undefined,
  })
  return React.createElement(runtime.View, hostProps)
}

type TaoAppHostKeyEvent =
  & TaoHardwareKeyEvent
  & Readonly<{
    nativeEvent?: TaoHardwareKeyEvent
    preventDefault?(): void
  }>

type TaoAppHostPointerEvent = Readonly<{
  currentTarget?: { focus?(): void }
  target?: unknown
}>

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
