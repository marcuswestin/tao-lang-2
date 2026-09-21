import type React from 'react'
import { warnContainedFailure } from './TR-errors'
import { requireReactNativeRuntime } from './TR-react-native'

export type NativeNavigationModule = {
  BottomTabs?: React.ComponentType<any>
  BottomTabsScreen?: React.ComponentType<any>
  ScreenStack?: React.ComponentType<any>
  ScreenStackHeaderConfig?: React.ComponentType<any>
  ScreenStackHeaderRightView?: React.ComponentType<any>
  ScreenStackItem?: React.ComponentType<any>
}

let nativeSurfacesEnabled = true
let cachedModule: NativeNavigationModule | null | undefined

/** disableNativeNavigationSurfaces keeps behavior checks on synchronous basic host surfaces. */
export function disableNativeNavigationSurfaces(): void {
  nativeSurfacesEnabled = false
}

export function nativeNavigationModule(): NativeNavigationModule | undefined {
  if (!nativeSurfacesEnabled || !nativePlatform()) {
    return undefined
  }
  if (cachedModule === undefined) {
    try {
      cachedModule = require('react-native-screens') as NativeNavigationModule
    } catch (error) {
      warnContainedFailure('Native navigation surfaces are unavailable; using the basic host surfaces.', error)
      cachedModule = null
    }
  }
  return cachedModule ?? undefined
}

/** overrideNativeNavigationModuleForTest exercises the pinned adapter shape without native binaries. */
export function overrideNativeNavigationModuleForTest(module: NativeNavigationModule): () => void {
  const previousEnabled = nativeSurfacesEnabled
  const previousModule = cachedModule
  nativeSurfacesEnabled = true
  cachedModule = module
  return () => {
    nativeSurfacesEnabled = previousEnabled
    cachedModule = previousModule
  }
}

function nativePlatform(): boolean {
  const os = requireReactNativeRuntime().Platform?.OS
  return os === 'ios' || os === 'android'
}
