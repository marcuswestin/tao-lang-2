import { HostEnvironmentError } from './TR-errors'
import { NativeModules, type TaoNativeModules } from './TR-native-modules'

type ExpoModulesCore = {
  requireNativeModule: unknown
}

type ContinuousClock = {
  nowMilliseconds: unknown
}

/** Create a lazy getter for the native clock used by sleep-inclusive timers. */
export function createContinuousClockNowMilliseconds(
  nativeModules: TaoNativeModules = NativeModules,
): () => number {
  let clock: ContinuousClock | undefined

  return () => {
    clock ??= loadContinuousClock(nativeModules)

    let reading: unknown
    try {
      reading = (clock.nowMilliseconds as () => unknown)()
    } catch (cause) {
      throw asHostEnvironmentError(cause, 'The native continuous clock could not be read.')
    }

    if (typeof reading !== 'number' || !Number.isFinite(reading) || reading < 0) {
      throw new HostEnvironmentError('The native continuous clock returned an invalid reading.')
    }
    return reading
  }
}

/** The production clock getter; native modules remain unloaded until the first sample. */
export const nowMilliseconds = createContinuousClockNowMilliseconds()

function loadContinuousClock(nativeModules: TaoNativeModules): ContinuousClock {
  try {
    const platform = nativeModules.platform()
    if (platform !== 'ios' && platform !== 'android') {
      throw new HostEnvironmentError(
        'The native continuous clock is available only on iOS and Android.',
        { details: { platform } },
      )
    }

    const expoCore = nativeModules.required<ExpoModulesCore>('Time.StartTimer', 'expo-modules-core')
    if (typeof expoCore.requireNativeModule !== 'function') {
      throw new HostEnvironmentError('The native module loader is unavailable for the continuous clock.')
    }

    const clock = (expoCore.requireNativeModule as <Module>(name: string) => Module)(
      'TaoContinuousClock',
    ) as ContinuousClock
    if (
      typeof clock !== 'object'
      || clock === null
      || typeof clock.nowMilliseconds !== 'function'
    ) {
      throw new HostEnvironmentError('The native continuous clock module is unavailable or invalid.')
    }
    return clock
  } catch (cause) {
    throw asHostEnvironmentError(cause, 'The native continuous clock could not be loaded.')
  }
}

function asHostEnvironmentError(cause: unknown, message: string): HostEnvironmentError {
  return cause instanceof HostEnvironmentError
    ? cause
    : new HostEnvironmentError(message, { cause })
}
