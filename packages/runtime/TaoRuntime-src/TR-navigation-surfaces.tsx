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
      children: props.overlays.map((entry, index) =>
        React.createElement(NavigationLevel, {
          children: entry.presentable.render(
            entry.arguments,
            entry.dialogue
              ? dialogueProps(props.taoProps, props.navigation, entry.dialogue)
              : navigationProps(props.taoProps, props.navigation),
          ),
          fill: true,
          hidden: index !== props.overlays.length - 1,
          key: entry.instanceId,
        })
      ),
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
