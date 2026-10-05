import { Describe, Expect, Test } from '@shared/test'
import {
  createContinuousClockNowMilliseconds,
} from '../TaoRuntime-src/TR-continuous-clock'
import { HostEnvironmentError } from '../TaoRuntime-src/TR-errors'
import type { TaoNativeModules } from '../TaoRuntime-src/TR-native-modules'

type ClockModule = { nowMilliseconds: () => unknown }

function nativeModules(
  required: TaoNativeModules['required'],
  platform = 'ios',
): TaoNativeModules {
  return {
    optional: () => undefined,
    platform: () => platform,
    required,
  }
}

Describe('native continuous clock loader', () => {
  Test('loads lazily once and reads successive native millisecond samples', () => {
    const samples = [12.5, 42.75]
    let moduleLoads = 0
    let clockLoads = 0
    const clock: ClockModule = { nowMilliseconds: () => samples.shift() }
    const getter = createContinuousClockNowMilliseconds(nativeModules(<T>(capability: string, name: string) => {
      moduleLoads += 1
      Expect([capability, name]).toEqual(['Time.StartTimer', 'expo-modules-core'])
      return {
        requireNativeModule: (moduleName: string) => {
          clockLoads += 1
          Expect(moduleName).toBe('TaoContinuousClock')
          return clock
        },
      } as T
    }))

    Expect([moduleLoads, clockLoads]).toEqual([0, 0])
    Expect([getter(), getter()]).toEqual([12.5, 42.75])
    Expect([moduleLoads, clockLoads]).toEqual([1, 1])
  })

  Test('rejects web before loading Expo modules', () => {
    let moduleLoads = 0
    const getter = createContinuousClockNowMilliseconds(nativeModules(<T>() => {
      moduleLoads += 1
      return {
        requireNativeModule: () => ({ nowMilliseconds: () => 10 }),
      } as T
    }, 'web'))

    Expect(() => getter()).toThrow(HostEnvironmentError)
    Expect(moduleLoads).toBe(0)
  })

  Test('admits Android and returns its native millisecond sample', () => {
    const getter = createContinuousClockNowMilliseconds(nativeModules(<T>() =>
      ({
        requireNativeModule: (name: string) => {
          Expect(name).toBe('TaoContinuousClock')
          return { nowMilliseconds: () => 45.5 }
        },
      }) as T, 'android'))

    Expect(getter()).toBe(45.5)
  })

  Test('classifies a missing native module as a host failure and preserves its identity', () => {
    const unavailable = new HostEnvironmentError('No native clock is linked.')
    const getter = createContinuousClockNowMilliseconds(nativeModules(() => {
      throw unavailable
    }))

    Expect(() => getter()).toThrow(HostEnvironmentError)
    Expect(() => getter()).toThrow(unavailable)
  })

  Test('wraps Expo module lookup failures as host failures with their cause', () => {
    const failure = { message: 'Expo module lookup failed.' }
    const getter = createContinuousClockNowMilliseconds(nativeModules(<T>() =>
      ({
        requireNativeModule: () => {
          throw failure
        },
      }) as T
    ))

    let thrown: unknown
    try {
      getter()
    } catch (error) {
      thrown = error
    }
    Expect(thrown).toBeInstanceOf(HostEnvironmentError)
    Expect((thrown as HostEnvironmentError).cause).toBe(failure)
  })

  Test('rejects an Expo core or clock module with an invalid shape', () => {
    const missingLoader = createContinuousClockNowMilliseconds(nativeModules(<T>() => ({}) as T))
    const missingClock = createContinuousClockNowMilliseconds(nativeModules(<T>() =>
      ({
        requireNativeModule: () => ({}),
      }) as T
    ))

    Expect(() => missingLoader()).toThrow(HostEnvironmentError)
    Expect(() => missingClock()).toThrow(HostEnvironmentError)
  })

  Test('wraps native clock failures and preserves existing host failures', () => {
    const nativeFailure = { message: 'Native clock read failed.' }
    const getter = createContinuousClockNowMilliseconds(nativeModules(<T>() =>
      ({
        requireNativeModule: () => ({
          nowMilliseconds: () => {
            throw nativeFailure
          },
        }),
      }) as T
    ))

    let thrown: unknown
    try {
      getter()
    } catch (error) {
      thrown = error
    }
    Expect(thrown).toBeInstanceOf(HostEnvironmentError)
    Expect((thrown as HostEnvironmentError).cause).toBe(nativeFailure)

    const hostFailure = new HostEnvironmentError('Native host clock unavailable.')
    const hostGetter = createContinuousClockNowMilliseconds(nativeModules(<T>() =>
      ({
        requireNativeModule: () => ({
          nowMilliseconds: () => {
            throw hostFailure
          },
        }),
      }) as T
    ))
    Expect(() => hostGetter()).toThrow(hostFailure)
  })

  Test('rejects malformed native readings', () => {
    const readings: unknown[] = [Number.NaN, Number.POSITIVE_INFINITY, -1, '100', undefined]
    for (const reading of readings) {
      const getter = createContinuousClockNowMilliseconds(nativeModules(<T>() =>
        ({
          requireNativeModule: () => ({ nowMilliseconds: () => reading }),
        }) as T
      ))
      Expect(() => getter()).toThrow(HostEnvironmentError)
    }
  })
})
