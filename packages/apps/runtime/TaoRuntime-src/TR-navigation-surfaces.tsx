import React from 'react'
import { AppSurfaceInsetContext, requireSafeAreaContext, type SafeAreaInsets } from './TR-app-shell'
import { createElement } from './TR-create-element'
import { OutlineScope, useOutlineParentIdentity } from './TR-interaction-outline'
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
import { catalystPalette } from './TR-scheme'
import type { TaoProps } from './TR-TaoProps'
import { Views } from './TR-views'
import { WindowLayer, WindowLayerPortal, WindowLayerProvider, WindowLayerRegistry } from './TR-window-layer'

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
  const covered = LevelHiddenContext.use()
  const region = props.region === undefined
    ? undefined
    : { ...props.region, active: () => !props.hidden, primary: !props.hidden }
  return createElement(
    OutlineRegionScope,
    { region },
    createElement(
      LevelHiddenContext.Provider,
      { hidden: covered || props.hidden },
      createElement(runtime.View, {
        ...regionNativeProps(region),
        accessibilityElementsHidden: props.hidden,
        children: props.children,
        importantForAccessibility: props.hidden ? 'no-hide-descendants' : 'auto',
        style: props.hidden ? hiddenNavigationLevelStyle : props.fill ? visibleOverlayLevelStyle : undefined,
      }),
    ),
  ) as React.JSX.Element
}

const ReactLevelHiddenContext = React.createContext(false)

/**
 * LevelHiddenContext says whether an enclosing level hides everything rendered inside it — a
 * covered stack entry, an inactive selection item. A surface that leaves its presenter's subtree for
 * a window layer reads it at the presenter's position, so whatever hides the presenter hides it.
 */
export const LevelHiddenContext = {
  Provider: LevelHiddenProvider,
  use: (): boolean => React.useContext(ReactLevelHiddenContext),
} as const

function LevelHiddenProvider(props: { children?: React.ReactNode; hidden: boolean }): React.ReactElement {
  return createElement(ReactLevelHiddenContext.Provider, { value: props.hidden }, props.children)
}

/**
 * WindowAsk places one ask's level in the nearest window layer, carrying over what the presenter's
 * place in the tree gave it: the outline region it hangs under, so attention treats the ask as the
 * presenter's, and whether an enclosing level hides the presenter, so a covered presenter's ask is
 * covered too rather than dimming the window from behind a screen that is not showing.
 */
function WindowAsk(props: { hidden: boolean; level: (hidden: boolean) => React.ReactNode }): React.ReactNode {
  const parent = useOutlineParentIdentity()
  const covered = LevelHiddenContext.use()
  return createElement(WindowLayerPortal, {
    children: createElement(OutlineScope, { identity: parent }, props.level(props.hidden || covered)),
  })
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
  taoProps?: TaoProps
}): React.JSX.Element | null {
  return Views.Pressable(
    {
      // Styled as the stack header's Back is, so the app's design and scheme reach its label.
      __tao: { ...props.taoProps, designDefault: 'NavigationChromeButton' },
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
const overlayBackdropColor = 'rgba(0, 0, 0, 0.45)'
const overlaySurfaceStyle = {
  backgroundColor: overlayBackdropColor,
  flex: 1,
  pointerEvents: 'box-none',
} as const

// An asked view is modal: it dims what it covers and sits centred over it, rather than rendering as
// another full-bleed layer on top of the content it is supposed to interrupt. The scrim is the
// background and stays full-bleed; its padding is what keeps the centred card off the notch and the
// home indicator, so it grows by the live safe-area insets on top of its fixed minimum.
const askScrimBaseStyle = {
  alignItems: 'center',
  backgroundColor: overlayBackdropColor,
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

/** What a native sheet hosts: the rendered entries presented while it showed, how many, and whether one is modal. */
type SheetHosted = { hosted: React.ReactNode[] | null; hostedCount: number; hostedModal: boolean }

function modalSheet(
  content: React.ReactNode,
  navigation: TaoNavigationValue,
  taoProps: TaoProps | undefined,
  visible: boolean,
  // Only the inline (no-Modal) branch below uses this: it shares the app's own window, so it takes
  // the caller's insets. The native-Modal branch is its own window and reads its own (ModalSheetContent).
  inlineInsets: SafeAreaInsets,
  // Only the native-Modal branch hosts entries; an inline sheet has no window of its own to host them in.
  sheetHosted: SheetHosted,
): React.ReactNode {
  const runtime = requireReactNativeRuntime()
  const modal = (runtime as { Modal?: React.ComponentType<any> }).Modal
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
            catalystPalette(taoProps?.scheme),
            sheetInlineSurfaceInsetStyle(inlineInsets),
            mountedDesignStyle(taoProps, 'ModalSurface'),
          ],
        },
        content,
      ),
    )
  }
  return createElement(NativeSheetModal, { content, modal, navigation, sheetHosted, taoProps, visible })
}

