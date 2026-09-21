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
import { nativeNavigationModule } from './TR-navigation-native-hosts'
import type { PresentableEntry } from './TR-navigation-state'
import { presentedOccurrenceRegion } from './TR-navigation-surfaces'
import { isNavigation, renderPresentable } from './TR-navigation-values'
import { requireReactNativeRuntime } from './TR-react-native'
import type { TaoProps } from './TR-TaoProps'

type HostEntry = PresentableEntry & { host: RuntimeHostReadChannel }

export function nativeStackAvailable(): boolean {
  const module = nativeNavigationModule()
  return Boolean(module?.ScreenStack && module.ScreenStackItem)
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
  const content = renderPresentable(props.entry.presentable, props.entry.arguments, entryTaoProps, props.entry.host)
  return createElement(
    ScreenStackItem,
    {
      // ScreenStack owns native coverage. ScreenStackItem forbids decreasing a native-stack
      // screen from activityState 2 to 1 during push, so every retained item stays active here.
      activityState: 2,
      children: contentOwnsWindow
        ? content
        : createElement(
          AppSurfaceFrame,
          { bottomInset: props.bottomInset, nativeInsets: true, taoProps: entryTaoProps },
          content,
        ),
      headerConfig: {
        children: Right && header && props.observable && slots.toolbar.length > 0
          ? createElement(Right, null, createElement(NativeToolbar, { commands: slots.toolbar }))
          : null,
        hidden: !header,
        hideBackButton: !header || !props.observable,
        title: header ? slots.title ?? '' : '',
      },
      onDismissed: (event: { nativeEvent?: { dismissCount?: number } }) => {
        const count = Math.max(1, event.nativeEvent?.dismissCount ?? 1)
        props.navigation.reconcileNativeDismissal(props.entry.instanceId, count)
      },
      onHeaderBackButtonClicked: () => {
        activateBack()
      },
      screenId: String(props.entry.instanceId),
      shouldFreeze: false,
      stackPresentation: 'push',
    },
  )
}

export function NativeToolbar(props: { commands: readonly TaoNavigationCommand[] }): React.JSX.Element {
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
    React.Fragment,
    null,
    ...direct.map(command => createElement(NavigationCommandButton, { command, key: command.identity })),
    overflow.length > 0
      ? createElement(NavigationCommandButton, {
        accessibilityState: { expanded },
        command: {
          enabled: true,
          identity: 'navigation:toolbar:more',
          label: 'More',
          invoke: toggleOverflow,
        },
        hostRef: moreHost,
        key: 'more',
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
  const firstHost = React.useRef<TaoAccessibilityHost | null>(null)
  React.useEffect(() => focusAccessibilityHost(runtime, firstHost.current), [runtime])
  const content = createElement(
    runtime.View,
    {
      accessibilityRole: 'menu',
      accessibilityViewIsModal: true,
      onAccessibilityEscape: props.onClose,
      style: nativeMenuStyle,
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
