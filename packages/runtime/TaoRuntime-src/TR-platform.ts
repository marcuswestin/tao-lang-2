export type TaoPlatformOS = 'android' | 'ios' | 'macos' | 'native' | 'unknown' | 'web' | 'windows'

export type TaoPlatformInfo = {
  isNative: boolean
  isWeb: boolean
  os: TaoPlatformOS
}

export type TaoPlatformSelectOptions<T> = Partial<Record<TaoPlatformOS | 'default', T>>

export type TaoPlatformDriver = {
  OS?: string
}

let testDriver: TaoPlatformDriver | undefined

/** Platform exposes React Native platform helpers for generated Tao apps. */
export const Platform = {
  /** info reads normalized current platform details. */
  info(): TaoPlatformInfo {
    return platformInfo(platformDriver().OS)
  },

  /** select resolves the best matching value for the current platform. */
  select<T>(options: TaoPlatformSelectOptions<T>): T | undefined {
    const info = Platform.info()
    return options[info.os] ?? (info.isNative ? options.native : undefined) ?? options.default
  },

  /** setDriverForTests replaces React Native Platform for deterministic runtime tests. */
  setDriverForTests(driver?: TaoPlatformDriver): void {
    testDriver = driver
  },
} as const

function platformDriver(): TaoPlatformDriver {
  if (testDriver) {
    return testDriver
  }

  if (isJestRuntime()) {
    return { OS: 'web' }
  }

  const RN = require('react-native') as { Platform: TaoPlatformDriver }
  return RN.Platform
}

function platformInfo(os: string | undefined): TaoPlatformInfo {
  const normalized = normalizePlatformOS(os)
  return {
    isNative: normalized !== 'unknown' && normalized !== 'web',
    isWeb: normalized === 'web',
    os: normalized,
  }
}

function normalizePlatformOS(os: string | undefined): TaoPlatformOS {
  return os === 'android' || os === 'ios' || os === 'macos' || os === 'web' || os === 'windows' ? os : 'unknown'
}

function isJestRuntime(): boolean {
  return typeof process !== 'undefined'
    && (process.env['JEST_WORKER_ID'] !== undefined || process.env['NODE_ENV'] === 'test')
}
