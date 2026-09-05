import React from 'react'
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
  return React.createElement(
    OutlineRegionScope,
    { region },
    React.createElement(runtime.View, {
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

// An asked view is modal: it dims what it covers and sits centred over it, rather than rendering as
// another full-bleed layer on top of the content it is supposed to interrupt.
const askScrimStyle = {
  alignItems: 'center',
  backgroundColor: 'rgba(0, 0, 0, 0.45)',
  bottom: 0,
  justifyContent: 'center',
  left: 0,
  padding: 24,
  position: 'absolute',
  right: 0,
  top: 0,
} as const

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

const sheetInlineSurfaceStyle = {
  backgroundColor: '#ffffff',
  borderTopLeftRadius: 16,
  borderTopRightRadius: 16,
  maxHeight: '90%',
  padding: 20,
} as const

const sheetModalSurfaceStyle = {
  backgroundColor: '#ffffff',
  flex: 1,
  padding: 20,
} as const

function modalSheet(
  content: React.ReactNode,
  navigation: TaoNavigationValue,
  taoProps: TaoProps | undefined,
  visible: boolean,
): React.ReactNode {
  const runtime = requireReactNativeRuntime()
  const modal = (runtime as { Modal?: React.ComponentType<any> }).Modal
  const dismiss = () => dismissOverlay(navigation, taoProps)
  if (!modal) {
    // Without a modal host the sheet renders inline; the enclosing level hides it when covered.
    return React.createElement(
      runtime.View,
      { style: sheetInlineScrimStyle },
      React.createElement(
        runtime.View,
        {
          ...modalAccessibilityProps(navigation, taoProps, visible),
          style: [sheetInlineSurfaceStyle, mountedDesignStyle(taoProps, 'ModalSurface')],
        },
        content,
      ),
    )
  }
  // The modal is a portal above the overlay lane, so covering it cannot rely on the enclosing
  // level: `visible` must track whether this entry is the top of the overlay stack. The native
  // presentation supplies the sheet card and dimming itself, and `pageSheet` rejects transparency.
  return React.createElement(
    modal,
    {
      allowSwipeDismissal: true,
      animationType: 'slide',
      onRequestClose: dismiss,
      presentationStyle: 'pageSheet',
      visible,
    },
    React.createElement(
      runtime.View,
      {
        ...modalAccessibilityProps(navigation, taoProps, visible),
        style: [sheetModalSurfaceStyle, mountedDesignStyle(taoProps, 'ModalSurface')],
      },
      content,
    ),
  )
}

/** NavigationSurface gives every nav a relative host and its own absolute overlay lane. */
export function NavigationSurface(props: {
  content?: React.ReactNode
  navigation: TaoNavigationValue
  overlays: OverlayEntry[]
  taoProps?: TaoProps
}): React.JSX.Element {
  const runtime = requireReactNativeRuntime()
  const contentHidden = props.overlays.some(modalOverlay)
  const overlays = props.overlays.length > 0
    ? React.createElement(runtime.View, {
      children: props.overlays.map((entry, index) => {
        const visible = index === props.overlays.length - 1
        const content = entry.presentable.render(
          entry.arguments,
          entry.response
            ? askProps(props.taoProps, props.navigation, entry.response)
            : navigationProps(props.taoProps, props.navigation),
        )
        return React.createElement(NavigationLevel, {
          children: entry.response
            ? modalAsk(content, props.navigation, props.taoProps, visible)
            : entry.sheet
            ? modalSheet(content, props.navigation, props.taoProps, visible)
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
  return React.createElement(
    runtime.View,
    {
      style: [
        navigationHostStyle,
        mountedDesignStyle(props.taoProps, 'NavigationHost'),
        pointerTransparentStyle,
      ],
    },
    React.createElement(runtime.View, {
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
): React.ReactNode {
  const runtime = requireReactNativeRuntime()
  return React.createElement(
    runtime.View,
    { style: askScrimStyle },
    React.createElement(
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
