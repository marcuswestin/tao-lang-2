import React from 'react'
import { requireReactNativeRuntime } from './TR-react-native'

/**
 * The native selection surface: `react-native-screens`' Tabs, which hosts the platform's own
 * tab controller — UITabBarController on iOS, so tabs built against the iOS 26 SDK render Liquid
 * Glass, and the Material bottom bar on Android. Tao's navigation reducer stays the single source
 * of truth: the native host holds its own selection state stamped with a provenance number, every
 * change reports through `onTabSelected`, and each render requests the reducer's active key citing
 * the last acknowledged provenance, so `present @key`, journeys, and restoration behave
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
  TabsHost: React.ComponentType<any>
  TabsScreen: React.ComponentType<any>
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
      // As of react-native-screens 4.26 the Tabs surface is not re-exported from the package
      // index or its experimental entry, so this reaches into the library's source tree — the
      // build Metro and Jest resolve through its `react-native` field, and the only one where
      // babel codegen can parse the fabric component specs. The catch keeps the JS surface when
      // a future release moves it again.
      const screens = require('react-native-screens/src/components/tabs') as {
        Tabs?: { Host?: React.ComponentType<any>; Screen?: React.ComponentType<any> }
      }
      cachedModule = screens.Tabs?.Host && screens.Tabs?.Screen
        ? { TabsHost: screens.Tabs.Host, TabsScreen: screens.Tabs.Screen }
        : null
      if (!cachedModule) {
        console.warn('[tao] native tabs unavailable: react-native-screens has no Tabs export')
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
  return React.createElement(NativeSelectionTabs, {
    activeKey: options.activeKey,
    items: options.items,
    module: nativeTabsModule()!,
    onActivate: options.onActivate,
  })
}

/**
 * NativeSelectionTabs bridges the reducer's active key to the host's provenance protocol: the host
 * stamps each selection state it acknowledges, and a JS request is honored only when it cites the
 * provenance it was based on, so a late request derived from a stale state cannot clobber a newer
 * user tap. The ref tracks the newest acknowledged provenance without forcing a render of its own.
 */
function NativeSelectionTabs(props: {
  items: readonly TaoNativeTabItem[]
  activeKey: string
  onActivate: (key: string) => void
  module: NativeTabsModule
}): React.ReactElement {
  const os = requireReactNativeRuntime().Platform?.OS
  const baseProvenance = React.useRef(0)
  return React.createElement(
    props.module.TabsHost,
    {
      navStateRequest: { baseProvenance: baseProvenance.current, selectedScreenKey: props.activeKey },
      onTabSelected: (event: { nativeEvent: { selectedScreenKey: string; provenance: number } }) => {
        baseProvenance.current = event.nativeEvent.provenance
        // An acknowledgement of the reducer's own request carries the already-active key; only a
        // selection the reducer has not seen — a user tap on another tab — feeds back into it.
        if (event.nativeEvent.selectedScreenKey !== props.activeKey) {
          props.onActivate(event.nativeEvent.selectedScreenKey)
        }
      },
    },
    props.items.map(item =>
      React.createElement(props.module.TabsScreen, {
        children: item.content,
        key: item.key,
        screenKey: item.key,
        title: item.title,
        ...(os === 'ios' && item.iconName ? { ios: { icon: { name: item.iconName, type: 'sfSymbol' } } } : {}),
      })
    ),
  )
}
