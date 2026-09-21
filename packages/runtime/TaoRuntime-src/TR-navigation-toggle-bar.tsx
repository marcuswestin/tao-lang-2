import React from 'react'
import { focusAccessibilityHost, type TaoAccessibilityHost } from './TR-accessibility'
import { requireSafeAreaContext } from './TR-app-shell'
import { createElement } from './TR-create-element'
import { warnContainedFailure } from './TR-errors'
import { directToolbarCapacity, navigationCommandTestId, navigationTitleTestId } from './TR-navigation-basic-stack'
import { NavigationCommandButton } from './TR-navigation-command-button'
import {
  type RuntimeHostReadChannel,
  type TaoNavigationCommand,
  useHostSlotSnapshot,
} from './TR-navigation-host-slots'
import { requireReactNativeRuntime } from './TR-react-native'
import type { TaoProps } from './TR-TaoProps'

/**
 * The `Display "toggle"` selection surface: one compact bar floating over the bottom edge, in the
 * shape Safari uses on iPhone. Back sits on the left, the visible screen's title and toolbar share a
 * pill in the middle, and the right control switches to the next item — with two items, a tap
 * alternates. There is no top bar: a stack inside an item hands its header here instead
 * (`TaoProps.navigationChrome`), so the title, the toolbar, and Back each appear exactly once.
 *
 * On iOS 26 the three surfaces are the platform's Liquid Glass (`expo-glass-effect`, a
 * UIGlassEffect view). Everywhere the effect is absent — earlier iOS, Android, web, checks — the
 * same layout renders on a translucent material, so behavior never depends on the effect.
 */

/** The bar's own height, excluding the safe-area inset beneath it. */
const barHeight = 48
const barGap = 8
const barMargin = 12

/** toggleBarContentInset is how far content must scroll to clear the floating bar. */
export function toggleBarContentInset(): number {
  return barHeight + barGap * 2
}

/** TaoToggleBarItem is the selection item the right-hand control switches to. */
export type TaoToggleBarItem = Readonly<{
  icon?: string
  key: string
  label: string
}>

export function SelectionToggleBar(props: {
  back(): void
  canGoBack: boolean
  /** chrome carries the active item's visible screen: its title, toolbar, and whether it has a bar. */
  chrome: RuntimeHostReadChannel
  /** fallbackTitle names the active item when its screen publishes no title of its own. */
  fallbackTitle: string
  name: string
  native: boolean
  next?: TaoToggleBarItem
  observable: boolean
  select(key: string): void
  taoProps?: TaoProps
}): React.JSX.Element {
  const runtime = requireReactNativeRuntime()
  const insets = requireSafeAreaContext().useSafeAreaInsets()
  const slots = useHostSlotSnapshot(props.chrome)
  const dark = props.taoProps?.scheme === 'dark'
  const glass = props.native ? liquidGlass() : undefined
  const title = slots.header ? slots.title ?? props.fallbackTitle : props.fallbackTitle
  const toolbar = slots.header ? slots.toolbar : []
  const back: TaoNavigationCommand = {
    enabled: props.observable && props.canGoBack,
    icon: 'chevron.left',
    identity: `navigation:${props.name}:back`,
    invoke: () => props.back(),
    label: 'Back',
  }
  const next = props.next
  return createElement(runtime.View, {
    accessibilityRole: 'toolbar',
    children: [
      createElement(
        BarMaterial,
        { dark, glass, key: 'back', shape: circleShape },
        createElement(NavigationCommandButton, {
          command: back,
          iconOnly: true,
          outlineIdentity: `navigation:${props.name}:back`,
          taoProps: props.taoProps,
        }),
      ),
      createElement(
        BarMaterial,
        { dark, glass, key: 'title', shape: pillShape },
        createElement(runtime.Text, {
          accessibilityRole: 'header',
          children: title,
          key: 'title',
          numberOfLines: 1,
          style: [titleStyle, { color: dark ? '#f2f2f7' : '#1c1c1e' }],
          testID: props.observable ? navigationTitleTestId : undefined,
        }),
        createElement(BarToolbar, {
          commands: toolbar,
          key: 'toolbar',
          observable: props.observable,
          taoProps: props.taoProps,
        }),
      ),
      next === undefined ? null : createElement(
        BarMaterial,
        { dark, glass, key: 'toggle', shape: togglePillShape },
        createElement(NavigationCommandButton, {
          command: {
            enabled: props.observable,
            ...(next.icon ? { icon: next.icon } : {}),
            identity: `navigation:${props.name}:selection:${next.key}`,
            invoke: () => props.select(next.key),
            label: next.label,
          },
          outlineIdentity: `navigation:${props.name}:selection:${next.key}`,
          taoProps: props.taoProps,
        }),
      ),
    ],
    pointerEvents: 'box-none',
    style: [barStyle, { bottom: insets.bottom + barGap }],
  })
}

