import { type TaoActionFactory, type TaoActionValue, type TaoEvaluable } from './TR-action-values'
import { createReactiveSource, markReactiveValue, type TaoReactiveValue } from './TR-reactive'

type NativeModules = {
  required<T>(capability: string, moduleName: 'expo-clipboard'): T
}

type ExpoClipboard = {
  getStringAsync(): Promise<string>
  setStringAsync(value: string): Promise<void>
}

/** TaoPasteboard is the reactive value returned by `@tao/device/clipboard`'s `Clipboard()`. */
export type TaoPasteboard = TaoReactiveValue & {
  readonly Value: string | null
  readonly Copy: TaoActionValue<[TaoEvaluable<string>]>
  readonly Read: TaoActionValue<[]>
}

/**
 * createClipboard builds one pasteboard without loading Expo until an action runs. Read publishes
 * only a completed native result; a rejected read leaves the last successful value unchanged.
 */
export function createClipboard(asAction: TaoActionFactory, native: NativeModules): TaoPasteboard {
  const changes = createReactiveSource()
  let value: string | null = null
  let latestRead = 0

  return markReactiveValue({
    get Value() {
      return value
    },
    Copy: asAction(async text => {
      const clipboard = native.required<ExpoClipboard>('Clipboard', 'expo-clipboard')
      await clipboard.setStringAsync(text.evaluate().jsValue)
    }),
    Read: asAction(async () => {
      const read = ++latestRead
      const clipboard = native.required<ExpoClipboard>('Clipboard', 'expo-clipboard')
      const nextValue = await clipboard.getStringAsync()
      if (read !== latestRead) {
        return
      }
      value = nextValue
      changes.notify()
    }),
    subscribe: changes.subscribe,
  })
}
