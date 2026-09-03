import React from 'react'
import { AppSurfaceFrame } from './TR-app-shell'
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
  useHostSlotSnapshot,
} from './TR-navigation-host-slots'
import type { RuntimeStackNav } from './TR-navigation-mounts'
import { nativeNavigationModule } from './TR-navigation-native-hosts'
import type { PresentableEntry } from './TR-navigation-state'
import { presentedOccurrenceRegion } from './TR-navigation-surfaces'
import { renderPresentable } from './TR-navigation-values'
import { requireReactNativeRuntime } from './TR-react-native'
import type { TaoProps } from './TR-TaoProps'
import { Views } from './TR-views'

type HostEntry = PresentableEntry & { host: RuntimeHostReadChannel }

export function nativeStackAvailable(): boolean {
  const module = nativeNavigationModule()
  return Boolean(module?.ScreenStack && module.ScreenStackItem)
}

/** NativeStackSurface delegates only presentation chrome and gestures to react-native-screens. */
export function NativeStackSurface(props: {
  entries: readonly HostEntry[]
  navigation: RuntimeStackNav
  taoProps?: TaoProps
}): React.ReactNode {
  const module = nativeNavigationModule()
  if (!module?.ScreenStack || !module.ScreenStackItem) {
    return React.createElement(BasicStackSurface, props)
  }
  const ScreenStack = module.ScreenStack
  return React.createElement(
    ScreenStack,
    null,
    props.entries.map((entry, index) =>
      React.createElement(NativeStackItem, {
        active: index === props.entries.length - 1,
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
  entry: HostEntry
  navigation: RuntimeStackNav
  taoProps?: TaoProps
}): React.JSX.Element {
  const module = nativeNavigationModule()!
  const slots = useHostSlotSnapshot(props.entry.host)
  const ScreenStackItem = module.ScreenStackItem!
  const Right = module.ScreenStackHeaderRightView
  const observable = props.active && props.taoProps?.navigationHostActive !== false
  const backCapabilities = React.useRef<TaoOutlineLiveEntry>({}).current
  const backIdentity = useOutlineNode(
    observable && props.navigation.depth > 1
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
  return React.createElement(
    ScreenStackItem,
    {
      // ScreenStack owns native coverage. ScreenStackItem forbids decreasing a native-stack
      // screen from activityState 2 to 1 during push, so every retained item stays active here.
      activityState: 2,
      children: React.createElement(
        OutlineRegionScope,
        { region: presentedOccurrenceRegion(props.navigation, props.entry, 'content', () => observable) },
        React.createElement(
          AppSurfaceFrame,
          { nativeInsets: true, taoProps: props.taoProps },
          renderPresentable(props.entry.presentable, props.entry.arguments, props.taoProps, props.entry.host),
        ),
      ),
      headerConfig: {
        children: Right && slots.header && observable && slots.toolbar.length > 0
          ? React.createElement(Right, null, React.createElement(NativeToolbar, { commands: slots.toolbar }))
          : null,
        hidden: !slots.header,
        hideBackButton: !slots.header || !observable,
        title: slots.header ? slots.title ?? '' : '',
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
  const direct = props.commands.slice(0, directToolbarCapacity)
  const overflow = props.commands.slice(directToolbarCapacity)
  return React.createElement(
    React.Fragment,
    null,
    ...direct.map(command => React.createElement(NavigationCommandButton, { command, key: command.identity })),
    overflow.length > 0
      ? React.cloneElement(
        Views.Pressable(
          {
            action: { invoke: () => setExpanded(value => !value) },
            semanticIdentity: 'navigation:toolbar:more',
            title: 'More',
          },
          { nativeProps: { accessibilityLabel: 'More', accessibilityRole: 'button' } },
        ),
        { key: 'more' },
      )
      : null,
    expanded && overflow.length > 0
      ? React.createElement(NativeOverflowMenu, {
        commands: overflow,
        key: 'overflow',
        onClose: () => setExpanded(false),
      })
      : null,
  )
}

function NativeOverflowMenu(props: {
  commands: readonly TaoNavigationCommand[]
  onClose(): void
}): React.JSX.Element {
  const runtime = requireReactNativeRuntime()
  const content = React.createElement(
    runtime.View,
    { accessibilityRole: 'menu', style: nativeMenuStyle },
    ...props.commands.map(command =>
      React.createElement(NavigationCommandButton, {
        command,
        key: command.identity,
        onInvoke: props.onClose,
        role: 'menuitem',
      })
    ),
  )
  if (!runtime.Modal) {
    return content
  }
  return React.createElement(
    runtime.Modal,
    { animationType: 'fade', onRequestClose: props.onClose, transparent: true, visible: true },
    React.createElement(
      runtime.View,
      { style: nativeMenuPortalStyle },
      React.createElement(runtime.Pressable, {
        accessibilityLabel: 'Dismiss command menu',
        accessibilityRole: 'button',
        onPress: props.onClose,
        style: nativeMenuBackdropStyle,
      }),
      content,
    ),
  )
}

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