/** A covered sheet cannot surrender the native window that owns its overlay and ask followers. */
function NativeSheetModal(props: {
  content: React.ReactNode
  modal: React.ComponentType<any>
  navigation: TaoNavigationValue
  sheetHosted: SheetHosted
  taoProps: TaoProps | undefined
  visible: boolean
}): React.JSX.Element {
  const canDismiss = props.visible && props.sheetHosted.hostedCount === 0
    && props.taoProps?.navigationHostActive !== false
  const dismissal = React.useRef({ allowed: canDismiss, epoch: 0, mounted: true }).current
  React.useEffect(() => {
    dismissal.mounted = true
    return () => {
      dismissal.mounted = false
    }
  }, [dismissal])
  if (dismissal.allowed !== canDismiss) {
    dismissal.allowed = canDismiss
    dismissal.epoch += 1
  }
  const epoch = dismissal.epoch
  return createElement(
    props.modal,
    {
      allowSwipeDismissal: canDismiss,
      animationType: 'slide',
      onRequestClose: () => {
        if (!dismissal.mounted) {
          return
        }
        if (requireReactNativeRuntime().Platform?.OS === 'android') {
          // Android asks JS to handle Back; the native window is still present. Remove only the
          // current top layer so an overlay or ask consumes Back before its hosting sheet.
          dismissOverlay(props.navigation, props.taoProps)
          return
        }
        // iOS reports a completed swipe. A callback captured before coverage stays stale even
        // after that coverage ends, and cannot remove a newer presentation.
        if (canDismiss && dismissal.allowed && dismissal.epoch === epoch) {
          dismissOverlay(props.navigation, props.taoProps)
        }
      },
      presentationStyle: 'pageSheet',
      visible: props.visible,
    },
    createElement(ModalSheetSurface, {
      accessibilityProps: modalAccessibilityProps(props.navigation, props.taoProps, props.visible),
      children: props.content,
      sheetHosted: props.sheetHosted,
      taoProps: props.taoProps,
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
 * `AppSurfaceFrame` ever padded, regardless of what encloses the presenter that opened it. For the
 * same reason it keeps a window layer of its own: an ask asked from inside the sheet must dim the
 * sheet's window, and the root window's layer lies beneath a native Modal.
 */
function ModalSheetSurface(props: {
  accessibilityProps: Record<string, unknown>
  children: React.ReactNode
  sheetHosted: SheetHosted
  taoProps: TaoProps | undefined
}): React.ReactNode {
  const SafeAreaContext = requireSafeAreaContext()
  const [windowLayer] = React.useState(() => new WindowLayerRegistry())
  return createElement(
    AppSurfaceInsetContext.Provider,
    { value: false },
    createElement(
      WindowLayerProvider,
      { registry: windowLayer },
      createElement(
        SafeAreaContext.SafeAreaProvider,
        null,
        createElement(ModalSheetContent, { ...props, windowLayer }),
      ),
    ),
  )
}

function ModalSheetContent(props: {
  accessibilityProps: Record<string, unknown>
  children: React.ReactNode
  sheetHosted: SheetHosted
  taoProps: TaoProps | undefined
  windowLayer: WindowLayerRegistry
}): React.ReactNode {
  const runtime = requireReactNativeRuntime()
  const platformOS = runtime.Platform?.OS ?? 'web'
  // Reads the provider this component is itself nested in (see ModalSheetSurface above), which
  // measures the modal's own window rather than the app's.
  const insets = requireSafeAreaContext().useSafeAreaInsets()
  const { hosted, hostedModal } = props.sheetHosted
  // The sheet's own overlay lane and window layer sit inside the keyboard avoidance, so an entry
  // presented from the sheet clears the keyboard the way the sheet's own content does — and inside
  // the view that carries the modal accessibility props, since a screen reader ignores the siblings
  // of a modal view, and a hosted entry must not be one of them. The card hides from accessibility
  // beneath a hosted modal entry, exactly as a navigator's content does beneath its own.
  return createElement(
    runtime.KeyboardAvoidingView,
    { behavior: platformOS === 'ios' ? 'padding' : undefined, style: sheetModalKeyboardStyle },
    createElement(
      runtime.View,
      { ...props.accessibilityProps, style: sheetModalKeyboardStyle },
      createElement(
        runtime.View,
        {
          accessibilityElementsHidden: hostedModal,
          importantForAccessibility: hostedModal ? 'no-hide-descendants' : 'auto',
          style: [
            sheetModalSurfaceBaseStyle,
            catalystPalette(props.taoProps?.scheme),
            sheetModalSurfaceInsetStyle(insets),
            mountedDesignStyle(props.taoProps, 'ModalSurface'),
          ],
        },
        props.children,
      ),
      hosted === null ? null : createElement(runtime.View, { children: hosted, style: overlayLayerStyle }),
      createElement(WindowLayer, { registry: props.windowLayer }),
    ),
  )
}

const sheetModalKeyboardStyle = { flex: 1 } as const

/**
 * OverlayInsets hands an ask scrim or an inline sheet the live insets it must add. An inline sheet
 * draws in its navigator's overlay lane: a navigator that does not own its window renders inside an
 * AppSurfaceFrame, whose content is already padded by the live insets and whose lane sits inside
 * that same padded content, so there the sheet must not add them again, while a window-owning
 * navigator's lane is a sibling of its per-entry frames and fills the true window, so there it must.
 * An ask draws in the nearest window layer, which no frame encloses, so it always adds them — except
 * for a navigator rendered without any window layer, whose ask draws in the lane like the sheet. It
 * is a component so the reads stay out of NavigationSurface, which a plain overlay never needs them
 * for.
 */
function OverlayInsets(props: { children: (insets: SafeAreaInsets) => React.ReactNode }): React.ReactNode {
  const insets = requireSafeAreaContext().useSafeAreaInsets()
  return props.children(AppSurfaceInsetContext.use() ? zeroInsets : insets)
}

type NavigationSurfaceProps = {
  content?: React.ReactNode
  navigation: TaoNavigationValue
  overlays: OverlayEntry[]
  taoProps?: TaoProps
}

/** NavigationSurface gives every nav a relative host and its own absolute overlay lane. */
export function NavigationSurface(props: NavigationSurfaceProps): React.JSX.Element {
  const runtime = requireReactNativeRuntime()
  const contentHidden = props.overlays.some(modalOverlay)
  // An entry presented while a native sheet is showing is hosted by that sheet: it draws in the
  // sheet's window and the sheet stays up beneath it (decided 2026-09-22). Without a native modal
  // host a sheet is inline, and a later entry covers it as any overlay covers the one before.
  const hostsFollowers = (runtime as { Modal?: unknown }).Modal !== undefined
  const lane = renderOverlayLevel(overlayTree(props.overlays, hostsFollowers), true, props)
  const overlays = lane === null ? null : createElement(runtime.View, { children: lane, style: overlayLayerStyle })
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

/** One overlay entry and the entries a sheet hosts: everything presented while it was showing. */
type OverlayNode = { entry: OverlayEntry; hosted: OverlayNode[] }

function overlayTree(overlays: readonly OverlayEntry[], hostsFollowers: boolean): OverlayNode[] {
  const roots: OverlayNode[] = []
  let host: OverlayNode | undefined
  for (const entry of overlays) {
    const node: OverlayNode = { entry, hosted: [] } // Only an overlay or an ask nests inside the sheet that showed it. A sheet is never hosted:
     // presented from another sheet it replaces that sheet on screen, as any later entry did before,
    // and hosts what follows it — so no native Modal ever renders inside another.
    ;(entry.sheet || host === undefined ? roots : host.hosted).push(node)
    if (hostsFollowers && entry.sheet) {
      host = node
    }
  }
  return roots
}

function hostedEntryCount(node: OverlayNode): number {
  return node.hosted.reduce((count, hosted) => count + 1 + hostedEntryCount(hosted), 0)
}

/**
 * renderOverlayLevel renders the entries of one level, top-most last. An entry is visible when it is
 * the last of its level and the sheet hosting that level is itself visible; a sheet stays visible
 * while it hosts entries, since they draw inside its window rather than over it.
 */
function renderOverlayLevel(
  nodes: readonly OverlayNode[],
  hostVisible: boolean,
  props: NavigationSurfaceProps,
): React.ReactNode[] | null {
  if (nodes.length === 0) {
    return null
  }
  return nodes.map((node, index) => {
    const { entry } = node
    const visible = hostVisible && index === nodes.length - 1
    const content = entry.presentable.render(
      entry.arguments,
      entry.response
        ? askProps(props.taoProps, props.navigation, entry.response)
        : navigationProps(props.taoProps, props.navigation),
    )
    const region = presentedOccurrenceRegion(
      props.navigation,
      entry,
      entry.response ? 'ask' : entry.sheet ? 'sheet' : 'overlay',
    )
    const hosted = renderOverlayLevel(node.hosted, visible, props)
    const hostedModal = node.hosted.some(hostedNode => modalOverlay(hostedNode.entry))
    const hostedCount = hostedEntryCount(node)
    const level = (hidden: boolean) =>
      createElement(NavigationLevel, {
        children: entry.response
          ? createElement(OverlayInsets, {
            children: insets => modalAsk(content, props.navigation, props.taoProps, visible, insets),
          })
          : entry.sheet
          ? createElement(OverlayInsets, {
            children: insets =>
              modalSheet(content, props.navigation, props.taoProps, visible, insets, {
                hosted,
                hostedCount,
                hostedModal,
              }),
          })
          : createElement(requireReactNativeRuntime().View, { style: overlaySurfaceStyle }, content),
        fill: true,
        hidden,
        key: entry.instanceId,
        region,
      })
    // An ask dims the whole window it is shown in, not the padded content box its navigator may be
    // drawing inside, so it goes through the nearest window layer. A sheet is a window of its own,
    // and a plain overlay stays where its navigator draws it, full-bleed within that lane (Decisions
    // §10).
    return entry.response
      ? createElement(WindowAsk, { hidden: !visible, key: entry.instanceId, level })
      : level(!visible)
  })
}

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
        style: [askSurfaceStyle, catalystPalette(taoProps?.scheme), mountedDesignStyle(taoProps, 'ModalSurface')],
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
