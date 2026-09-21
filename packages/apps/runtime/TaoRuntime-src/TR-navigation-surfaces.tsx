import React from 'react'
import { AppSurfaceInsetContext, requireSafeAreaContext, type SafeAreaInsets } from './TR-app-shell'
import { createElement } from './TR-create-element'
import {
  occurrenceRegion,
  OutlineRegionScope,
  regionNativeProps,
  type TaoOutlineRegion,
} from './TR-interaction-regions'
import { mountedDesignStyle } from './TR-mounted-design'
import type { TaoNavigationValue } from './TR-navigation'
import { backNavigation } from './TR-navigation-registry'
import type { OverlayEntry, PresentableEntry, ResponseOccurrenceState } from './TR-navigation-state'
import { requireReactNativeRuntime } from './TR-react-native'
import type { TaoProps } from './TR-TaoProps'
import { Views } from './TR-views'

/**
 * NavigationLevel hides covered stack entries without unmounting their local React state. A level
 * that presents one occurrence is that occurrence's region: it registers with the outline and its
 * native root is the named group the platform reads.
 */
export function NavigationLevel(props: {
  children?: React.ReactNode
  fill?: boolean
  hidden: boolean
  region?: TaoOutlineRegion
}): React.JSX.Element {
  const runtime = requireReactNativeRuntime()
  const region = props.region === undefined
    ? undefined
    : { ...props.region, active: () => !props.hidden, primary: !props.hidden }
  return createElement(
    OutlineRegionScope,
    { region },
    createElement(runtime.View, {
      ...regionNativeProps(region),
      accessibilityElementsHidden: props.hidden,
      children: props.children,
      importantForAccessibility: props.hidden ? 'no-hide-descendants' : 'auto',
      style: props.hidden ? hiddenNavigationLevelStyle : props.fill ? visibleOverlayLevelStyle : undefined,
    }),
  ) as React.JSX.Element
}

/** presentedOccurrenceRegion names one presented entry by its live title, else by what was presented. */
export function presentedOccurrenceRegion(
  navigation: TaoNavigationValue,
  entry: PresentableEntry,
  presentation: 'ask' | 'content' | 'overlay' | 'sheet',
  active?: () => boolean,
): TaoOutlineRegion {
  return occurrenceRegion(
    navigation.name,
    entry.instanceId,
    presentation,
    () => entry.host?.read().title ?? entry.presentable.name,
    { ...(active === undefined ? {} : { active }), primary: presentation === 'content' },
  )
}

/** NavigationBackAffordance exposes the same root-safe reducer through an accessible control. */
export function NavigationBackAffordance(props: {
  target: { back(): boolean }
}): React.JSX.Element | null {
  return Views.Pressable(
    {
      action: {
        invoke: () => {
          backNavigation(props.target)
        },
      },
      semanticIdentity: 'navigation:back',
      title: 'Back',
    },
    { nativeProps: { accessibilityLabel: 'Back', accessibilityRole: 'button' } },
  )
}

export const navigationHostStyle = { flex: 1, position: 'relative' } as const
export const navigationContentAccessibilityTestId = '__tao_navigation_content_accessibility'
const overlayLayerStyle = {
  bottom: 0,
  left: 0,
  pointerEvents: 'box-none',
  position: 'absolute',
  right: 0,
  top: 0,
  zIndex: 1,
} as const
const hiddenNavigationLevelStyle = { display: 'none' } as const
const visibleOverlayLevelStyle = { flex: 1 } as const
const zeroInsets: SafeAreaInsets = { bottom: 0, left: 0, right: 0, top: 0 }

// An asked view is modal: it dims what it covers and sits centred over it, rather than rendering as
// another full-bleed layer on top of the content it is supposed to interrupt. The scrim is the
// background and stays full-bleed; its padding is what keeps the centred card off the notch and the
// home indicator, so it grows by the live safe-area insets on top of its fixed minimum.
const askScrimBaseStyle = {
  alignItems: 'center',
  backgroundColor: 'rgba(0, 0, 0, 0.45)',
  bottom: 0,
  justifyContent: 'center',
  left: 0,
  position: 'absolute',
  right: 0,
  top: 0,
} as const

