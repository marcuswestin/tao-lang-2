import React from 'react'
import { focusAccessibilityHost, type TaoAccessibilityHost } from './TR-accessibility'
import { AppSurfaceFrame } from './TR-app-shell'
import { createElement } from './TR-create-element'
import { InteractionControls } from './TR-interaction-catalog'
import {
  type TaoInteractionOccurrence,
  type TaoOutlineLiveEntry,
  useOutlineNode,
} from './TR-interaction-outline'
import { OutlineRegionScope } from './TR-interaction-regions'
import {
  BasicStackSurface,
  directToolbarCapacity,
} from './TR-navigation-basic-stack'
import { NavigationCommandButton } from './TR-navigation-command-button'
import {
  type RuntimeHostReadChannel,
  type TaoNavigationCommand,
  useEnclosingChrome,
  useHostSlotSnapshot,
} from './TR-navigation-host-slots'
import type { RuntimeStackNav } from './TR-navigation-mounts'
import { nativeNavigationFallback, nativeNavigationModule, nativeNavigationMounted } from './TR-navigation-native-hosts'
import { useNativeHeaderToolbar } from './TR-navigation-native-toolbar'
import type { PresentableEntry } from './TR-navigation-state'
import { presentedOccurrenceRegion } from './TR-navigation-surfaces'
import { isNavigation, renderPresentable } from './TR-navigation-values'
import { requireReactNativeRuntime } from './TR-react-native'
import { catalystPalette, SchemeControls } from './TR-scheme'
import type { TaoProps } from './TR-TaoProps'

type HostEntry = PresentableEntry & { host: RuntimeHostReadChannel }

export function nativeStackAvailable(): boolean {
  const module = nativeNavigationModule()
  const available = Boolean(module?.ScreenStack && module.ScreenStackItem)
  if (module && !available) {
    nativeNavigationFallback('stack', 'api-mismatch')
  }
  return available
}

/** NativeStackSurface delegates only presentation chrome and gestures to react-native-screens. */
export function NativeStackSurface(props: {
  bottomInset?: number
  chrome?: RuntimeHostReadChannel
  entries: readonly HostEntry[]
  navigation: RuntimeStackNav
  taoProps?: TaoProps
}): React.ReactNode {
  const module = nativeNavigationModule()
  React.useEffect(() => {
    if (module?.ScreenStack && module.ScreenStackItem) {
      nativeNavigationMounted('stack')
    } else if (module) {
      nativeNavigationFallback('stack', 'api-mismatch')
    }
  }, [module])
  if (!module?.ScreenStack || !module.ScreenStackItem) {
    return createElement(BasicStackSurface, props)
  }
  const ScreenStack = module.ScreenStack
  return createElement(
    ScreenStack,
    { style: stackSurfaceStyle },
    props.entries.map((entry, index) =>
      createElement(NativeStackItem, {
        active: index === props.entries.length - 1,
        bottomInset: props.bottomInset,
        chrome: props.chrome,
        entry,
        key: entry.instanceId,
        navigation: props.navigation,
        taoProps: props.taoProps,
      })
    ),
  )
}

function NativeStackItem(props: {
  active: boolean
  bottomInset?: number
  chrome?: RuntimeHostReadChannel
  entry: HostEntry
  navigation: RuntimeStackNav
  taoProps?: TaoProps
}): React.JSX.Element {
  const observable = props.active && props.taoProps?.navigationHostActive !== false
  return createElement(
    OutlineRegionScope,
    { region: presentedOccurrenceRegion(props.navigation, props.entry, 'content', () => observable) },
    createElement(NativeStackItemContent, { ...props, observable }),
  ) as React.JSX.Element
}

