export type TaoEasingFunction = (value: number) => number

export type TaoEasingDriver = {
  back(value?: number): TaoEasingFunction
  bezier(x1: number, y1: number, x2: number, y2: number): TaoEasingFunction
  bounce(value: number): number
  circle(value: number): number
  cubic(value: number): number
  ease(value: number): number
  elastic(value?: number): TaoEasingFunction
  exp(value: number): number
  in(easing: TaoEasingFunction): TaoEasingFunction
  inOut(easing: TaoEasingFunction): TaoEasingFunction
  linear(value: number): number
  out(easing: TaoEasingFunction): TaoEasingFunction
  poly(value: number): TaoEasingFunction
  quad(value: number): number
  sin(value: number): number
  step0(value: number): number
  step1(value: number): number
}

let testDriver: TaoEasingDriver | undefined

/** Easing exposes React Native animation easing helpers. */
export const Easing = {
  /** linear returns the linear easing value for a normalized progress input. */
  linear(value: number): number {
    return easingDriver().linear(value)
  },

  /** ease returns React Native's default ease curve value. */
  ease(value: number): number {
    return easingDriver().ease(value)
  },

  /** quad returns the quadratic easing value. */
  quad(value: number): number {
    return easingDriver().quad(value)
  },

  /** cubic returns the cubic easing value. */
  cubic(value: number): number {
    return easingDriver().cubic(value)
  },

  /** sin returns the sinusoidal easing value. */
  sin(value: number): number {
    return easingDriver().sin(value)
  },

  /** circle returns the circular easing value. */
  circle(value: number): number {
    return easingDriver().circle(value)
  },

  /** exp returns the exponential easing value. */
  exp(value: number): number {
    return easingDriver().exp(value)
  },

  /** bounce returns the bounce easing value. */
  bounce(value: number): number {
    return easingDriver().bounce(value)
  },

  /** step0 returns the step0 easing value. */
  step0(value: number): number {
    return easingDriver().step0(value)
  },

  /** step1 returns the step1 easing value. */
  step1(value: number): number {
    return easingDriver().step1(value)
  },

  /** poly creates a polynomial easing function. */
  poly(value: number): TaoEasingFunction {
    return easingDriver().poly(value)
  },

  /** elastic creates an elastic easing function. */
  elastic(value?: number): TaoEasingFunction {
    return easingDriver().elastic(value)
  },

  /** back creates a back easing function. */
  back(value?: number): TaoEasingFunction {
    return easingDriver().back(value)
  },

  /** bezier creates a cubic-bezier easing function. */
  bezier(x1: number, y1: number, x2: number, y2: number): TaoEasingFunction {
    return easingDriver().bezier(x1, y1, x2, y2)
  },

  /** in wraps an easing function with React Native's ease-in transform. */
  in(easing: TaoEasingFunction): TaoEasingFunction {
    return easingDriver().in(easing)
  },

  /** out wraps an easing function with React Native's ease-out transform. */
  out(easing: TaoEasingFunction): TaoEasingFunction {
    return easingDriver().out(easing)
  },

  /** inOut wraps an easing function with React Native's ease-in-out transform. */
  inOut(easing: TaoEasingFunction): TaoEasingFunction {
    return easingDriver().inOut(easing)
  },

  /** setDriverForTests replaces React Native Easing for deterministic runtime tests. */
  setDriverForTests(driver?: TaoEasingDriver): void {
    testDriver = driver
  },
} as const

function easingDriver(): TaoEasingDriver {
  if (testDriver) {
    return testDriver
  }

  if (isJestRuntime()) {
    return {
      back: (value = 1) => progress => progress + value,
      bezier: (x1, y1, x2, y2) => progress => progress + x1 + y1 + x2 + y2,
      bounce: value => value,
      circle: value => value,
      cubic: value => value * value * value,
      ease: value => value,
      elastic: (value = 1) => progress => progress + value,
      exp: value => value,
      in: easing => easing,
      inOut: easing => easing,
      linear: value => value,
      out: easing => easing,
      poly: value => progress => progress ** value,
      quad: value => value * value,
      sin: value => value,
      step0: value => (value > 0 ? 1 : 0),
      step1: value => (value >= 1 ? 1 : 0),
    }
  }

  const RN = require('react-native') as { Easing: TaoEasingDriver }
  return RN.Easing
}

function isJestRuntime(): boolean {
  return typeof process !== 'undefined'
    && (process.env['JEST_WORKER_ID'] !== undefined || process.env['NODE_ENV'] === 'test')
}
