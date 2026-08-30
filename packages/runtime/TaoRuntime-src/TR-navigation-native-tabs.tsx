import React from 'react'
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
  const os = requireReactNativeRuntime().Platform?.OS
  const module = nativeNavigationModule()!
  const BottomTabs = module.BottomTabs!
  const BottomTabsScreen = module.BottomTabsScreen!
  return React.createElement(
    BottomTabs,
    {
      experimentalControlNavigationStateInJS: true,
      onNativeFocusChange: (event: { nativeEvent: { tabKey: string } }) => {
        options.onActivate(event.nativeEvent.tabKey)
      },
    },
    options.items.map(item =>
      React.createElement(BottomTabsScreen, {
        children: item.content,
        isFocused: item.key === options.activeKey,
        key: item.key,
        tabKey: item.key,
        title: item.title,
        ...(os === 'ios' && item.iconName ? { icon: { sfSymbolName: item.iconName } } : {}),
      })
    ),
  )
}
