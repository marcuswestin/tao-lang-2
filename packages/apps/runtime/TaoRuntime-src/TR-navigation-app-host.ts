import React from 'react'
import { MountedAppActionBoundary } from './TR-action-boundary'
import { appFramePadding, AppSurfaceFrame, requireSafeAreaContext } from './TR-app-shell'
import { AuthControls } from './TR-auth'
import { createElement } from './TR-create-element'
import { DataControls } from './TR-data'
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
import { WindowLayer, WindowLayerProvider, WindowLayerRegistry } from './TR-window-layer'

export function NavigationAppHost(props: { app: RuntimeAppDefinition; __tao?: TaoProps }): React.JSX.Element {
  const scope = AuthControls.UseOptionalContext()
  const app = scope ? scope.app(props.app) : props.app
  const mountedProps = { ...props, app }
  React.useEffect(() => {
    if (scope) {
      app.commitRegistration()
    }
  }, [app, scope])
  return createElement(
    MountedAppActionBoundary,
    {
      app,
      __tao: props.__tao,
    },
    createElement(NavigationAppHostContent, mountedProps),
  )
}

function NavigationAppHostContent(props: { app: RuntimeAppDefinition; __tao?: TaoProps }): React.JSX.Element {
  const ready = useNavigationRestoration(props.app)
  const runtime = requireReactNativeRuntime()
  if (!ready) {
    return createElement(runtime.View, { style: navigationHostStyle })
  }
  return createElement(MountedNavigationAppHost, props)
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
  const insets = requireSafeAreaContext().useSafeAreaInsets()
  const [windowLayer] = React.useState(() => new WindowLayerRegistry())
  const appTaoProps = { ...props.__tao, app: props.app }
  const focusedAuxiliary = auxiliaries.findLast(auxiliary => auxiliary.historyDepth() > 0)
  const navigatorTaoProps = {
    ...appTaoProps,
    navigationHostActive: focusedAuxiliary === undefined,
  }
  const toasts = props.app.renderToasts(appTaoProps)
  const handleKeyDown = React.useCallback(
    (event: TaoAppHostKeyEvent) => {
      if (event.defaultPrevented) {
        return
      }
      const hardwareEvent = event.nativeEvent ?? event
      // The outline deliberately stops at an injected or foreign view. Let the browser deliver keys
      // to an editable descendant that Tao does not own. Escape and Tab return to Tao attention only
      // while a Tao control is actually engaged.
      if (
        isUnmodifiedKey(hardwareEvent)
        && isEditableTarget(event.target)
        && (
          !isEditableAttentionExitKey(hardwareEvent)
          || InteractionControls.Attention.read().engaged === undefined
        )
      ) {
        return
      }
      const handled = dispatchInteractionHardwareKey(
        hardwareEvent,
        InteractionControls.PressKey,
        {
          navigatorPlatform: (globalThis as { navigator?: { platform?: string } }).navigator?.platform,
          platformOS: runtime.Platform?.OS,
        },
      )
      if (handled) {
        event.preventDefault?.()
        event.stopPropagation?.()
      }
    },
    [runtime.Platform?.OS],
  )
  const onKeyDown = runtime.Platform?.OS === 'web' ? handleKeyDown : undefined
  useWebInteractionKeyboard(onKeyDown)
  const onPointerDown = runtime.Platform?.OS === 'web'
    ? (event: TaoAppHostPointerEvent) => {
      if (event.target === event.currentTarget) {
        event.currentTarget?.focus?.()
      }
    }
    : undefined
  // A navigator that hands the window to a native surface gets true window bounds; every other
  // navigator renders inside the app's safe-area scroll frame, exactly as before.
  const ownsWindow = navigator.ownsWindowSurface()
  const mainContent = createElement(
    React.Fragment,
    { key: 'main' },
    props.app.canGoBack && (focusedAuxiliary !== undefined || !navigator.ownsBackAffordance())
      ? createElement(AppBackAffordance, { inset: ownsWindow, target: props.app, taoProps: appTaoProps })
      : null,
    navigator.render(navigatorTaoProps),
  )
  // A genuine app auxiliary (`@window`) is its own surface, independent of the main navigator: one
  // may hand its window to a native surface while the other does not, so each decides its own
  // AppSurfaceFrame rather than sharing the main navigator's verdict.
  const auxiliaryContent = auxiliaries.map(auxiliary => {
    const rendered = auxiliary.render({
      ...appTaoProps,
      navigationHostActive: auxiliary === focusedAuxiliary,
    })
    return auxiliary.ownsWindowSurface()
      ? rendered
      : createElement(AppSurfaceFrame, { taoProps: appTaoProps }, rendered)
  })
  const hostProps = interactionMeasurements.bindRoot({
    children: [
      ownsWindow
        ? mainContent
        : createElement(AppSurfaceFrame, { key: 'content', taoProps: appTaoProps }, mainContent),
      ...auxiliaryContent,
      // The root window's layer: an ask dims the whole window from here, above the content and the
      // auxiliaries and beneath the toasts, which stay readable over a dimmed screen.
      createElement(WindowLayer, { key: 'app-window-layer', registry: windowLayer }),
      React.Children.count(toasts) > 0
        ? createElement(runtime.View, {
          children: toasts,
          key: 'app-toasts',
          // The layer stretches edge to edge (background); its own padding keeps a toast off the
          // home indicator and any side notch (content), growing the fixed base padding by the live
          // safe-area inset the same way every other floating Tao surface does.
          style: [
            toastLayerStyle,
            {
              paddingBottom: toastLayerBottomPadding + insets.bottom,
              paddingLeft: toastLayerHorizontalPadding + insets.left,
              paddingRight: toastLayerHorizontalPadding + insets.right,
            },
          ],
        })
        : null,
      createElement(InteractionLayersHost, { key: 'interaction-layers', taoProps: appTaoProps }),
    ],
    onKeyDown,
    onPointerDown,
    style: navigationAppHostStyle,
    tabIndex: runtime.Platform?.OS === 'web' ? 0 : undefined,
  })
  return createElement(WindowLayerProvider, { registry: windowLayer }, createElement(runtime.View, hostProps))
}

