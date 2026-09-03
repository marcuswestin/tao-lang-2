import React from 'react'
import { focusAccessibilityHost, type TaoAccessibilityHost } from './TR-accessibility'
import { AppSurfaceFrame } from './TR-app-shell'
import { mountedDesignStyle } from './TR-mounted-design'
import { NavigationCommandButton } from './TR-navigation-command-button'
import {
  type RuntimeHostReadChannel,
  type TaoNavigationCommand,
  useHostSlotSnapshot,
} from './TR-navigation-host-slots'
import type { RuntimeStackNav } from './TR-navigation-mounts'
import type { PresentableEntry } from './TR-navigation-state'
import { NavigationLevel, presentedOccurrenceRegion } from './TR-navigation-surfaces'
import { renderPresentable } from './TR-navigation-values'
import { requireReactNativeRuntime } from './TR-react-native'
import type { TaoProps } from './TR-TaoProps'
import { Views } from './TR-views'

type HostEntry = PresentableEntry & { host: RuntimeHostReadChannel }

/** BasicStackSurface is the deterministic portable stack chrome and web fallback. */
export function BasicStackSurface(props: {
  entries: readonly HostEntry[]
  navigation: RuntimeStackNav
  taoProps?: TaoProps
}): React.JSX.Element {
  const runtime = requireReactNativeRuntime()
  return React.createElement(runtime.View, {
    children: props.entries.map((entry, index) =>
      React.createElement(BasicStackLevel, {
        entry,
        hidden: index !== props.entries.length - 1,
        key: entry.instanceId,
        navigation: props.navigation,
        taoProps: props.taoProps,
      })
    ),
    style: [stackStyle, mountedDesignStyle(props.taoProps, 'NavigationHost')],
  })
}

function BasicStackLevel(props: {
  entry: HostEntry
  hidden: boolean
  navigation: RuntimeStackNav
  taoProps?: TaoProps
}): React.JSX.Element {
  const slots = useHostSlotSnapshot(props.entry.host)
  const observable = !props.hidden && props.taoProps?.navigationHostActive !== false
  const entryTaoProps = { ...props.taoProps, navigationHostActive: observable }
  useDocumentTitle(observable ? slots.title : undefined)
  const runtime = requireReactNativeRuntime()
  return React.createElement(NavigationLevel, {
    fill: true,
    hidden: props.hidden,
    region: presentedOccurrenceRegion(props.navigation, props.entry, 'content'),
    children: React.createElement(runtime.View, {
      children: [
        // `Header false` removes the bar, not the ability to leave: Back stays reachable through
        // the reducer, the platform gesture, and the hardware key.
        !slots.header ? null : React.createElement(runtime.View, {
          children: [
            observable && props.navigation.depth > 1
              ? React.cloneElement(
                Views.Pressable(
                  {
                    __tao: { ...props.taoProps, designDefault: 'NavigationChromeButton' },
                    action: { invoke: () => props.navigation.back() },
                    semanticIdentity: `navigation:${props.navigation.name}:back`,
                    title: 'Back',
                  },
                  { nativeProps: { accessibilityLabel: 'Back', accessibilityRole: 'button' } },
                ),
                { key: 'back' },
              )
              : null,
            React.createElement(runtime.Text, {
              accessibilityRole: 'header',
              children: slots.title ?? '',
              key: 'title',
              style: mountedDesignStyle(props.taoProps, 'NavigationTitle'),
              testID: observable ? navigationTitleTestId : undefined,
            }),
            React.createElement(BasicToolbar, {
              commands: slots.toolbar,
              key: 'toolbar',
              observable,
              taoProps: props.taoProps,
            }),
          ],
          key: 'header',
          style: [headerStyle, mountedDesignStyle(props.taoProps, 'NavigationHeader', 'row')],
        }),
        React.createElement(
          AppSurfaceFrame,
          { key: 'content', taoProps: entryTaoProps },
          renderPresentable(props.entry.presentable, props.entry.arguments, entryTaoProps, props.entry.host),
        ),
      ],
      style: [stackStyle, mountedDesignStyle(props.taoProps, 'NavigationHost')],
    }),
  })
}

