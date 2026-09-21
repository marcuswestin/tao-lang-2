import { Describe, Expect, Test } from '@shared/test'
import { HostEnvironmentError } from '../TaoRuntime-src/TR-errors'
import { createNativeModules, loadRandomValuesPolyfill } from '../TaoRuntime-src/TR-native-modules'
import { createReactiveSource, isReactiveValue } from '../TaoRuntime-src/TR-reactive'
import { Clock, createTicker } from '../TaoRuntime-src/TR-units'

Describe('TR native module kernel', () => {
  Test('loads an available module lazily and caches it', () => {
    let clipboardLoads = 0
    const clipboardModule = { getStringAsync: async () => 'copied' }
    const nativeModules = createNativeModules({
      'expo-clipboard': () => {
        clipboardLoads += 1
        return clipboardModule
      },
      'expo-haptics': () => ({}),
      'react-native': () => ({}),
    })

    Expect(clipboardLoads).toBe(0)
    const loaded = nativeModules.optional('Clipboard', 'expo-clipboard')

    Expect(loaded).toBe(clipboardModule)
    Expect(nativeModules.required('Clipboard', 'expo-clipboard')).toBe(loaded)
    Expect(clipboardLoads).toBe(1)
  })

  Test('returns nothing for an optional missing module', () => {
    let hapticsLoads = 0
    const nativeModules = createNativeModules({
      'expo-clipboard': () => ({}),
      'expo-haptics': () => {
        hapticsLoads += 1
        throw new HostEnvironmentError('expo-haptics is unavailable in this test')
      },
      'react-native': () => ({}),
    })

    Expect(nativeModules.optional('Haptic', 'expo-haptics')).toBeUndefined()
    Expect(hapticsLoads).toBe(1)
  })

  Test('treats Metro empty-module fallbacks as missing', () => {
    const nativeModules = createNativeModules({
      'expo-clipboard': () => ({}),
      'expo-haptics': () => ({ selectionAsync() {} }),
      'react-native': () => ({ Share: {} }),
    })

    Expect(nativeModules.optional('Clipboard', 'expo-clipboard')).toBeUndefined()
    Expect(() => nativeModules.required('Clipboard', 'expo-clipboard')).toThrow(
      "Tao's Clipboard capability requires the native module 'expo-clipboard'",
    )
  })

  Test('reports the random-values polyfill by the global it installs', () => {
    const globals = globalThis as { crypto?: unknown }
    const original = globals.crypto
    try {
      globals.crypto = undefined
      Expect(loadRandomValuesPolyfill(() => {})).toEqual({})
      const installed = { getRandomValues: () => {} }
      Expect(loadRandomValuesPolyfill(() => {
        globals.crypto = installed
      })).toBe(installed)
    } finally {
      globals.crypto = original
    }
  })

  Test('treats the installed random-values polyfill as an available module', () => {
    const globals = globalThis as { crypto?: unknown }
    const original = globals.crypto
    try {
      globals.crypto = undefined
      const nativeModules = createNativeModules({
        'react-native-get-random-values': () =>
          loadRandomValuesPolyfill(() => {
            globals.crypto = { getRandomValues: () => {} }
          }),
      })

      Expect(nativeModules.required('Studio device pairing', 'react-native-get-random-values'))
        .toBe(globals.crypto)
    } finally {
      globals.crypto = original
    }
  })

  Test('preserves the loader cause when a required module fails during evaluation', () => {
    let hapticsLoads = 0
    const nativeModules = createNativeModules({
      'expo-clipboard': () => ({}),
      'expo-haptics': () => {
        hapticsLoads += 1
        throw new HostEnvironmentError('expo-haptics is unavailable in this test')
      },
      'react-native': () => ({}),
    })

    Expect(() => nativeModules.required('Haptic', 'expo-haptics')).toThrow(
      "Tao's Haptic capability could not load native module 'expo-haptics': "
        + 'expo-haptics is unavailable in this test.',
    )
    Expect(() => nativeModules.required('Haptic', 'expo-haptics')).toThrow(
      'Check native linking and dependency compatibility.',
    )
    Expect(hapticsLoads).toBe(1)
  })

  Test('reports the cached React Native platform through the shared kernel path', () => {
    let reactNativeLoads = 0
    const nativeModules = createNativeModules({
      'expo-clipboard': () => ({ getStringAsync() {} }),
      'expo-haptics': () => ({ selectionAsync() {} }),
      'react-native': () => {
        reactNativeLoads += 1
        return { Platform: { OS: 'android' } }
      },
    })

    Expect(nativeModules.platform()).toBe('android')
    Expect(nativeModules.platform()).toBe('android')
    Expect(reactNativeLoads).toBe(1)
  })
})

Describe('TR reactive source', () => {
  Test('notifies independent subscriptions and tracks their lifetime', () => {
    const source = createReactiveSource()
    let notifications = 0
    const listener = () => notifications += 1
    const unsubscribeFirst = source.subscribe(listener)
    const unsubscribeSecond = source.subscribe(listener)

    Expect(source.listenerCount).toBe(2)
    source.notify()
    Expect(notifications).toBe(2)

    unsubscribeFirst()
    unsubscribeFirst()
    Expect(source.listenerCount).toBe(1)
    source.notify()
    Expect(notifications).toBe(3)

    unsubscribeSecond()
    Expect(source.listenerCount).toBe(0)
  })

  Test('preserves ticker scheduling across first subscribe and last unsubscribe', () => {
    Clock.beginTest()
    try {
      const ticker = createTicker(1e9, body => ({ invoke: body }))
      const initialValue = ticker.Value
      let notifications = 0

      Clock.advance(1000)
      Expect(ticker.Value).toBe(initialValue)

      const unsubscribe = ticker.subscribe(() => notifications += 1)
      Clock.advance(1000)
      Expect(ticker.Value).toBe(initialValue + 2000)
      Expect(notifications).toBe(1)

      unsubscribe()
      Clock.advance(1000)
      Expect(ticker.Value).toBe(initialValue + 2000)
      Expect(notifications).toBe(1)
    } finally {
      Clock.endTest()
    }
  })

  Test('recognizes only branded runtime-owned reactive values', () => {
    const source = createReactiveSource()

    Expect(isReactiveValue(source)).toBe(true)
    Expect(isReactiveValue({ subscribe: () => ({ unsubscribe() {} }) })).toBe(false)
    Expect(isReactiveValue({ subscribe: () => () => {} })).toBe(false)
    Expect(isReactiveValue({ subscribe: true })).toBe(false)
    Expect(isReactiveValue(undefined)).toBe(false)
  })
})
