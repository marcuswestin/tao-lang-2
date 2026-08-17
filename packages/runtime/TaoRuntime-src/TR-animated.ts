export type TaoAnimatedValue = unknown

export type TaoAnimatedComposite = {
  start(callback?: (result: { finished: boolean }) => void): void
  stop?(): void
}

export type TaoAnimatedTimingConfig = {
  duration?: number
  easing?: (value: number) => number
  toValue: number
  useNativeDriver?: boolean
}

export type TaoAnimatedSpringConfig = {
  friction?: number
  tension?: number
  toValue: number
  useNativeDriver?: boolean
}

export type TaoAnimatedAction = {
  invoke(): void
}

export type TaoAnimatedFinishedAction = {
  invoke(finished: boolean): void
}

export type TaoAnimatedDriver = {
  Value: new(value: number) => TaoAnimatedValue
  parallel(animations: readonly TaoAnimatedComposite[]): TaoAnimatedComposite
  sequence(animations: readonly TaoAnimatedComposite[]): TaoAnimatedComposite
  spring(value: TaoAnimatedValue, config: TaoAnimatedSpringConfig): TaoAnimatedComposite
  timing(value: TaoAnimatedValue, config: TaoAnimatedTimingConfig): TaoAnimatedComposite
}

let testDriver: TaoAnimatedDriver | undefined

/** Animated exposes React Native animation helpers. */
export const Animated = {
  /** value creates a React Native Animated.Value. */
  value(initialValue = 0): TaoAnimatedValue {
    const DriverValue = animatedDriver().Value
    return new DriverValue(initialValue)
  },

  /** timing creates a React Native timing animation. */
  timing(value: TaoAnimatedValue, config: TaoAnimatedTimingConfig): TaoAnimatedComposite {
    return animatedDriver().timing(value, { useNativeDriver: true, ...config })
  },

  /** spring creates a React Native spring animation. */
  spring(value: TaoAnimatedValue, config: TaoAnimatedSpringConfig): TaoAnimatedComposite {
    return animatedDriver().spring(value, { useNativeDriver: true, ...config })
  },

  /** sequence combines animations into a React Native sequence. */
  sequence(animations: readonly TaoAnimatedComposite[]): TaoAnimatedComposite {
    return animatedDriver().sequence(animations)
  },

  /** parallel combines animations into a React Native parallel group. */
  parallel(animations: readonly TaoAnimatedComposite[]): TaoAnimatedComposite {
    return animatedDriver().parallel(animations)
  },

  /** start starts an animation and optionally reports whether it finished. */
  start(animation: TaoAnimatedComposite, finished?: TaoAnimatedFinishedAction): void {
    animation.start(result => finished?.invoke(result.finished))
  },

  /** action creates a Pressable-compatible action that starts an animation. */
  action(animation: TaoAnimatedComposite, finished?: TaoAnimatedFinishedAction): TaoAnimatedAction {
    return {
      invoke() {
        Animated.start(animation, finished)
      },
    }
  },

  /** finishedAction adapts animation completion into an Animated-compatible action. */
  finishedAction(work: (finished: boolean) => void): TaoAnimatedFinishedAction {
    return {
      invoke(finished) {
        work(finished)
      },
    }
  },

  /** setDriverForTests replaces React Native Animated for deterministic runtime tests. */
  setDriverForTests(driver?: TaoAnimatedDriver): void {
    testDriver = driver
  },
} as const

function animatedDriver(): TaoAnimatedDriver {
  if (testDriver) {
    return testDriver
  }

  if (isJestRuntime()) {
    return {
      Value: class {
        constructor(readonly value: number) {}
      },
      parallel(animations) {
        return composite(() => animations.forEach(animation => animation.start()))
      },
      sequence(animations) {
        return composite(() => animations.forEach(animation => animation.start()))
      },
      spring() {
        return composite()
      },
      timing() {
        return composite()
      },
    }
  }

  const RN = require('react-native') as { Animated: TaoAnimatedDriver }
  return RN.Animated
}

function composite(onStart?: () => void): TaoAnimatedComposite {
  return {
    start(callback) {
      onStart?.()
      callback?.({ finished: true })
    },
    stop() {},
  }
}

function isJestRuntime(): boolean {
  return typeof process !== 'undefined'
    && (process.env['JEST_WORKER_ID'] !== undefined || process.env['NODE_ENV'] === 'test')
}
