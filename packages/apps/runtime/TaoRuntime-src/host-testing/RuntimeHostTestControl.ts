/** Explicit production-runtime adapter for a host test. Never exported by @runtime/TR. */

import { ErrorControls } from '../TR-errors'
import { Clock } from '../TR-units'
import {
  type HostTestClock,
  type HostTestEnvironment,
  type HostTestEnvironmentConfig,
  installHostTestControl,
} from './HostTestEnvironment'

const runtimeClock: HostTestClock = {
  begin: epochMs => Clock.beginTest(epochMs),
  now: () => Clock.now(),
  advance: advanceMs => Clock.advance(advanceMs),
  end: () => Clock.endTest(),
}

let activeRuntimeEnvironment: HostTestEnvironment | undefined

/**
 * Starts the sole TR.Clock-backed environment in this browser or native realm. Browser contexts
 * load separate module realms, so their runtime clock, random stream, and bridge stay isolated.
 */
export function installRuntimeHostTestControl(config: HostTestEnvironmentConfig): HostTestEnvironment {
  if (activeRuntimeEnvironment !== undefined) {
    ErrorControls.failInput('A Tao host-test runtime environment is already active in this JavaScript realm.')
  }
  const environment = installHostTestControl(config, runtimeClock)
  const dispose = environment.dispose
  activeRuntimeEnvironment = environment
  return Object.freeze({
    ...environment,
    dispose(): void {
      dispose()
      if (activeRuntimeEnvironment === environment) {
        activeRuntimeEnvironment = undefined
      }
    },
  })
}