function askScrimInsetStyle(insets: SafeAreaInsets): Record<string, number> {
  return {
    paddingBottom: askScrimPadding + insets.bottom,
    paddingLeft: askScrimPadding + insets.left,
    paddingRight: askScrimPadding + insets.right,
    paddingTop: askScrimPadding + insets.top,
  }
}

const askScrimPadding = 24

const askSurfaceStyle = {
  backgroundColor: '#ffffff',
  borderRadius: 12,
  elevation: 8,
  maxWidth: 420,
  padding: 20,
  shadowColor: '#000000',
  shadowOffset: { height: 8, width: 0 },
  shadowOpacity: 0.25,
  shadowRadius: 24,
  width: '100%',
} as const

// A sheet is the platform's own modal presentation. RN's Modal hosts the OS presentation on both
// platforms — a page sheet on iOS with its native drag-to-dismiss, a modal window on Android — and
// a swipe or system back press enters the same root-safe reducer every other dismissal does.
const sheetInlineScrimStyle = {
  backgroundColor: 'rgba(0, 0, 0, 0.35)',
  flex: 1,
  justifyContent: 'flex-end',
} as const

const sheetInlineSurfaceBaseStyle = {
  backgroundColor: '#ffffff',
  borderTopLeftRadius: 16,
  borderTopRightRadius: 16,
  maxHeight: '90%',
  paddingTop: 20,
} as const

// The card's own background reaches the bottom edge; its bottom padding is what clears the home
// indicator, so it grows by the live inset on top of the fixed base padding. Side padding grows the
// same way for a landscape notch; the top edge never meets the window, so it stays fixed.
function sheetInlineSurfaceInsetStyle(insets: SafeAreaInsets): Record<string, number> {
  return {
    paddingBottom: sheetSurfacePadding + insets.bottom,
    paddingLeft: sheetSurfacePadding + insets.left,
    paddingRight: sheetSurfacePadding + insets.right,
  }
}

const sheetModalSurfaceBaseStyle = {
  backgroundColor: '#ffffff',
  flex: 1,
} as const

// A native Modal presents its own window: the OS does not extend the enclosing safe-area or
// keyboard-avoidance machinery into it the way it does for a screen pushed by `react-native-screens`,
// so this surface computes its own insets rather than delegating to a native `contentInset`.
function sheetModalSurfaceInsetStyle(insets: SafeAreaInsets): Record<string, number> {
  return {
    paddingBottom: sheetSurfacePadding + insets.bottom,
    paddingLeft: sheetSurfacePadding + insets.left,
    paddingRight: sheetSurfacePadding + insets.right,
    paddingTop: sheetSurfacePadding + insets.top,
  }
}

const sheetSurfacePadding = 20

function modalSheet(
  content: React.ReactNode,
  navigation: TaoNavigationValue,
  taoProps: TaoProps | undefined,
  visible: boolean,
  // Only the inline (no-Modal) branch below uses this: it shares the app's own window, so it takes
  // the caller's insets. The native-Modal branch is its own window and reads its own (ModalSheetContent).
  inlineInsets: SafeAreaInsets,
): React.ReactNode {
  const runtime = requireReactNativeRuntime()
  const modal = (runtime as { Modal?: React.ComponentType<any> }).Modal
  const dismiss = () => dismissOverlay(navigation, taoProps)
  if (!modal) {
    // Without a modal host the sheet renders inline, inside the app's own window and its
    // KeyboardAvoidingView; the enclosing level hides it when covered.
    return createElement(
      runtime.View,
      { style: sheetInlineScrimStyle },
      createElement(
        runtime.View,
        {
          ...modalAccessibilityProps(navigation, taoProps, visible),
          style: [
            sheetInlineSurfaceBaseStyle,
            sheetInlineSurfaceInsetStyle(inlineInsets),
            mountedDesignStyle(taoProps, 'ModalSurface'),
          ],
        },
        content,
      ),
    )
  }
  // The modal is a portal above the overlay lane, so covering it cannot rely on the enclosing
  // level: `visible` must track whether this entry is the top of the overlay stack. The native
  // presentation supplies the sheet card and dimming itself, and `pageSheet` rejects transparency.
  return createElement(
    modal,
    {
      allowSwipeDismissal: true,
      animationType: 'slide',
      onRequestClose: dismiss,
      presentationStyle: 'pageSheet',
      visible,
    },
    createElement(ModalSheetSurface, {
      accessibilityProps: modalAccessibilityProps(navigation, taoProps, visible),
      children: content,
      taoProps,
    }),
  )
}

