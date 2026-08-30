import { Describe, Expect, Test } from '@shared/test'
import { createClipboard } from '../TaoRuntime-src/TR-clipboard'
import { createNativeModules } from '../TaoRuntime-src/TR-native-modules'

type ActionValue<Args extends any[] = any[]> = { invoke(...args: Args): void | Promise<void> }
type ClipboardModule = {
  getStringAsync(): Promise<string>
  setStringAsync(text: string): Promise<void>
}

const asAction = <Args extends any[]>(body: (...args: Args) => unknown): ActionValue<Args> => ({
  invoke: (...args) => {
    const result = body(...args)
    return isPromiseLike(result) ? Promise.resolve(result).then(() => undefined) : undefined
  },
})

const value = (jsValue: string) => ({ evaluate: () => ({ jsValue }) })

Describe('TR Clipboard', () => {
  Test('does not load expo-clipboard until an action runs, then copies evaluated text', async () => {
    const copiedText: string[] = []
    const module = {
      getStringAsync: async () => '',
      setStringAsync: async (text: string) => {
        copiedText.push(text)
      },
    }
    const { native, requiredCalls } = nativeClipboard(module)
    const pasteboard = createClipboard(asAction, native)

    Expect(requiredCalls()).toBe(0)
    Expect(pasteboard.Value).toBeNull()
    await pasteboard.Copy.invoke(value('Draft'))

    Expect(requiredCalls()).toBe(1)
    Expect(copiedText).toEqual(['Draft'])
    Expect(pasteboard.Value).toBeNull()
  })

  Test('reports the capability and missing module when Copy cannot load its native backing', async () => {
    const missingNative = createNativeModules({
      'expo-clipboard': () => {
        throw new Error('clipboard test module is not linked')
      },
      'expo-haptics': () => ({}),
      'react-native': () => ({ Platform: { OS: 'ios' } }),
    })
    const pasteboard = createClipboard(asAction, missingNative)

    await Expect(pasteboard.Copy.invoke(value('Draft'))).rejects.toThrow(
      "Tao's Clipboard capability could not load native module 'expo-clipboard': "
        + 'clipboard test module is not linked.',
    )
  })

  Test('reads text into Value and notifies reactive subscribers after completion', async () => {
    let notifications = 0
    let finishRead!: (text: string) => void
    let readClipboard = () =>
      new Promise<string>(resolve => {
        finishRead = resolve
      })
    const { native, requiredCalls } = nativeClipboard({
      getStringAsync: () => readClipboard(),
      setStringAsync: async () => {},
    })
    const pasteboard = createClipboard(asAction, native)
    const unsubscribe = pasteboard.subscribe(() => notifications += 1)

    Expect(pasteboard.Value).toBeNull()
    Expect(requiredCalls()).toBe(0)
    const reading = pasteboard.Read.invoke()
    Expect(pasteboard.Value).toBeNull()
    Expect(notifications).toBe(0)
    Expect(requiredCalls()).toBe(1)

    finishRead('From the system pasteboard')
    await reading

    Expect(pasteboard.Value).toBe('From the system pasteboard')
    Expect(notifications).toBe(1)

    readClipboard = async () => 'A newer value'
    await pasteboard.Read.invoke()
    Expect(pasteboard.Value).toBe('A newer value')
    Expect(notifications).toBe(2)

    unsubscribe()
    readClipboard = async () => 'Unobserved'
    await pasteboard.Read.invoke()
    Expect(pasteboard.Value).toBe('Unobserved')
    Expect(notifications).toBe(2)
  })

  Test('keeps the newest concurrent Read result when an older read finishes last', async () => {
    const finishes: Array<(text: string) => void> = []
    const { native } = nativeClipboard({
      getStringAsync: () =>
        new Promise<string>(resolve => {
          finishes.push(resolve)
        }),
      setStringAsync: async () => {},
    })
    const pasteboard = createClipboard(asAction, native)
    let notifications = 0
    pasteboard.subscribe(() => notifications += 1)

    const olderRead = pasteboard.Read.invoke()
    const newerRead = pasteboard.Read.invoke()
    finishes[1]!('newer clipboard text')
    await newerRead
    finishes[0]!('stale clipboard text')
    await olderRead

    Expect(pasteboard.Value).toBe('newer clipboard text')
    Expect(notifications).toBe(1)
  })
})

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object'
    && value !== null
    && 'then' in value
    && typeof value.then === 'function'
}

function nativeClipboard(module: ClipboardModule) {
  let calls = 0
  return {
    native: {
      required<T>(capability: string, moduleName: 'expo-clipboard'): T {
        Expect(capability).toBe('Clipboard')
        Expect(moduleName).toBe('expo-clipboard')
        calls += 1
        return module as T
      },
    },
    requiredCalls: () => calls,
  }
}
