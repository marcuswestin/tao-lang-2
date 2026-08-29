import React from 'react'
import type { TaoNavigationValue } from './TR-navigation'
import { backNavigation } from './TR-navigation-registry'
import type { DialogueOccurrenceState, OverlayEntry } from './TR-navigation-state'
import { requireReactNativeRuntime } from './TR-react-native'
import type { TaoProps } from './TR-TaoProps'
import { Views } from './TR-views'

/** NavigationLevel hides covered stack entries without unmounting their local React state. */
export function NavigationLevel(props: {
  children?: React.ReactNode
  fill?: boolean
  hidden: boolean
}): React.JSX.Element {
  const runtime = requireReactNativeRuntime()
  return React.createElement(runtime.View, {
    accessibilityElementsHidden: props.hidden,
    children: props.children,
    importantForAccessibility: props.hidden ? 'no-hide-descendants' : 'auto',
    style: props.hidden ? hiddenNavigationLevelStyle : props.fill ? visibleOverlayLevelStyle : undefined,
  })
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
      title: 'Back',
    },
    { nativeProps: { accessibilityLabel: 'Back', accessibilityRole: 'button' } },
  )
}

export const navigationHostStyle = { flex: 1, position: 'relative' } as const
const overlayLayerStyle = {
  bottom: 0,
  left: 0,
  position: 'absolute',
  right: 0,
  top: 0,
  zIndex: 1,
} as const
const hiddenNavigationLevelStyle = { display: 'none' } as const
const visibleOverlayLevelStyle = { flex: 1 } as const

// A dialogue is modal: it dims what it covers and sits centred over it, rather than rendering as
// another full-bleed layer on top of the content it is supposed to interrupt.
const dialogueScrimStyle = {
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

const dialogueSurfaceStyle = {
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
// platforms — a page sheet on iOS, a modal window on Android — and dragging it down or a system
// back press enters the same root-safe reducer every other dismissal does.
const sheetScrimStyle = {
  backgroundColor: 'rgba(0, 0, 0, 0.35)',
  flex: 1,
  justifyContent: 'flex-end',
} as const

const sheetSurfaceStyle = {
  backgroundColor: '#ffffff',
  borderTopLeftRadius: 16,
  borderTopRightRadius: 16,
  maxHeight: '90%',
  padding: 20,
} as const

function modalSheet(content: React.ReactNode, navigation: TaoNavigationValue): React.ReactNode {
  const runtime = requireReactNativeRuntime()
  const modal = (runtime as { Modal?: React.ComponentType<any> }).Modal
  const surface = React.createElement(
    runtime.View,
    { style: sheetScrimStyle },
    React.createElement(runtime.View, { style: sheetSurfaceStyle }, content),
  )
  if (!modal) {
    return surface
  }
  return React.createElement(
    modal,
    {
      animationType: 'slide',
      onRequestClose: () => {
        backNavigation(navigation)
      },
      presentationStyle: 'pageSheet',
      transparent: true,
      visible: true,
    },
    surface,
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
  const overlays = props.overlays.length > 0
    ? React.createElement(runtime.View, {
      children: props.overlays.map((entry, index) => {
        const content = entry.presentable.render(
          entry.arguments,
          entry.dialogue
            ? dialogueProps(props.taoProps, props.navigation, entry.dialogue)
            : navigationProps(props.taoProps, props.navigation),
        )
        return React.createElement(NavigationLevel, {
          children: entry.dialogue
            ? modalDialogue(content)
            : entry.sheet
            ? modalSheet(content, props.navigation)
            : content,
          fill: true,
          hidden: index !== props.overlays.length - 1,
          key: entry.instanceId,
        })
      }),
      pointerEvents: 'box-none',
      style: overlayLayerStyle,
    })
    : null
  return React.createElement(
    runtime.View,
    { pointerEvents: 'box-none', style: navigationHostStyle },
    props.content,
    overlays,
  )
}

/** modalDialogue centres one dialogue on a dimming scrim, which is what makes it read as modal. */
function modalDialogue(content: React.ReactNode): React.ReactNode {
  const runtime = requireReactNativeRuntime()
  return React.createElement(
    runtime.View,
    { style: dialogueScrimStyle },
    React.createElement(runtime.View, { style: dialogueSurfaceStyle }, content),
  )
}

export function navigationProps(props: TaoProps | undefined, navigation: TaoNavigationValue): TaoProps {
  return { ...props, navigation }
}

function dialogueProps(
  props: TaoProps | undefined,
  navigation: TaoNavigationValue,
  dialogue: DialogueOccurrenceState,
): TaoProps {
  return { ...props, dialogue, navigation }
}