function NativeStackItemContent(props: {
  active: boolean
  bottomInset?: number
  chrome?: RuntimeHostReadChannel
  entry: HostEntry
  navigation: RuntimeStackNav
  observable: boolean
  taoProps?: TaoProps
}): React.JSX.Element {
  const module = nativeNavigationModule()!
  const slots = useHostSlotSnapshot(props.entry.host)
  useEnclosingChrome(props.chrome, slots, props.observable && !isNavigation(props.entry.presentable))
  // Enclosing chrome draws this screen's title, toolbar, and Back, so the native header stays hidden;
  // the edge-swipe gesture is the screen's own and still pops.
  const header = slots.header && !props.chrome
  const ScreenStackItem = module.ScreenStackItem!
  const Right = module.ScreenStackHeaderRightView
  const Center = module.ScreenStackHeaderCenterView
  const runtime = requireReactNativeRuntime()
  const ios = runtime.Platform?.OS === 'ios'
  const catalyst = ios && (runtime.Platform as { isMacCatalyst?: boolean })?.isMacCatalyst === true
  const ipad = ios && !catalyst && (runtime.Platform as { isPad?: boolean })?.isPad === true
  const titleView = ipad && Center && header && slots.title
    ? createElement(
      Center,
      null,
      createElement(runtime.Text, {
        accessibilityRole: 'header',
        numberOfLines: 1,
        style: { color: runtime.PlatformColor?.('label'), fontSize: 17, fontWeight: '600' },
      }, slots.title),
    )
    : null
  const androidHeader = runtime.Platform?.OS === 'android' && runtime.PlatformColor
    ? {
      backgroundColor: runtime.PlatformColor('?android:attr/colorBackground'),
      color: runtime.PlatformColor('?android:attr/colorForeground'),
      titleColor: runtime.PlatformColor('?android:attr/colorForeground'),
    }
    : undefined
  const toolbar = useNativeHeaderToolbar(ios && header && props.observable ? slots.toolbar : [])
  const entryTaoProps = { ...props.taoProps, navigationHostActive: props.observable }
  const backCapabilities = React.useRef<TaoOutlineLiveEntry>({}).current
  const backIdentity = useOutlineNode(
    props.observable && header && props.navigation.depth > 1
      ? {
        identity: `navigation:${props.navigation.name}:native-back`,
        kind: 'action',
        label: () => 'Back',
        live: backCapabilities,
        provenance: { navigation: props.navigation.name },
      }
      : undefined,
  )
  const backOccurrence: TaoInteractionOccurrence | undefined = backIdentity === undefined
    ? undefined
    : { capabilities: backCapabilities, control: backIdentity, scope: backIdentity }
  const activateBack = InteractionControls.Activate(backOccurrence, () => props.navigation.back())
  // An entry that is itself a window-owning navigator already frames its own screens (see
  // `RuntimeSelectionNav.itemEntryLevels`); wrapping it in another AppSurfaceFrame here would inset
  // its content twice.
  const contentOwnsWindow = isNavigation(props.entry.presentable) && props.entry.presentable.ownsWindowSurface()
  // A nested stack reads its own bottom clearance and enclosing chrome from these same props (see
  // `RuntimeStackNav.renderContent`), which `entryTaoProps` above does not carry — re-inject them,
  // exactly as `itemEntryLevels` does for a toggle bar's own nested stack.
  const nestedStack = isNavigation(props.entry.presentable) && props.entry.presentable.kind === 'stack'
  const contentTaoProps = nestedStack
    ? { ...entryTaoProps, navigationBottomInset: props.bottomInset, navigationChrome: props.chrome }
    : entryTaoProps
  const content = renderPresentable(props.entry.presentable, props.entry.arguments, contentTaoProps, props.entry.host)
  return createElement(
    ScreenStackItem,
    {
      // ScreenStack owns native coverage. ScreenStackItem forbids decreasing a native-stack
      // screen from activityState 2 to 1 during push, so every retained item stays active here.
      activityState: 2,
      children: createElement(
        React.Fragment,
        null,
        toolbar.outline,
        contentOwnsWindow
          ? content
          : createElement(
            AppSurfaceFrame,
            { bottomInset: props.bottomInset, nativeInsets: true, taoProps: entryTaoProps },
            content,
          ),
      ),
      gestureEnabled: props.observable,
      // The native stack checks every removed screen during a multi-pop, including retained
      // inactive entries. Only attention outside the entire stack should veto that transition.
      preventNativeDismiss: props.taoProps?.navigationHostActive === false,
      headerConfig: {
        ...androidHeader,
        children: !ios && Right && header && props.observable && slots.toolbar.length > 0
          ? createElement(Right, null, createElement(NativeToolbar, { commands: slots.toolbar, nativeHeader: true }))
          : titleView,
        headerRightBarButtonItems: ios ? toolbar.items : undefined,
        hidden: !header,
        hideBackButton: !header || !props.observable,
        title: header ? slots.title ?? '' : '',
      },
      onDismissed: (event: { nativeEvent?: { dismissCount?: number } }) => {
        if (!props.observable) {
          return
        }
        const count = Math.max(1, event.nativeEvent?.dismissCount ?? 1)
        props.navigation.reconcileNativeDismissal(props.entry.instanceId, count)
      },
      // iOS reports the completed native pop through onDismissed. Android asks JS to pop.
      onHeaderBackButtonClicked: ios || !props.observable ? undefined : activateBack,
      screenId: String(props.entry.instanceId),
      shouldFreeze: false,
      stackPresentation: 'push',
      style: catalyst ? catalystStackItemStyle : undefined,
    },
  )
}

