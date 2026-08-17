export type TaoNativeColorValue = unknown

export type TaoDynamicIOSColors = {
  dark: string
  highContrastDark?: string
  highContrastLight?: string
  light: string
}

export type TaoProcessedColor = number | undefined

export type TaoNativeColorDriver = {
  DynamicColorIOS?(colors: TaoDynamicIOSColors): TaoNativeColorValue
  PlatformColor(...colors: string[]): TaoNativeColorValue
  processColor?(color: TaoNativeColorValue): number | null | undefined
}

let testDriver: TaoNativeColorDriver | undefined

/** NativeColor exposes React Native platform-native color helpers. */
export const NativeColor = {
  /** platform creates a React Native PlatformColor from one or more native color names. */
  platform(...colors: string[]): TaoNativeColorValue {
    return nativeColorDriver().PlatformColor(...colors)
  },

  /** dynamicIOS creates a React Native DynamicColorIOS value when the platform supports it. */
  dynamicIOS(colors: TaoDynamicIOSColors): TaoNativeColorValue {
    const driver = nativeColorDriver()
    return driver.DynamicColorIOS ? driver.DynamicColorIOS(colors) : colors.light
  },

  /** process resolves a React Native color value to a native numeric color when available. */
  process(color: TaoNativeColorValue): TaoProcessedColor {
    return nativeColorDriver().processColor?.(color) ?? undefined
  },

  /** setDriverForTests replaces React Native native-color helpers for deterministic runtime tests. */
  setDriverForTests(driver?: TaoNativeColorDriver): void {
    testDriver = driver
  },
} as const

function nativeColorDriver(): TaoNativeColorDriver {
  if (testDriver) {
    return testDriver
  }

  if (isJestRuntime()) {
    return {
      PlatformColor(...colors) {
        return { platformColors: colors }
      },
      DynamicColorIOS(colors) {
        return { dynamicIOS: colors }
      },
      processColor() {
        return undefined
      },
    }
  }

  const RN = require('react-native') as TaoNativeColorDriver
  return RN
}

function isJestRuntime(): boolean {
  return typeof process !== 'undefined'
    && (process.env['JEST_WORKER_ID'] !== undefined || process.env['NODE_ENV'] === 'test')
}