/** BarToolbar keeps two commands direct and moves the ordered remainder behind More. */
function BarToolbar(props: {
  commands: readonly TaoNavigationCommand[]
  observable: boolean
  taoProps?: TaoProps
}): React.JSX.Element | null {
  const [expanded, setExpanded] = React.useState(false)
  const runtime = requireReactNativeRuntime()
  const moreHost = React.useRef<TaoAccessibilityHost | null>(null)
  const restoreOverflowFocus = React.useRef(false)
  React.useEffect(() => {
    if (expanded || !restoreOverflowFocus.current) {
      return
    }
    restoreOverflowFocus.current = false
    focusAccessibilityHost(runtime, moreHost.current)
  }, [expanded, runtime])
  if (props.commands.length === 0) {
    return null
  }
  const focused = (command: TaoNavigationCommand) => props.observable ? command : { ...command, enabled: false }
  const direct = props.commands.slice(0, directToolbarCapacity)
  const overflow = props.commands.slice(directToolbarCapacity)
  const close = () => {
    restoreOverflowFocus.current = true
    setExpanded(false)
  }
  return createElement(runtime.View, {
    children: [
      ...direct.map(command =>
        createElement(NavigationCommandButton, {
          command: focused(command),
          iconOnly: true,
          key: command.identity,
          taoProps: props.taoProps,
          testID: props.observable ? navigationCommandTestId(command.label) : undefined,
        })
      ),
      overflow.length === 0 ? null : createElement(NavigationCommandButton, {
        accessibilityState: { expanded },
        command: {
          enabled: props.observable,
          icon: 'ellipsis',
          identity: 'navigation:toolbar:more',
          invoke: () => expanded ? close() : setExpanded(true),
          label: 'More',
        },
        hostRef: moreHost,
        iconOnly: true,
        key: 'more',
        outlineIdentity: 'navigation:toolbar:more',
        taoProps: props.taoProps,
      }),
      expanded && overflow.length > 0
        ? createElement(BarOverflowMenu, {
          commands: overflow.map(focused),
          key: 'overflow',
          observable: props.observable,
          onClose: close,
          taoProps: props.taoProps,
        })
        : null,
    ],
    style: toolbarStyle,
  })
}

function BarOverflowMenu(props: {
  commands: readonly TaoNavigationCommand[]
  observable: boolean
  onClose(): void
  taoProps?: TaoProps
}): React.JSX.Element {
  const runtime = requireReactNativeRuntime()
  const firstHost = React.useRef<TaoAccessibilityHost | null>(null)
  React.useEffect(() => focusAccessibilityHost(runtime, firstHost.current), [runtime])
  const menu = createElement(runtime.View, {
    accessibilityRole: 'menu',
    accessibilityViewIsModal: true,
    children: props.commands.map(command =>
      createElement(NavigationCommandButton, {
        command,
        hostRef: command === props.commands[0] ? firstHost : undefined,
        key: command.identity,
        onInvoke: props.onClose,
        role: 'menuitem',
        taoProps: props.taoProps,
        testID: props.observable ? navigationCommandTestId(command.label) : undefined,
      })
    ),
    onAccessibilityEscape: props.onClose,
    style: overflowMenuStyle,
  })
  if (!runtime.Modal) {
    return menu
  }
  return createElement(
    runtime.Modal,
    { animationType: 'fade', onRequestClose: props.onClose, transparent: true, visible: true },
    createElement(
      runtime.View,
      { style: fillStyle },
      createElement(runtime.Pressable, {
        accessibilityLabel: 'Dismiss command menu',
        accessibilityRole: 'button',
        onPress: props.onClose,
        style: fillStyle,
      }),
      menu,
    ),
  )
}