/**
 * ModalSheetSurface nests its own SafeAreaProvider. A native Modal's `pageSheet` is its own native
 * window — on iOS its card starts below the status bar, so its top inset is near zero while the
 * app's root window's top inset covers the status bar — and the enclosing app's insets describe the
 * wrong window. No `initialMetrics`: without one, `react-native-safe-area-context` seeds this
 * provider from the enclosing provider's insets (the root window's) until the modal's own native
 * measurement lands, so the sheet briefly renders with the wrong-but-plausible root padding rather
 * than a blank frame — on web, where there is no per-window native measurement, a nested provider
 * measures the document instead, so a web sheet keeps reading the document's insets (normally zero).
 *
 * React context still crosses this `Modal` boundary — it is a portal, not a separate React tree —
 * so this also resets `AppSurfaceInsetContext` to false: the modal is a window no enclosing
 * `AppSurfaceFrame` ever padded, regardless of what encloses the presenter that opened it.
 */
function ModalSheetSurface(props: {
  accessibilityProps: Record<string, unknown>
  children: React.ReactNode
  taoProps: TaoProps | undefined
}): React.ReactNode {
  const SafeAreaContext = requireSafeAreaContext()
  return createElement(
    AppSurfaceInsetContext.Provider,
    { value: false },
    createElement(SafeAreaContext.SafeAreaProvider, null, createElement(ModalSheetContent, props)),
  )
}

function ModalSheetContent(props: {
  accessibilityProps: Record<string, unknown>
  children: React.ReactNode
  taoProps: TaoProps | undefined
}): React.ReactNode {
  const runtime = requireReactNativeRuntime()
  const platformOS = runtime.Platform?.OS ?? 'web'
  // Reads the provider this component is itself nested in (see ModalSheetSurface above), which
  // measures the modal's own window rather than the app's.
  const insets = requireSafeAreaContext().useSafeAreaInsets()
  return createElement(
    runtime.KeyboardAvoidingView,
    { behavior: platformOS === 'ios' ? 'padding' : undefined, style: sheetModalKeyboardStyle },
    createElement(
      runtime.View,
      {
        ...props.accessibilityProps,
        style: [
          sheetModalSurfaceBaseStyle,
          sheetModalSurfaceInsetStyle(insets),
          mountedDesignStyle(props.taoProps, 'ModalSurface'),
        ],
      },
      props.children,
    ),
  )
}

const sheetModalKeyboardStyle = { flex: 1 } as const

