import React from 'react'
import { focusAccessibilityHost, type TaoAccessibilityHost } from './TR-accessibility'
import { AppSurfaceFrame } from './TR-app-shell'
import { createElement } from './TR-create-element'
import { mountedDesignStyle } from './TR-mounted-design'
import { NavigationCommandButton } from './TR-navigation-command-button'
import {
  type RuntimeHostReadChannel,
  type TaoNavigationCommand,
  useEnclosingChrome,
  useHostSlotSnapshot,
} from './TR-navigation-host-slots'
import type { RuntimeStackNav } from './TR-navigation-mounts'
import type { PresentableEntry } from './TR-navigation-state'
import { NavigationLevel, presentedOccurrenceRegion } from './TR-navigation-surfaces'
import { isNavigation, renderPresentable } from './TR-navigation-values'
import { requireReactNativeRuntime } from './TR-react-native'
import { catalystPalette } from './TR-scheme'
import type { TaoProps } from './TR-TaoProps'
import { Views } from './TR-views'

type HostEntry = PresentableEntry & { host: RuntimeHostReadChannel }

/** BasicStackSurface is the deterministic portable stack chrome and web fallback. */
export function BasicStackSurface(props: {
  bottomInset?: number
  chrome?: RuntimeHostReadChannel
  entries: readonly HostEntry[]
  navigation: RuntimeStackNav
  taoProps?: TaoProps
}): React.JSX.Element {
  const runtime = requireReactNativeRuntime()
  return createElement(runtime.View, {
    children: props.entries.map((entry, index) =>
      createElement(BasicStackLevel, {
        bottomInset: props.bottomInset,
        chrome: props.chrome,
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
  bottomInset?: number
  chrome?: RuntimeHostReadChannel
  entry: HostEntry
  hidden: boolean
  navigation: RuntimeStackNav
  taoProps?: TaoProps
}): React.JSX.Element {
  const slots = useHostSlotSnapshot(props.entry.host)
  const observable = !props.hidden && props.taoProps?.navigationHostActive !== false
  const entryTaoProps = { ...props.taoProps, navigationHostActive: observable }
  useDocumentTitle(observable ? slots.title : undefined)
  useEnclosingChrome(props.chrome, slots, observable && !isNavigation(props.entry.presentable))
  const runtime = requireReactNativeRuntime()
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
  return createElement(NavigationLevel, {
    fill: true,
    hidden: props.hidden,
    region: presentedOccurrenceRegion(props.navigation, props.entry, 'content'),
    children: createElement(runtime.View, {
      children: [
        // `Header false` removes the bar, not the ability to leave: Back stays reachable through
        // the reducer, the platform gesture, and the hardware key. Enclosing chrome replaces it.
        !slots.header || props.chrome ? null : createElement(runtime.View, {
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
            createElement(runtime.Text, {
              accessibilityRole: 'header',
              children: slots.title ?? '',
              key: 'title',
              style: [
                { color: catalystPalette(props.taoProps?.scheme)?.color },
                mountedDesignStyle(props.taoProps, 'NavigationTitle'),
              ],
              testID: observable ? navigationTitleTestId : undefined,
            }),
            createElement(BasicToolbar, {
              commands: slots.toolbar,
              key: 'toolbar',
              observable,
              taoProps: props.taoProps,
            }),
          ],
          key: 'header',
          style: [
            headerStyle,
            catalystPalette(props.taoProps?.scheme),
            mountedDesignStyle(props.taoProps, 'NavigationHeader', 'row'),
          ],
        }),
        contentOwnsWindow
          ? createElement(runtime.View, { children: content, key: 'content', style: stackStyle })
          : createElement(
            AppSurfaceFrame,
            { bottomInset: props.bottomInset, key: 'content', taoProps: entryTaoProps },
            content,
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
  return createElement(runtime.View, {
    accessibilityRole: 'toolbar',
    children: [
      ...direct.map(command => commandButton(command, props.observable, undefined, props.taoProps)),
      overflow.length > 0
        ? createElement(NavigationCommandButton, {
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
        ? createElement(BasicOverflowMenu, {
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
  const firstHost = React.useRef<TaoAccessibilityHost | null>(null)
  React.useEffect(() => focusAccessibilityHost(runtime, firstHost.current), [runtime])
  const content = createElement(runtime.View, {
    accessibilityRole: 'menu',
    accessibilityViewIsModal: true,
    children: props.commands.map(command =>
      createElement(NavigationCommandButton, {
        command: props.observable ? command : { ...command, enabled: false },
        hostRef: command === props.commands[0] ? firstHost : undefined,
        key: command.identity,
        onInvoke: props.onClose,
        role: 'menuitem',
        taoProps: props.taoProps,
        testID: props.observable ? navigationCommandTestId(command.label) : undefined,
      })
    ),
    onAccessibilityEscape: props.onClose,
    style: [
      overflowStyle,
      catalystPalette(props.taoProps?.scheme),
      mountedDesignStyle(props.taoProps, 'NavigationHeader'),
    ],
  })
  if (!runtime.Modal) {
    return content
  }
  return createElement(
    runtime.Modal,
    { animationType: 'fade', onRequestClose: props.onClose, transparent: true, visible: true },
    createElement(
      runtime.View,
      { style: overflowPortalStyle },
      createElement(runtime.Pressable, {
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
  return createElement(NavigationCommandButton, {
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

// The rule's color is `borderColor`, not `borderBottomColor`: a side-specific color outranks the
// general one, so it kept the rule light grey under a design's or a dark scheme's `border`.
const headerStyle = {
  alignItems: 'center',
  borderColor: '#d0d0d0',
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
