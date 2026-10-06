import TR from '@runtime/TR'
import { warnContainedFailure } from '@runtime/TR-errors'
import { installNativeAbortSupport } from '@runtime/TR-native-abort'
import { registerRootComponent, requireOptionalNativeModule } from 'expo'
import { type ComponentType, createElement, Fragment, useEffect, useMemo } from 'react'
import { NativeModules, Platform, View } from 'react-native'
import { createManagedRuntimePreparation, managedLoopIdentityMarker } from './expo-host-src/ManagedLoopIdentityMarker'

installNativeAbortSupport()
const generatedApp = require('./_gen_tao-app/App') as { default: ComponentType }

const identity = require('./_gen_tao-app/ManagedLoopIdentity').default as unknown
function DevelopmentRoot() {
  const prepareManagedRuntime = useMemo(createManagedRuntimePreparation, [])
  useEffect(() => {
    if (__DEV__ && (Platform.OS === 'ios' || Platform.OS === 'android')) {
      const nativeMenu = requireOptionalNativeModule<{ openMenu?: () => void | Promise<void> }>('ExpoDevMenu')
      if (typeof nativeMenu?.openMenu === 'function') {
        TR.Dev.setHostDeveloperTools({
          label: 'Expo developer tools',
          open: () => {
            void Promise.resolve().then(() => nativeMenu.openMenu?.()).catch(error => {
              warnContainedFailure('Could not open Expo developer tools.', error)
            })
          },
        })
      }
    }
    return () => TR.Dev.setHostDeveloperTools(undefined)
  }, [])
  useEffect(() => {
    void prepareManagedRuntime({
      development: __DEV__,
      platform: Platform.OS,
      publication: identity,
      resolveNativeMenu: () => requireOptionalNativeModule<{ hideMenu?: () => Promise<void> }>('ExpoDevMenu'),
      onFailure: error => warnContainedFailure('Managed runtime development-menu preparation failed.', error),
    })
  }, [prepareManagedRuntime, identity])
  const sourceCode = NativeModules['SourceCode'] as
    | { scriptURL?: string; getConstants?: () => { scriptURL?: string } }
    | undefined
  return createElement(
    Fragment,
    null,
    createElement(generatedApp.default),
    __DEV__ && identity !== null
      ? createElement(
        View,
        managedLoopIdentityMarker(identity as object, sourceCode?.scriptURL ?? sourceCode?.getConstants?.().scriptURL),
      )
      : null,
  )
}
registerRootComponent(DevelopmentRoot)
