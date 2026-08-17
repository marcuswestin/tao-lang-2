export type TaoStyleInput = unknown

export type TaoStyleObject = Record<string, unknown>

export type TaoStyleSheetDriver = {
  absoluteFill: TaoStyleObject
  absoluteFillObject: TaoStyleObject
  compose(style1: TaoStyleInput, style2: TaoStyleInput): TaoStyleInput
  create<T extends Record<string, TaoStyleObject>>(styles: T): T
  flatten(style: TaoStyleInput): TaoStyleObject | undefined
  hairlineWidth: number
}

let testDriver: TaoStyleSheetDriver | undefined

/** StyleSheet exposes React Native style-sheet helpers. */
export const StyleSheet = {
  /** create delegates style registration to React Native StyleSheet.create. */
  create<T extends Record<string, TaoStyleObject>>(styles: T): T {
    return styleSheetDriver().create(styles)
  },

  /** flatten resolves React Native style arrays and registered styles into one object. */
  flatten(style: TaoStyleInput): TaoStyleObject | undefined {
    return styleSheetDriver().flatten(style)
  },

  /** compose combines two React Native style values. */
  compose(style1: TaoStyleInput, style2: TaoStyleInput): TaoStyleInput {
    return styleSheetDriver().compose(style1, style2)
  },

  /** absoluteFill returns React Native's absolute-fill style token. */
  absoluteFill(): TaoStyleObject {
    return styleSheetDriver().absoluteFill
  },

  /** absoluteFillObject returns React Native's absolute-fill object style. */
  absoluteFillObject(): TaoStyleObject {
    return styleSheetDriver().absoluteFillObject
  },

  /** hairlineWidth returns the thinnest visible line width for the current platform. */
  hairlineWidth(): number {
    return styleSheetDriver().hairlineWidth
  },

  /** setDriverForTests replaces React Native StyleSheet for deterministic runtime tests. */
  setDriverForTests(driver?: TaoStyleSheetDriver): void {
    testDriver = driver
  },
} as const

function styleSheetDriver(): TaoStyleSheetDriver {
  if (testDriver) {
    return testDriver
  }

  if (isJestRuntime()) {
    return {
      absoluteFill: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
      absoluteFillObject: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
      compose(style1, style2) {
        return [style1, style2]
      },
      create(styles) {
        return styles
      },
      flatten(style) {
        return flattenStyle(style)
      },
      hairlineWidth: 1,
    }
  }

  const RN = require('react-native') as { StyleSheet: TaoStyleSheetDriver }
  return RN.StyleSheet
}

function flattenStyle(style: TaoStyleInput): TaoStyleObject | undefined {
  if (style === undefined || style === null || style === false) {
    return undefined
  }
  if (Array.isArray(style)) {
    return style.reduce<TaoStyleObject>((flat, entry) => ({ ...flat, ...flattenStyle(entry) }), {})
  }
  return typeof style === 'object' ? style as TaoStyleObject : undefined
}

function isJestRuntime(): boolean {
  return typeof process !== 'undefined'
    && (process.env['JEST_WORKER_ID'] !== undefined || process.env['NODE_ENV'] === 'test')
}
