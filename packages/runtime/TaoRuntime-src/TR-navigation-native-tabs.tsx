import React from 'react'
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

type NativeTabsModule = {
  BottomTabs: React.ComponentType<any>
  BottomTabsScreen: React.ComponentType<any>
}

let nativeSurfacesEnabled = true

/** disableNativeNavigationSurfaces keeps every check on the deterministic JS surfaces. */
export function disableNativeNavigationSurfaces(): void {
  nativeSurfacesEnabled = false
}

let cachedModule: NativeTabsModule | null | undefined

function nativeTabsModule(): NativeTabsModule | undefined {
  if (cachedModule === undefined) {
    try {
      // Lazy and optional: the runtime never hard-requires the native module, so environments
      // without it keep the JS surface. An install that omits the package still bundles, because
      // the toolchain's metro config resolves missing optional hosts to Metro's empty module.
      const screens = require('react-native-screens') as Partial<NativeTabsModule>
      cachedModule = screens.BottomTabs && screens.BottomTabsScreen
        ? { BottomTabs: screens.BottomTabs, BottomTabsScreen: screens.BottomTabsScreen }
        : null
      if (!cachedModule) {
        console.warn('[tao] native tabs unavailable: react-native-screens has no BottomTabs export')
      }
    } catch (error) {
      console.warn(`[tao] native tabs unavailable: ${String(error)}`)
      cachedModule = null
    }
  }
  return cachedModule ?? undefined
}

/** nativeSelectionTabsAvailable says whether the platform tab surface can render here at all. */
export function nativeSelectionTabsAvailable(): boolean {
  if (!nativeSurfacesEnabled) {
    return false
  }
  const os = requireReactNativeRuntime().Platform?.OS
  if (os !== 'ios' && os !== 'android') {
    return false
  }
  return nativeTabsModule() !== undefined
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
  const module = nativeTabsModule()!
  return React.createElement(
    module.BottomTabs,
    {
      experimentalControlNavigationStateInJS: true,
      onNativeFocusChange: (event: { nativeEvent: { tabKey: string } }) => {
        options.onActivate(event.nativeEvent.tabKey)
      },
    },
    options.items.map(item =>
      React.createElement(module.BottomTabsScreen, {
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
