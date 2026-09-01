import { errorMessage, HostEnvironmentError } from './TR-errors'
import { type ReactNativeRuntime, requireReactNativeRuntime } from './TR-react-native'

/** The native modules used by Tao's curated device capabilities. */
export type NativeModuleName = 'expo-clipboard' | 'expo-haptics' | 'react-native'

/** NativeModuleLoaders is the internal module-level test seam behind the production singleton. */
export type NativeModuleLoaders = Record<NativeModuleName, () => unknown>

/** TaoNativeModules is the lazy module access available to runtime capability implementations. */
export type TaoNativeModules = {
  optional<T>(capability: string, moduleName: NativeModuleName): T | undefined
  platform(): string | undefined
  required<T>(capability: string, moduleName: NativeModuleName): T
}

type NativeModuleResult =
  | { kind: 'available'; value: unknown }
  | { cause?: unknown; kind: 'unavailable' }

/** createNativeModules builds an isolated lazy module boundary for production or module-level tests. */
export function createNativeModules(loaders: NativeModuleLoaders): TaoNativeModules {
  const cache = new Map<NativeModuleName, NativeModuleResult>()

  const loadNativeModule = (moduleName: NativeModuleName): NativeModuleResult => {
    if (!cache.has(moduleName)) {
      try {
        const nativeModule = loaders[moduleName]()
        cache.set(
          moduleName,
          isEmptyModule(nativeModule)
            ? { kind: 'unavailable' }
            : { kind: 'available', value: nativeModule },
        )
      } catch (cause) {
        cache.set(moduleName, { cause, kind: 'unavailable' })
      }
    }
    return cache.get(moduleName)!
  }

  const optionalNativeModule = <T>(moduleName: NativeModuleName): T | undefined => {
    const result = loadNativeModule(moduleName)
    return result.kind === 'available' ? result.value as T : undefined
  }

  return {
    optional<T>(_capability: string, moduleName: NativeModuleName): T | undefined {
      return optionalNativeModule<T>(moduleName)
    },
    platform(): string | undefined {
      return optionalNativeModule<ReactNativeRuntime>('react-native')?.Platform?.OS
    },
    required<T>(capability: string, moduleName: NativeModuleName): T {
      const result = loadNativeModule(moduleName)
      if (result.kind === 'unavailable') {
        if (result.cause !== undefined) {
          throw new HostEnvironmentError(
            `Tao's ${capability} capability could not load native module '${moduleName}': `
              + `${errorMessage(result.cause)}. Check native linking and dependency compatibility.`,
            { cause: result.cause, details: { capability, moduleName } },
          )
        }
        throw new HostEnvironmentError(
          `Tao's ${capability} capability requires the native module '${moduleName}', `
            + 'but it is unavailable. Install the module and run on a supported native platform.',
          { details: { capability, moduleName } },
        )
      }
      return result.value as T
    },
  }
}

function isEmptyModule(value: unknown): boolean {
  return typeof value === 'object' && value !== null && Object.keys(value).length === 0
}

// Metro resolves require calls statically, so each supported module must remain a literal here.
// The loader functions keep module evaluation lazy until a capability is actually invoked.
export const NativeModules = createNativeModules({
  'expo-clipboard': () => require('expo-clipboard'),
  'expo-haptics': () => require('expo-haptics'),
  'react-native': requireReactNativeRuntime,
})
