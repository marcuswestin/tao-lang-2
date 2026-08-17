export type TaoPixelRatioDriver = {
  get(): number
  getFontScale(): number
  getPixelSizeForLayoutSize(layoutSize: number): number
  roundToNearestPixel(layoutSize: number): number
}

let testDriver: TaoPixelRatioDriver | undefined

/** PixelRatio exposes React Native pixel-density helpers. */
export const PixelRatio = {
  /** get reads the native device pixel ratio. */
  get(): number {
    return pixelRatioDriver().get()
  },

  /** fontScale reads the native font scaling ratio. */
  fontScale(): number {
    return pixelRatioDriver().getFontScale()
  },

  /** pixelSize converts a layout size into native pixel size. */
  pixelSize(layoutSize: number): number {
    return pixelRatioDriver().getPixelSizeForLayoutSize(layoutSize)
  },

  /** round rounds a layout size to the nearest native pixel. */
  round(layoutSize: number): number {
    return pixelRatioDriver().roundToNearestPixel(layoutSize)
  },

  /** setDriverForTests replaces React Native PixelRatio for deterministic runtime tests. */
  setDriverForTests(driver?: TaoPixelRatioDriver): void {
    testDriver = driver
  },
} as const

function pixelRatioDriver(): TaoPixelRatioDriver {
  if (testDriver) {
    return testDriver
  }

  if (isJestRuntime()) {
    return {
      get() {
        return 1
      },
      getFontScale() {
        return 1
      },
      getPixelSizeForLayoutSize(layoutSize) {
        return Math.round(layoutSize)
      },
      roundToNearestPixel(layoutSize) {
        return Math.round(layoutSize)
      },
    }
  }

  const RN = require('react-native') as { PixelRatio: TaoPixelRatioDriver }
  return RN.PixelRatio
}

function isJestRuntime(): boolean {
  return typeof process !== 'undefined'
    && (process.env['JEST_WORKER_ID'] !== undefined || process.env['NODE_ENV'] === 'test')
}
