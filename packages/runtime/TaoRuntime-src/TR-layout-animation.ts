export type TaoLayoutAnimationPreset = 'easeInEaseOut' | 'linear' | 'spring'

export type TaoLayoutAnimationType = 'easeInEaseOut' | 'keyboard' | 'linear' | 'spring'

export type TaoLayoutAnimationProperty = 'opacity' | 'scaleX' | 'scaleXY' | 'scaleY'

export type TaoLayoutAnimationConfig = Record<string, unknown>

export type TaoLayoutAnimationCallbacks = {
  end?: TaoLayoutAnimationCompleteAction
  fail?: TaoLayoutAnimationCompleteAction
}

export type TaoLayoutAnimationAction = {
  invoke(): void
}

export type TaoLayoutAnimationCompleteAction = {
  invoke(): void
}

export type TaoLayoutAnimationDriver = {
  configureNext(config: TaoLayoutAnimationConfig, onEnd?: () => void, onFail?: () => void): void
  create(
    duration: number,
    type: TaoLayoutAnimationType,
    property: TaoLayoutAnimationProperty,
  ): TaoLayoutAnimationConfig
  Presets: Record<TaoLayoutAnimationPreset, TaoLayoutAnimationConfig>
}

let testDriver: TaoLayoutAnimationDriver | undefined

/** LayoutAnimation exposes React Native layout transition helpers. */
export const LayoutAnimation = {
  /** configureNext applies a native transition to the next layout change. */
  configureNext(config: TaoLayoutAnimationConfig, callbacks: TaoLayoutAnimationCallbacks = {}): void {
    layoutAnimationDriver().configureNext(
      config,
      callbacks.end ? () => callbacks.end?.invoke() : undefined,
      callbacks.fail ? () => callbacks.fail?.invoke() : undefined,
    )
  },

  /** preset applies a named React Native layout-animation preset to the next layout change. */
  preset(preset: TaoLayoutAnimationPreset = 'easeInEaseOut', callbacks: TaoLayoutAnimationCallbacks = {}): void {
    LayoutAnimation.configureNext(LayoutAnimation.config(preset), callbacks)
  },

  /** presetAction creates a Pressable-compatible action that configures the next layout animation. */
  presetAction(
    preset: TaoLayoutAnimationPreset = 'easeInEaseOut',
    callbacks: TaoLayoutAnimationCallbacks = {},
    configured?: TaoLayoutAnimationCompleteAction,
  ): TaoLayoutAnimationAction {
    return {
      invoke() {
        LayoutAnimation.preset(preset, callbacks)
        configured?.invoke()
      },
    }
  },

  /** completeAction adapts layout-animation completion into a LayoutAnimation-compatible action. */
  completeAction(work: () => void): TaoLayoutAnimationCompleteAction {
    return {
      invoke() {
        work()
      },
    }
  },

  /** config returns a named React Native layout-animation preset config. */
  config(preset: TaoLayoutAnimationPreset = 'easeInEaseOut'): TaoLayoutAnimationConfig {
    return layoutAnimationDriver().Presets[preset]
  },

  /** create builds a React Native layout-animation config from primitive settings. */
  create(
    duration: number,
    type: TaoLayoutAnimationType = 'easeInEaseOut',
    property: TaoLayoutAnimationProperty = 'opacity',
  ): TaoLayoutAnimationConfig {
    return layoutAnimationDriver().create(duration, type, property)
  },

  /** setDriverForTests replaces React Native LayoutAnimation for deterministic runtime tests. */
  setDriverForTests(driver?: TaoLayoutAnimationDriver): void {
    testDriver = driver
  },
} as const

function layoutAnimationDriver(): TaoLayoutAnimationDriver {
  if (testDriver) {
    return testDriver
  }

  if (isJestRuntime()) {
    return {
      configureNext(_config, onEnd) {
        onEnd?.()
      },
      create(duration, type, property) {
        return { duration, property, type }
      },
      Presets: {
        easeInEaseOut: { preset: 'easeInEaseOut' },
        linear: { preset: 'linear' },
        spring: { preset: 'spring' },
      },
    }
  }

  const RN = require('react-native') as { LayoutAnimation: TaoLayoutAnimationDriver }
  return RN.LayoutAnimation
}

function isJestRuntime(): boolean {
  return typeof process !== 'undefined'
    && (process.env['JEST_WORKER_ID'] !== undefined || process.env['NODE_ENV'] === 'test')
}
