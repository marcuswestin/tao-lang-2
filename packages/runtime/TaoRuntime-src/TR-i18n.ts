export type TaoTextDirection = 'ltr' | 'rtl'

export type TaoI18nInfo = {
  direction: TaoTextDirection
  isRTL: boolean
  swapsLeftAndRight: boolean
}

export type TaoI18nDriver = {
  allowRTL(allowRTL: boolean): void
  doLeftAndRightSwapInRTL?: boolean
  forceRTL(forceRTL: boolean): void
  isRTL?: boolean
  swapLeftAndRightInRTL(swapLeftAndRight: boolean): void
}

let testDriver: TaoI18nDriver | undefined

/** I18n exposes React Native internationalization layout-direction helpers. */
export const I18n = {
  /** info reads normalized native layout-direction settings. */
  info(): TaoI18nInfo {
    const driver = i18nDriver()
    const isRTL = driver.isRTL === true
    return {
      direction: isRTL ? 'rtl' : 'ltr',
      isRTL,
      swapsLeftAndRight: driver.doLeftAndRightSwapInRTL === true,
    }
  },

  /** direction reads the current normalized native layout direction. */
  direction(): TaoTextDirection {
    return I18n.info().direction
  },

  /** allowRTL delegates to React Native I18nManager.allowRTL. */
  allowRTL(allowRTL = true): void {
    i18nDriver().allowRTL(allowRTL)
  },

  /** forceRTL delegates to React Native I18nManager.forceRTL. */
  forceRTL(forceRTL = true): void {
    i18nDriver().forceRTL(forceRTL)
  },

  /** swapLeftAndRightInRTL delegates to React Native I18nManager.swapLeftAndRightInRTL. */
  swapLeftAndRightInRTL(swapLeftAndRight = true): void {
    i18nDriver().swapLeftAndRightInRTL(swapLeftAndRight)
  },

  /** setDriverForTests replaces React Native I18nManager for deterministic runtime tests. */
  setDriverForTests(driver?: TaoI18nDriver): void {
    testDriver = driver
  },
} as const

function i18nDriver(): TaoI18nDriver {
  if (testDriver) {
    return testDriver
  }

  if (isJestRuntime()) {
    return {
      allowRTL() {},
      forceRTL() {},
      isRTL: false,
      swapLeftAndRightInRTL() {},
    }
  }

  const RN = require('react-native') as { I18nManager: TaoI18nDriver }
  return RN.I18nManager
}

function isJestRuntime(): boolean {
  return typeof process !== 'undefined'
    && (process.env['JEST_WORKER_ID'] !== undefined || process.env['NODE_ENV'] === 'test')
}