export function NativeToolbar(
  props: { commands: readonly TaoNavigationCommand[]; nativeHeader?: boolean },
): React.JSX.Element {
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
  const direct = props.commands.slice(0, directToolbarCapacity)
  const overflow = props.commands.slice(directToolbarCapacity)
  const closeOverflow = () => {
    restoreOverflowFocus.current = true
    setExpanded(false)
  }
  const toggleOverflow = () => expanded ? closeOverflow() : setExpanded(true)
  return createElement(
    props.nativeHeader ? runtime.View : React.Fragment,
    props.nativeHeader ? { style: { alignItems: 'center', flexDirection: 'row', gap: 4 } } : null,
    ...direct.map(command =>
      createElement(NavigationCommandButton, {
        command,
        iconOnly: props.nativeHeader,
        key: command.identity,
        nativeHeader: props.nativeHeader,
      })
    ),
    overflow.length > 0
      ? createElement(NavigationCommandButton, {
        accessibilityState: { expanded },
        command: {
          enabled: true,
          identity: 'navigation:toolbar:more',
          ...(props.nativeHeader ? { icon: 'ellipsis' } : {}),
          label: 'More',
          invoke: toggleOverflow,
        },
        hostRef: moreHost,
        iconOnly: props.nativeHeader,
        key: 'more',
        nativeHeader: props.nativeHeader,
        outlineIdentity: 'navigation:toolbar:more',
      })
      : null,
    expanded && overflow.length > 0
      ? createElement(NativeOverflowMenu, {
        commands: overflow,
        key: 'overflow',
        onClose: closeOverflow,
      })
      : null,
  )
}

function NativeOverflowMenu(props: {
  commands: readonly TaoNavigationCommand[]
  onClose(): void
}): React.JSX.Element {
  const runtime = requireReactNativeRuntime()
  const scheme = SchemeControls.use()
  const firstHost = React.useRef<TaoAccessibilityHost | null>(null)
  React.useEffect(() => focusAccessibilityHost(runtime, firstHost.current), [runtime])
  const content = createElement(
    runtime.View,
    {
      accessibilityRole: 'menu',
      accessibilityViewIsModal: true,
      onAccessibilityEscape: props.onClose,
      style: [nativeMenuStyle, catalystPalette(scheme.resolved)],
    },
    ...props.commands.map(command =>
      createElement(NavigationCommandButton, {
        command,
        hostRef: command === props.commands[0] ? firstHost : undefined,
        key: command.identity,
        onInvoke: props.onClose,
        role: 'menuitem',
      })
    ),
  )
  if (!runtime.Modal) {
    return content
  }
  return createElement(
    runtime.Modal,
    { animationType: 'fade', onRequestClose: props.onClose, transparent: true, visible: true },
    createElement(
      runtime.View,
      { style: nativeMenuPortalStyle },
      createElement(runtime.Pressable, {
        accessibilityLabel: 'Dismiss command menu',
        accessibilityRole: 'button',
        onPress: props.onClose,
        style: nativeMenuBackdropStyle,
      }),
      content,
    ),
  )
}

/** ScreenStack lays its screens out inside its own bounds, so it must be told to fill its parent. */
const stackSurfaceStyle = { flex: 1 } as const

// UIKit overlays retained screens. Their Catalyst shadow layout must do the same so
// Pressability measures a pushed control at its visible origin, not below prior screens.
const catalystStackItemStyle = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } as const

const nativeMenuBackdropStyle = { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 } as const
const nativeMenuPortalStyle = { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 } as const
const nativeMenuStyle = {
  backgroundColor: '#ffffff',
  borderRadius: 10,
  elevation: 8,
  padding: 8,
  position: 'absolute',
  right: 12,
  top: 56,
} as const