/** BarMaterial is one floating surface: Liquid Glass where the platform has it, else translucency. */
function BarMaterial(props: {
  children?: React.ReactNode
  dark: boolean
  glass?: LiquidGlassModule
  shape: Readonly<Record<string, unknown>>
}): React.JSX.Element {
  const runtime = requireReactNativeRuntime()
  if (props.glass) {
    return createElement(props.glass.GlassView, {
      children: props.children,
      colorScheme: props.dark ? 'dark' : 'light',
      glassEffectStyle: 'regular',
      isInteractive: true,
      style: props.shape,
    })
  }
  return createElement(runtime.View, {
    children: props.children,
    style: [props.shape, props.dark ? darkMaterialStyle : lightMaterialStyle],
  })
}

/** LiquidGlassModule is the supported subset of `expo-glass-effect`; no vendor type escapes this file. */
type LiquidGlassModule = Readonly<{
  GlassView: React.ComponentType<any>
  isGlassEffectAPIAvailable?: () => boolean
  isLiquidGlassAvailable?: () => boolean
}>

let cachedGlass: LiquidGlassModule | null | undefined

/**
 * liquidGlass returns the glass module only where the effect will actually draw. The package falls
 * back to a plain view by itself, but that fallback has no fill, so asking first keeps the
 * translucent material in place instead of an invisible surface.
 */
function liquidGlass(): LiquidGlassModule | undefined {
  if (cachedGlass === undefined) {
    cachedGlass = requireReactNativeRuntime().Platform?.OS === 'ios' ? loadLiquidGlass() : null
  }
  return cachedGlass ?? undefined
}

function loadLiquidGlass(): LiquidGlassModule | null {
  try {
    const module = require('expo-glass-effect') as Partial<LiquidGlassModule>
    if (!module.GlassView) {
      return null
    }
    const available = module.isLiquidGlassAvailable?.() !== false && module.isGlassEffectAPIAvailable?.() !== false
    return available ? module as LiquidGlassModule : null
  } catch (error) {
    warnContainedFailure('Liquid Glass is unavailable; the toggle bar uses its translucent material.', error)
    return null
  }
}

/** overrideLiquidGlassForTest exercises the glass adapter without the native module. */
export function overrideLiquidGlassForTest(module: LiquidGlassModule | null): () => void {
  const previous = cachedGlass
  cachedGlass = module
  return () => {
    cachedGlass = previous
  }
}

const barStyle = {
  alignItems: 'center',
  flexDirection: 'row',
  gap: barGap,
  height: barHeight,
  left: barMargin,
  position: 'absolute',
  right: barMargin,
} as const
const circleShape = {
  alignItems: 'center',
  borderRadius: barHeight / 2,
  height: barHeight,
  justifyContent: 'center',
  overflow: 'hidden',
  width: barHeight,
} as const
const pillShape = {
  alignItems: 'center',
  borderRadius: barHeight / 2,
  flex: 1,
  flexDirection: 'row',
  height: barHeight,
  overflow: 'hidden',
  paddingHorizontal: 16,
} as const
const togglePillShape = {
  alignItems: 'center',
  borderRadius: barHeight / 2,
  height: barHeight,
  justifyContent: 'center',
  overflow: 'hidden',
  paddingHorizontal: 14,
} as const
const lightMaterialStyle = {
  backgroundColor: 'rgba(250, 250, 252, 0.92)',
  borderColor: 'rgba(0, 0, 0, 0.08)',
  borderWidth: 0.5,
  elevation: 6,
  shadowColor: '#000000',
  shadowOffset: { height: 6, width: 0 },
  shadowOpacity: 0.12,
  shadowRadius: 14,
} as const
const darkMaterialStyle = {
  ...lightMaterialStyle,
  backgroundColor: 'rgba(44, 44, 46, 0.92)',
  borderColor: 'rgba(255, 255, 255, 0.12)',
} as const
const titleStyle = { flex: 1, fontSize: 15, fontWeight: '600', textAlign: 'center' } as const
const toolbarStyle = { alignItems: 'center', flexDirection: 'row', gap: 4 } as const
const fillStyle = { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 } as const
const overflowMenuStyle = {
  backgroundColor: '#ffffff',
  borderRadius: 14,
  bottom: barHeight + barGap * 4,
  elevation: 8,
  padding: 8,
  position: 'absolute',
  right: barMargin,
} as const
