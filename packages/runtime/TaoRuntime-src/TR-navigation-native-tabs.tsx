import React from 'react'
import { InteractionControls } from './TR-interaction-catalog'
import { type TaoOutlineLiveEntry, useOutlineNode } from './TR-interaction-outline'
import { nativeNavigationModule } from './TR-navigation-native-hosts'
import { requireReactNativeRuntime } from './TR-react-native'

/**
 * The native selection surface: `react-native-screens`' BottomTabs, which hosts the platform's own
 * tab controller — UITabBarController on iOS, so tabs built against the iOS 26 SDK render Liquid
 * Glass, and the Material bottom bar on Android. Tao's navigation reducer stays the single source
 * of truth: the native bar runs in controlled mode, reports focus requests through one event, and
 * renders whatever `isFocused` says, so `present @key`, journeys, and restoration behave
 * identically on every surface.
 *
 * Everything here degrades: where the native host is absent — web, the Jest harness, a platform
 * the module cannot load on — the caller keeps the runtime's own JS bar behind the same nav value.
 */

/** TaoNativeTabItem is one keyed tab handed to the native bar. */
export type TaoNativeTabItem = {
  key: string
  title: string
  /** An SF Symbol name from the item's `Icon` property; applied on iOS only. */
  iconName?: string
  content: React.ReactNode
}

/** nativeSelectionTabsAvailable says whether the platform tab surface can render here at all. */
export function nativeSelectionTabsAvailable(): boolean {
  const module = nativeNavigationModule()
  return Boolean(module?.BottomTabs && module.BottomTabsScreen)
}

/**
 * renderNativeSelectionTabs renders the native tab surface, or nothing where it is unavailable —
 * the caller then keeps the JS bar. Content of every tab stays mounted, exactly as the JS surface
 * keeps covered occurrences mounted, so per-tab state survives switching.
 */
export function renderNativeSelectionTabs(options: {
  items: readonly TaoNativeTabItem[]
  activeKey: string
  onActivate: (key: string) => void
}): React.ReactNode | undefined {
  if (!nativeSelectionTabsAvailable()) {
    return undefined
  }
  return React.createElement(NativeSelectionTabs, options)
}

function NativeSelectionTabs(options: {
  items: readonly TaoNativeTabItem[]
  activeKey: string
  onActivate: (key: string) => void
}): React.ReactNode {
  const os = requireReactNativeRuntime().Platform?.OS
  const module = nativeNavigationModule()!
  const BottomTabs = module.BottomTabs!
  const identities = React.useRef(new Map<string, string>())
  return React.createElement(
    BottomTabs,
    {
      experimentalControlNavigationStateInJS: true,
      onNativeFocusChange: (event: { nativeEvent: { tabKey: string } }) => {
        const key = event.nativeEvent.tabKey
        InteractionControls.ActivateIdentity(identities.current.get(key), () => options.onActivate(key))()
      },
    },
    options.items.map(item =>
      React.createElement(NativeSelectionTab, {
        active: item.key === options.activeKey,
        item,
        key: item.key,
        onActivate: () => options.onActivate(item.key),
        onIdentity: identity => {
          identity === undefined ? identities.current.delete(item.key) : identities.current.set(item.key, identity)
        },
        os,
      })
    ),
  )
}

function NativeSelectionTab(props: {
  active: boolean
  item: TaoNativeTabItem
  onActivate(): void
  onIdentity(identity: string | undefined): void
  os: string | undefined
}): React.JSX.Element {
  const BottomTabsScreen = nativeNavigationModule()!.BottomTabsScreen!
  const capabilities = React.useRef<TaoOutlineLiveEntry>({}).current
  const identity = useOutlineNode({
    identity: `navigation:selection:${props.item.key}`,
    kind: 'action',
    label: () => props.item.title,
    live: capabilities,
    provenance: { selection: props.item.key },
  })
  capabilities.activate = props.onActivate
  capabilities.enabled = () => true
  React.useEffect(() => {
    props.onIdentity(identity)
    return () => props.onIdentity(undefined)
  }, [identity, props.onIdentity])
  return React.createElement(BottomTabsScreen, {
    children: props.item.content,
    isFocused: props.active,
    tabKey: props.item.key,
    title: props.item.title,
    ...(props.os === 'ios' && props.item.iconName ? { icon: { sfSymbolName: props.item.iconName } } : {}),
  })
}
