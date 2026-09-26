import React from 'react'
import { createElement } from './TR-create-element'
import { warnContainedFailure } from './TR-errors'
import { InteractionControls } from './TR-interaction-catalog'
import { type TaoOutlineLiveEntry, useOutlineNode } from './TR-interaction-outline'
import { navigationIconImageSource } from './TR-navigation-command-button'
import { nativeNavigationFallback, nativeNavigationModule, nativeNavigationMounted } from './TR-navigation-native-hosts'
import { requireReactNativeRuntime } from './TR-react-native'

/** The pinned native tab controller acknowledges every transition with native-owned provenance. */

/** TaoNativeTabItem is one keyed tab handed to the native bar. */
export type TaoNativeTabItem = {
  key: string
  title: string
  /** iOS uses the SF Symbol; Android resolves the existing portable icon mapping. */
  iconName?: string
  content: React.ReactNode
}

/** nativeSelectionTabsAvailable says whether the platform tab surface can render here at all. */
export function nativeSelectionTabsAvailable(itemCount = 0): boolean {
  const module = nativeNavigationModule()
  if (!module) {
    return false
  }
  if (!module.Tabs?.Host || !module.Tabs.Screen) {
    nativeNavigationFallback('tabs', 'api-mismatch')
    return false
  }
  if (requireReactNativeRuntime().Platform?.OS === 'android' && itemCount > 5) {
    nativeNavigationFallback('tabs', 'too-many-tabs')
    return false
  }
  return true
}

/**
 * renderNativeSelectionTabs renders the native tab surface, or nothing where it is unavailable —
 * the caller then keeps the JS bar. Content of every tab stays mounted, exactly as the JS surface
 * keeps covered occurrences mounted, so per-tab state survives switching.
 */
export function renderNativeSelectionTabs(options: {
  items: readonly TaoNativeTabItem[]
  activeKey: string
  observable: boolean
  onActivate: (key: string) => void
}): React.ReactNode | undefined {
  if (!nativeSelectionTabsAvailable(options.items.length)) {
    return undefined
  }
  return createElement(NativeSelectionTabs, options)
}

function NativeSelectionTabs(options: {
  items: readonly TaoNativeTabItem[]
  activeKey: string
  observable: boolean
  onActivate: (key: string) => void
}): React.ReactNode {
  const platform = requireReactNativeRuntime().Platform as
    | { OS: string; isPad?: boolean; isMacCatalyst?: boolean; Version?: string | number }
    | undefined
  React.useEffect(() => nativeNavigationMounted('tabs'), [])
  const TabsHost = nativeNavigationModule()!.Tabs!.Host!
  const identities = React.useRef(new Map<string, string>())
  // Native owns this counter. Never increment it for a Tao intent: multiple JS requests may
  // share one acknowledged base, and an old acknowledgement must not undo the newest intent.
  const acknowledged = React.useRef(-1)
  const lastUserSelection = React.useRef(-1)
  const [baseProvenance, setBaseProvenance] = React.useState(0)
  const acknowledge = (provenance: number): void => {
    if (!Number.isSafeInteger(provenance) || provenance < 0 || provenance <= acknowledged.current) {
      return
    }
    acknowledged.current = provenance
    setBaseProvenance(provenance)
  }
  return createElement(
    TabsHost,
    {
      navStateRequest: { selectedScreenKey: options.activeKey, baseProvenance },
      rejectStaleNavStateUpdates: true,
      // The platform-generated More destination bypasses per-screen prevention on iOS.
      tabBarHidden: !options.observable,
      ios: {
        tabBarControllerMode: platform?.OS === 'ios' && (platform.isPad || platform.isMacCatalyst)
            && Number.parseInt(String(platform.Version), 10) >= 18
          ? 'tabSidebar'
          : 'automatic',
      },
      onTabSelected: (event: {
        nativeEvent: {
          selectedScreenKey: string
          provenance: number
          actionOrigin: 'user' | 'programmatic-js' | 'programmatic-native' | 'implicit'
          isRepeated: boolean
        }
      }) => {
        const selected = event.nativeEvent
        if (
          !Number.isSafeInteger(selected.provenance) || selected.provenance < 0
          || selected.provenance < acknowledged.current
        ) {
          return
        }
        acknowledge(selected.provenance)
        if (
          !options.observable || selected.actionOrigin !== 'user' || selected.isRepeated
          || selected.provenance <= lastUserSelection.current
        ) {
          return
        }
        lastUserSelection.current = selected.provenance
        const key = selected.selectedScreenKey
        if (key === options.activeKey || !options.items.some(item => item.key === key)) {
          return
        }
        InteractionControls.ActivateIdentity(identities.current.get(key), () => options.onActivate(key))()
      },
      // A rejection carries the current native state. Rebase the current Tao intent, never the
      // rejected request: it may already have been replaced by a newer present/restoration.
      onTabSelectionRejected: (event: { nativeEvent: { provenance: number } }) => {
        acknowledge(event.nativeEvent.provenance)
      },
      onTabSelectionPrevented: (event: { nativeEvent: { provenance: number } }) => {
        acknowledge(event.nativeEvent.provenance)
      },
      children: options.items.map(item =>
        createElement(NativeSelectionTab, {
          item,
          key: item.key,
          observable: options.observable,
          onActivate: () => {
            if (options.observable) {
              options.onActivate(item.key)
            }
          },
          onIdentity: identity => {
            identity === undefined ? identities.current.delete(item.key) : identities.current.set(item.key, identity)
          },
          os: platform?.OS,
        })
      ),
    },
  )
}

function NativeSelectionTab(props: {
  item: TaoNativeTabItem
  observable: boolean
  onActivate(): void
  onIdentity(identity: string | undefined): void
  os: string | undefined
}): React.JSX.Element {
  const TabsScreen = nativeNavigationModule()!.Tabs!.Screen!
  const iconName = props.os === 'android' ? props.item.iconName : undefined
  const [androidIcon, setAndroidIcon] = React.useState<
    { name: string; source: NonNullable<Awaited<ReturnType<typeof navigationIconImageSource>>> }
  >()
  React.useEffect(() => {
    if (!iconName) {
      return
    }
    let current = true
    void navigationIconImageSource(iconName).then(source => {
      if (current) {
        setAndroidIcon(source ? { name: iconName, source } : undefined)
      }
    }).catch(error => {
      if (current) {
        warnContainedFailure('The navigation icon could not be loaded; keeping its label.', error)
      }
    })
    return () => {
      current = false
    }
  }, [iconName])
  const capabilities = React.useRef<TaoOutlineLiveEntry>({}).current
  const identity = useOutlineNode({
    identity: `navigation:selection:${props.item.key}`,
    kind: 'action',
    label: () => props.item.title,
    live: capabilities,
    provenance: { selection: props.item.key },
  })
  capabilities.activate = props.onActivate
  capabilities.enabled = () => props.observable
  React.useEffect(() => {
    props.onIdentity(identity)
    return () => props.onIdentity(undefined)
  }, [identity, props.onIdentity])
  return createElement(TabsScreen, {
    children: props.item.content,
    specialEffects: { repeatedTabSelection: { popToRoot: false, scrollToTop: false } },
    screenKey: props.item.key,
    preventNativeSelection: !props.observable,
    title: props.item.title,
    ...(iconName && androidIcon?.name === iconName
      ? { android: { icon: { type: 'imageSource' as const, imageSource: androidIcon.source } } }
      : {}),
    ...(props.os === 'ios' && props.item.iconName
      ? { ios: { icon: { type: 'sfSymbol' as const, name: props.item.iconName } } }
      : {}),
  })
}
