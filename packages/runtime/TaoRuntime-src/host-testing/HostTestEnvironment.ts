/** Browser-global host-test bridge over the shipped, host-neutral Effects session core. */

import {
  type Clock,
  createSession,
  InputError as HostTestControlError,
  type Session,
  type SessionConfig,
  type SessionSnapshot,
} from '../core/Effects'

const HOST_TEST_CONTROL_GLOBAL = '__TAO_HOST_TEST_CONTROL__'

export type HostTestEnvironmentConfig = SessionConfig
export type HostTestEnvironmentSnapshot = SessionSnapshot
export type HostTestClock = Clock
export type HostTestEnvironment = Session
export { HostTestControlError }

type HostTestControl = Readonly<{
  snapshot: () => HostTestEnvironmentSnapshot
  advance: (request: Readonly<{ runId: string; advanceMs: number }>) => HostTestEnvironmentSnapshot
  chooseRandom: (request: Readonly<{ runId: string; upperExclusive: number }>) => number
}>

type HostTestGlobal = typeof globalThis & {
  [HOST_TEST_CONTROL_GLOBAL]?: HostTestControl
}

/** Compatibility name for callers that intentionally create a pure host-test session. */
export function createHostTestEnvironment(
  config: HostTestEnvironmentConfig,
  clock: HostTestClock,
): HostTestEnvironment {
  return createSession(config, clock)
}

/** Installs the browser-visible bridge without replacing Date, Math.random, or any timer global. */
export function installHostTestControl(
  config: HostTestEnvironmentConfig,
  clock: HostTestClock,
): HostTestEnvironment {
  const target = globalThis as HostTestGlobal
  if (target[HOST_TEST_CONTROL_GLOBAL] !== undefined) {
    throw new HostTestControlError('A Tao host-test control bridge is already installed in this JavaScript realm.')
  }
  const environment = createSession(config, clock)
  const control: HostTestControl = Object.freeze({
    snapshot: environment.snapshot,
    advance: request => environment.advanceControl(request.runId, request.advanceMs),
    chooseRandom: request => environment.chooseRandom(request.runId, request.upperExclusive),
  })
  target[HOST_TEST_CONTROL_GLOBAL] = control
  const dispose = environment.dispose
  return Object.freeze({
    ...environment,
    dispose(): void {
      if (target[HOST_TEST_CONTROL_GLOBAL] === control) {
        delete target[HOST_TEST_CONTROL_GLOBAL]
      }
      dispose()
    },
  })
}