type TaoAppHostKeyEvent =
  & TaoHardwareKeyEvent
  & Readonly<{
    nativeEvent?: TaoHardwareKeyEvent
    defaultPrevented?: boolean
    preventDefault?(): void
    stopPropagation?(): void
    target?: unknown
  }>

type TaoWebKeyboardTarget = Readonly<{
  addEventListener(type: 'keydown', listener: (event: TaoAppHostKeyEvent) => void, capture: boolean): void
  removeEventListener(type: 'keydown', listener: (event: TaoAppHostKeyEvent) => void, capture: boolean): void
}>

type TaoAppHostPointerEvent = Readonly<{
  currentTarget?: { focus?(): void }
  target?: unknown
}>

type TaoEditableTarget = Readonly<{
  closest?(selector: string): unknown
  getAttribute?(name: string): string | null
  isContentEditable?: boolean
  tagName?: string
}>

function isUnmodifiedKey(event: TaoHardwareKeyEvent): boolean {
  return !event.altKey && !event.ctrlKey && !event.metaKey
}

function isEditableAttentionExitKey(event: TaoHardwareKeyEvent): boolean {
  const key = event.key?.toLocaleLowerCase()
  return key === 'escape' || key === 'esc' || key === 'tab'
}

function isEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') {
    return false
  }
  const element = target as TaoEditableTarget
  const tag = element.tagName?.toLocaleLowerCase()
  const editableAncestor = element.closest?.(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
  )
  return element.isContentEditable === true
    || tag === 'input'
    || tag === 'textarea'
    || tag === 'select'
    || element.getAttribute?.('role') === 'textbox'
    || editableAncestor !== null && editableAncestor !== undefined
}

/**
 * Browser shortcuts are decided before a focusable app root sees bubbling input. Listening on the
 * document in capture phase lets Tao claim only keys its reducer actually handles while leaving
 * browser and editable-control defaults untouched for every unhandled key.
 */
function useWebInteractionKeyboard(listener: ((event: TaoAppHostKeyEvent) => void) | undefined): void {
  React.useEffect(() => {
    const target = (globalThis as unknown as { document?: TaoWebKeyboardTarget }).document
    if (!listener || !target) {
      return
    }
    target.addEventListener('keydown', listener, true)
    return () => target.removeEventListener('keydown', listener, true)
  }, [listener])
}

/**
 * The app's own Back control, inset when nothing above it is.
 *
 * A navigator that owns the window surface renders outside the app's safe-area frame, and this
 * control is its sibling — so without the inset it draws in the status bar, where the notch clips
 * it and the system takes its taps. Every other navigator renders inside `AppSurfaceFrame`, which
 * already insets this along with the content.
 */
function AppBackAffordance(
  props: { inset: boolean; target: RuntimeAppDefinition; taoProps: TaoProps },
): React.JSX.Element {
  const runtime = requireReactNativeRuntime()
  const insets = requireSafeAreaContext().useSafeAreaInsets()
  const affordance = createElement(NavigationBackAffordance, { target: props.target, taoProps: props.taoProps })
  return props.inset
    ? createElement(runtime.View, {
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
    : createElement(runtime.View, { children: affordance })
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
  pointerEvents: 'box-none',
  position: 'absolute',
  right: 0,
  zIndex: 2,
} as const
const toastLayerBottomPadding = 24
const toastLayerHorizontalPadding = 16
