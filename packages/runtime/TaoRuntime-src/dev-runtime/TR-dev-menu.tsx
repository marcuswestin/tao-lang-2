import React from 'react'
import { createElement } from '../TR-create-element'
import { requireReactNativeRuntime } from '../TR-react-native'
import { Dev } from './TR-dev'

type DevMenuPosition = {
  readonly bottom: number
  readonly right: number
}

type DevMenuDragStart = DevMenuPosition & {
  readonly pageX: number
  readonly pageY: number
}

type DevMenuWindowFrame = {
  readonly height?: number
  readonly width?: number
}

const menuButtonSize = 30
const minMenuInset = 8

const defaultMenuPosition: DevMenuPosition = {
  bottom: 16,
  right: 16,
}

const menuButtonStyle = {
  alignItems: 'center',
  backgroundColor: '#111827',
  borderRadius: menuButtonSize / 2,
  bottom: defaultMenuPosition.bottom,
  elevation: 10000,
  height: menuButtonSize,
  justifyContent: 'center',
  paddingHorizontal: 0,
  paddingVertical: 0,
  position: 'absolute',
  right: defaultMenuPosition.right,
  width: menuButtonSize,
  zIndex: 10000,
} as const

const menuButtonTextStyle = {
  color: '#f9fafb',
  fontSize: 19,
  fontWeight: '900',
  lineHeight: 22,
} as const

const overlayStyle = {
  alignItems: 'center',
  backgroundColor: 'rgba(17, 24, 39, 0.42)',
  bottom: 0,
  elevation: 9998,
  justifyContent: 'center',
  left: 0,
  position: 'absolute',
  right: 0,
  top: 0,
  zIndex: 9998,
} as const

const overlayPanelStyle = {
  alignItems: 'stretch',
  backgroundColor: '#111827',
  borderRadius: 8,
  gap: 10,
  minWidth: 220,
  padding: 14,
} as const

const overlayTitleStyle = {
  color: '#f9fafb',
  fontSize: 15,
  fontWeight: '700',
  textAlign: 'center',
} as const

const toggleBaseStyle = {
  alignItems: 'center',
  borderRadius: 6,
  minHeight: 40,
  justifyContent: 'center',
  paddingHorizontal: 12,
  paddingVertical: 8,
} as const

const toggleOffStyle = {
  backgroundColor: '#374151',
} as const

const toggleOnStyle = {
  backgroundColor: '#047857',
} as const

const toggleTextStyle = {
  color: '#f9fafb',
  fontSize: 14,
  fontWeight: '700',
} as const

/** DevMenu renders the draggable Tao development menu and its option overlay. */
export function DevMenu(): React.JSX.Element | null {
  const RN = requireReactNativeRuntime()
  const mode = Dev.useMode()
  const [overlayOpen, setOverlayOpen] = React.useState(false)
  const [position, setPosition] = React.useState(defaultMenuPosition)
  const dragStart = React.useRef<DevMenuDragStart | undefined>(undefined)

  if (!mode.enabled) {
    return null
  }

  const menuButton = createElement(
    RN.Pressable,
    {
      accessibilityLabel: 'Tao dev menu',
      accessibilityRole: 'button',
      onPress: () => setOverlayOpen(open => !open),
      onTouchMove: (event: any) => {
        const start = dragStart.current
        if (!start) {
          return
        }
        const pageX = Number(event.nativeEvent.pageX)
        const pageY = Number(event.nativeEvent.pageY)
        const frame = RN.Dimensions?.get('window')
        setPosition(clampMenuPosition({
          bottom: Math.max(minMenuInset, start.bottom - (pageY - start.pageY)),
          right: Math.max(minMenuInset, start.right - (pageX - start.pageX)),
        }, frame))
      },
      onTouchStart: (event: any) => {
        dragStart.current = {
          bottom: position.bottom,
          pageX: Number(event.nativeEvent.pageX),
          pageY: Number(event.nativeEvent.pageY),
          right: position.right,
        }
      },
      style: [menuButtonStyle, position],
    },
    createElement(RN.Text, { style: menuButtonTextStyle }, 'Τ'),
  )

  if (!overlayOpen) {
    return menuButton
  }

  return createElement(
    React.Fragment,
    null,
    createElement(
      RN.Pressable,
      {
        accessibilityLabel: 'Tao dev overlay',
        onPress: () => setOverlayOpen(false),
        style: overlayStyle,
      },
      createElement(
        RN.Pressable,
        {
          onPress: (event: any) => event?.stopPropagation?.(),
          style: overlayPanelStyle,
        },
        createElement(RN.Text, { style: overlayTitleStyle }, 'Tao Dev'),
        createElement(
          RN.Pressable,
          {
            accessibilityLabel: 'Toggle layout bounds',
            accessibilityRole: 'button',
            onPress: (event: any) => {
              event?.stopPropagation?.()
              Dev.toggleLayoutBounds()
            },
            style: [toggleBaseStyle, mode.layoutBounds ? toggleOnStyle : toggleOffStyle],
          },
          createElement(RN.Text, { style: toggleTextStyle }, `Layout bounds ${mode.layoutBounds ? 'On' : 'Off'}`),
        ),
      ),
    ),
    menuButton,
  )
}

function clampMenuPosition(position: DevMenuPosition, frame: DevMenuWindowFrame | undefined): DevMenuPosition {
  return {
    bottom: clampMenuInset(position.bottom, frame?.height),
    right: clampMenuInset(position.right, frame?.width),
  }
}

function clampMenuInset(value: number, availableSize: number | undefined): number {
  const lowerBound = minMenuInset
  const maxInset = typeof availableSize === 'number' && Number.isFinite(availableSize)
    ? Math.max(lowerBound, availableSize - menuButtonSize - minMenuInset)
    : undefined
  const lowerClamped = Math.max(lowerBound, value)
  return maxInset === undefined ? lowerClamped : Math.min(lowerClamped, maxInset)
}
