import type React from 'react'
import { warnContainedFailure, warnDesignDivergence } from './TR-errors'
import { runtimeListeners } from './TR-listeners'
import { requireReactNativeRuntime } from './TR-react-native'
import { runtimeTestOverrideSlot } from './TR-test-override'

/**
 * Keep native ambient globals out of portable/server consumers of the runtime. The Expo host
 * contract tests check these narrow ports against the actual installed package's exports/types.
 */
export type NativeNavigationModule = {
  Tabs?: { Host: React.ComponentType<NativeTabsHostProps>; Screen: React.ComponentType<NativeTabsScreenProps> }
  ScreenStack?: React.ComponentType<any>
  ScreenStackHeaderConfig?: React.ComponentType<any>
  ScreenStackHeaderRightView?: React.ComponentType<any>
  ScreenStackItem?: React.ComponentType<any>
}

export type NativeTabsHostProps = {
  children: NonNullable<React.ReactNode>
  navStateRequest: { selectedScreenKey: string; baseProvenance: number }
  rejectStaleNavStateUpdates?: boolean
  tabBarHidden?: boolean
  ios?: { tabBarControllerMode?: 'automatic' | 'tabBar' | 'tabSidebar' }
  onTabSelected?: (event: {
    nativeEvent: {
      selectedScreenKey: string
      provenance: number
      actionOrigin: 'user' | 'programmatic-js' | 'programmatic-native' | 'implicit'
      isRepeated: boolean
      hasTriggeredSpecialEffect: boolean
    }
  }) => void
  onTabSelectionRejected?: (event: { nativeEvent: { provenance: number } }) => void
  onTabSelectionPrevented?: (event: { nativeEvent: { provenance: number } }) => void
}

export type NativeTabsScreenProps = {
  children?: React.ReactNode
  screenKey: string
  title?: string
  preventNativeSelection?: boolean
  ios?: { icon?: { type: 'sfSymbol'; name: string } }
  android?: {
    icon?: { type: 'imageSource'; imageSource: { uri?: string; width?: number; height?: number; scale?: number } }
  }
  specialEffects?: { repeatedTabSelection?: { popToRoot?: boolean; scrollToTop?: boolean } }
}

type NativeNavigationHost = 'tabs' | 'stack'
type NativeNavigationFallbackReason = 'module-unavailable' | 'api-mismatch' | 'too-many-tabs'

/** Host/tooling evidence only; it does not introduce an application-observable navigation API. */
export type NativeNavigationDiagnostic = Readonly<{
  kind: 'host'
  host: NativeNavigationHost
  implementation: 'native' | 'basic'
  platform: string
  code: 'NAV_NATIVE_HOST' | 'NAV_NATIVE_FALLBACK'
  severity: 'info' | 'warning'
  reason?: NativeNavigationFallbackReason
  message: string
}>

type NativeNavigationState = {
  enabled: boolean
  module?: NativeNavigationModule | null
  diagnostics: Map<string, NativeNavigationDiagnostic>
}

let state: NativeNavigationState = { enabled: true, diagnostics: new Map() }
const diagnosticsListeners = runtimeListeners<[diagnostic: NativeNavigationDiagnostic]>()
const stateSlot = runtimeTestOverrideSlot({ read: () => state, write: value => state = value })

/** disableNativeNavigationSurfaces keeps behavior checks on synchronous basic host surfaces. */
export function disableNativeNavigationSurfaces(): void {
  state.enabled = false
}

export function nativeNavigationModule(): NativeNavigationModule | undefined {
  if (!state.enabled || !nativePlatform()) {
    return undefined
  }
  if (state.module === undefined) {
    try {
      state.module = require('react-native-screens') as NativeNavigationModule
    } catch (error) {
      warnContainedFailure('Native navigation surfaces are unavailable; using the basic host surfaces.', error)
      state.module = null
      nativeNavigationFallback('tabs', 'module-unavailable')
      nativeNavigationFallback('stack', 'module-unavailable')
    }
  }
  return state.module ?? undefined
}

/** Record successful native rendering after a host mounts, never just from an export check. */
export function nativeNavigationMounted(host: NativeNavigationHost): void {
  reportNativeNavigation({
    kind: 'host',
    host,
    implementation: 'native',
    platform: requireReactNativeRuntime().Platform?.OS ?? 'unknown',
    code: 'NAV_NATIVE_HOST',
    severity: 'info',
    message: `Native navigation ${host} host mounted.`,
  })
}

/** A mobile host that cannot honor native navigation keeps every destination and reports why. */
export function nativeNavigationFallback(host: NativeNavigationHost, reason: NativeNavigationFallbackReason): void {
  if (!state.enabled || !nativePlatform()) {
    return
  }
  const message = reason === 'too-many-tabs'
    ? 'This platform supports at most five native tabs; using the basic host to keep every destination available.'
    : `Native navigation ${host} are unavailable; using the basic host surfaces.`
  if (
    reportNativeNavigation({
      kind: 'host',
      host,
      implementation: 'basic',
      platform: requireReactNativeRuntime().Platform?.OS ?? 'unknown',
      code: 'NAV_NATIVE_FALLBACK',
      severity: 'warning',
      reason,
      message,
    })
  ) {
    warnDesignDivergence(message)
  }
}

/** Bounded, deduplicated records let release host proofs reject an unnoticed portable fallback. */
export function captureNativeNavigationDiagnostics(): readonly NativeNavigationDiagnostic[] {
  return [...state.diagnostics.values()]
}

export function subscribeNativeNavigationDiagnostics(
  listener: (diagnostic: NativeNavigationDiagnostic) => void,
): () => void {
  return diagnosticsListeners.subscribe(listener)
}

function reportNativeNavigation(diagnostic: NativeNavigationDiagnostic): boolean {
  const key = `${diagnostic.platform}:${diagnostic.host}:${diagnostic.code}:${diagnostic.reason ?? ''}`
  if (state.diagnostics.has(key)) {
    return false
  }
  state.diagnostics.set(key, Object.freeze(diagnostic))
  diagnosticsListeners.notify(diagnostic)
  return true
}

/** overrideNativeNavigationModuleForTest exercises the pinned adapter shape without native binaries. */
export function overrideNativeNavigationModuleForTest(module: NativeNavigationModule): () => void {
  return stateSlot.install({ enabled: true, module, diagnostics: new Map() })
}

function nativePlatform(): boolean {
  const os = requireReactNativeRuntime().Platform?.OS
  return os === 'ios' || os === 'android'
}