function BasicToolbar(props: {
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
  const direct = props.commands.slice(0, directToolbarCapacity)
  const overflow = props.commands.slice(directToolbarCapacity)
  const closeOverflow = () => {
    restoreOverflowFocus.current = true
    setExpanded(false)
  }
  const toggleOverflow = () => expanded ? closeOverflow() : setExpanded(true)
  return React.createElement(runtime.View, {
    accessibilityRole: 'toolbar',
    children: [
      ...direct.map(command => commandButton(command, props.observable, undefined, props.taoProps)),
      overflow.length > 0
        ? React.createElement(NavigationCommandButton, {
          accessibilityState: { expanded },
          command: {
            enabled: props.observable,
            identity: 'navigation:toolbar:more',
            label: 'More',
            invoke: toggleOverflow,
          },
          hostRef: moreHost,
          key: 'more',
          outlineIdentity: 'navigation:toolbar:more',
          taoProps: props.taoProps,
        })
        : null,
      expanded && overflow.length > 0
        ? React.createElement(BasicOverflowMenu, {
          commands: overflow,
          key: 'overflow',
          observable: props.observable,
          onClose: closeOverflow,
          taoProps: props.taoProps,
        })
        : null,
    ],
    style: toolbarStyle,
  })
}

function BasicOverflowMenu(props: {
  commands: readonly TaoNavigationCommand[]
  observable: boolean
  onClose(): void
  taoProps?: TaoProps
}): React.JSX.Element {
  const runtime = requireReactNativeRuntime()
  const content = React.createElement(runtime.View, {
    accessibilityRole: 'menu',
    children: props.commands.map(command =>
      React.createElement(NavigationCommandButton, {
        command: props.observable ? command : { ...command, enabled: false },
        key: command.identity,
        onInvoke: props.onClose,
        role: 'menuitem',
        taoProps: props.taoProps,
        testID: props.observable ? navigationCommandTestId(command.label) : undefined,
      })
    ),
    style: [overflowStyle, mountedDesignStyle(props.taoProps, 'NavigationHeader')],
  })
  if (!runtime.Modal) {
    return content
  }
  return React.createElement(
    runtime.Modal,
    { animationType: 'fade', onRequestClose: props.onClose, transparent: true, visible: true },
    React.createElement(
      runtime.View,
      { style: overflowPortalStyle },
      React.createElement(runtime.Pressable, {
        accessibilityLabel: 'Dismiss command menu',
        accessibilityRole: 'button',
        onPress: props.onClose,
        style: overflowBackdropStyle,
      }),
      content,
    ),
  )
}

function commandButton(
  command: TaoNavigationCommand,
  observable: boolean,
  beforeInvoke?: () => void,
  taoProps?: TaoProps,
): React.JSX.Element {
  const focusedCommand = observable ? command : { ...command, enabled: false }
  return React.createElement(NavigationCommandButton, {
    command: focusedCommand,
    key: command.identity,
    onInvoke: beforeInvoke,
    taoProps,
    testID: observable ? navigationCommandTestId(command.label) : undefined,
  })
}

// The portable/mobile host reserves two stable header actions; the ordered trailing suffix uses More.
export const directToolbarCapacity = 2

function useDocumentTitle(title: string | undefined): void {
  React.useEffect(() => {
    const document_ = (globalThis as { document?: { title: string } }).document
    if (!document_ || title === undefined) {
      return
    }
    const previous = document_.title
    document_.title = title
    return () => {
      if (document_.title === title) {
        document_.title = previous
      }
    }
  }, [title])
}

export const navigationTitleTestId = '__tao_navigation_title'
export const navigationCommandTestId = (label: string): string => `__tao_navigation_command:${label}`

const headerStyle = {
  alignItems: 'center',
  borderBottomColor: '#d0d0d0',
  borderBottomWidth: 1,
  flexDirection: 'row',
  justifyContent: 'space-between',
  minHeight: 48,
  paddingHorizontal: 12,
} as const
const overflowBackdropStyle = { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 } as const
const overflowPortalStyle = { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 } as const
const overflowStyle = {
  backgroundColor: '#ffffff',
  borderRadius: 10,
  elevation: 8,
  padding: 8,
  position: 'absolute',
  right: 12,
  top: 56,
} as const
const stackStyle = { flex: 1 } as const
const toolbarStyle = { alignItems: 'center', flexDirection: 'row' } as const