/** NavigationSurface gives every nav a relative host and its own absolute overlay lane. */
export function NavigationSurface(props: {
  content?: React.ReactNode
  navigation: TaoNavigationValue
  overlays: OverlayEntry[]
  taoProps?: TaoProps
}): React.JSX.Element {
  const runtime = requireReactNativeRuntime()
  // Read once per render rather than inside the overlay loop below: the loop's iteration count
  // varies with the overlay stack, and a Hook call must not.
  const insets = requireSafeAreaContext().useSafeAreaInsets()
  // A navigator that does not own its window renders inside an AppSurfaceFrame, whose content is
  // already padded by the live insets — this overlay lane sits inside that same padded content, so
  // the ask scrim and an inline sheet must not add the insets again. A window-owning navigator's
  // overlay lane is a sibling of its per-entry frames and fills the true window, so there it must.
  const alreadyInset = AppSurfaceInsetContext.use()
  const overlayInsets = alreadyInset ? zeroInsets : insets
  const contentHidden = props.overlays.some(modalOverlay)
  const overlays = props.overlays.length > 0
    ? createElement(runtime.View, {
      children: props.overlays.map((entry, index) => {
        const visible = index === props.overlays.length - 1
        const content = entry.presentable.render(
          entry.arguments,
          entry.response
            ? askProps(props.taoProps, props.navigation, entry.response)
            : navigationProps(props.taoProps, props.navigation),
        )
        return createElement(NavigationLevel, {
          children: entry.response
            ? modalAsk(content, props.navigation, props.taoProps, visible, overlayInsets)
            : entry.sheet
            ? modalSheet(content, props.navigation, props.taoProps, visible, overlayInsets)
            : content,
          fill: true,
          hidden: !visible,
          key: entry.instanceId,
          region: presentedOccurrenceRegion(
            props.navigation,
            entry,
            entry.response ? 'ask' : entry.sheet ? 'sheet' : 'overlay',
          ),
        })
      }),
      style: overlayLayerStyle,
    })
    : null
  return createElement(
    runtime.View,
    {
      style: [
        navigationHostStyle,
        mountedDesignStyle(props.taoProps, 'NavigationHost'),
        pointerTransparentStyle,
      ],
    },
    createElement(runtime.View, {
      accessibilityElementsHidden: contentHidden,
      children: props.content,
      importantForAccessibility: contentHidden ? 'no-hide-descendants' : 'auto',
      style: navigationContentStyle,
      testID: navigationContentAccessibilityTestId,
    }),
    overlays,
  )
}

const navigationContentStyle = { flex: 1 } as const
const pointerTransparentStyle = { pointerEvents: 'box-none' } as const

function appInProps(props: TaoProps | undefined): TaoProps['app'] {
  return props?.app ?? (props?.callerProps ? appInProps(props.callerProps) : undefined)
}

/** modalAsk centres one asked view on a dimming scrim, which is what makes it read as modal. */
function modalAsk(
  content: React.ReactNode,
  navigation: TaoNavigationValue,
  taoProps: TaoProps | undefined,
  visible: boolean,
  insets: SafeAreaInsets,
): React.ReactNode {
  const runtime = requireReactNativeRuntime()
  return createElement(
    runtime.View,
    { style: [askScrimBaseStyle, askScrimInsetStyle(insets)] },
    createElement(
      runtime.View,
      {
        ...modalAccessibilityProps(navigation, taoProps, visible),
        style: [askSurfaceStyle, mountedDesignStyle(taoProps, 'ModalSurface')],
      },
      content,
    ),
  )
}

function modalOverlay(entry: OverlayEntry): boolean {
  return entry.response !== undefined || entry.sheet === true
}

function modalAccessibilityProps(
  navigation: TaoNavigationValue,
  taoProps: TaoProps | undefined,
  visible: boolean,
): Record<string, unknown> {
  return visible
    ? {
      accessibilityViewIsModal: true,
      onAccessibilityEscape: () => dismissOverlay(navigation, taoProps),
    }
    : {}
}

function dismissOverlay(navigation: TaoNavigationValue, taoProps: TaoProps | undefined): boolean {
  const app = appInProps(taoProps)
  return app ? app.dismiss(navigation) : backNavigation(navigation)
}

export function navigationProps(props: TaoProps | undefined, navigation: TaoNavigationValue): TaoProps {
  return { ...props, navigation }
}

function askProps(
  props: TaoProps | undefined,
  navigation: TaoNavigationValue,
  response: ResponseOccurrenceState,
): TaoProps {
  return { ...props, navigation, response }
}
