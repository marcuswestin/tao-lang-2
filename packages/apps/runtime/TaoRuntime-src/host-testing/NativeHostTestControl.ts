/** Native-only deep-link control for an explicitly bootstrapped Tao host test. */

import { Linking } from 'react-native'
import type { HostTestEnvironment } from './HostTestEnvironment'
import {
  attachNativeHostTestControl,
  type NativeHostTestControl,
  type NativeHostTestControlOptions,
} from './NativeHostTestControlCore'

export { attachNativeHostTestControl }
export type { NativeHostTestControl, NativeHostTestControlOptions }
// Generated mobile test hosts consume these through this registered host-testing entry point.
export { captureNativeNavigationDiagnostics, subscribeNativeNavigationDiagnostics } from '../TR-navigation-native-hosts'

/**
 * Binds the active host-test environment to its run-scoped native URL scheme. The control URL
 * does not navigate the product; it advances the production clock for the matching test run.
 */
export function installNativeHostTestControl(
  environment: HostTestEnvironment,
  options: NativeHostTestControlOptions = {},
): NativeHostTestControl {
  return attachNativeHostTestControl(environment, Linking, options)
}
