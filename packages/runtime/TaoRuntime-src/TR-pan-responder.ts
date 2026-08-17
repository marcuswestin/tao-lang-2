export type TaoGestureResponderEvent = unknown

export type TaoPanResponderGestureState = Record<string, unknown>

export type TaoPanResponderHandlers = Record<string, unknown>

export type TaoPanResponderInstance = {
  panHandlers: TaoPanResponderHandlers
}

export type TaoPanResponderCallbacks = {
  onMoveShouldSetPanResponder?(
    event: TaoGestureResponderEvent,
    gestureState: TaoPanResponderGestureState,
  ): boolean
  onPanResponderGrant?(
    event: TaoGestureResponderEvent,
    gestureState: TaoPanResponderGestureState,
  ): void
  onPanResponderMove?(
    event: TaoGestureResponderEvent,
    gestureState: TaoPanResponderGestureState,
  ): void
  onPanResponderRelease?(
    event: TaoGestureResponderEvent,
    gestureState: TaoPanResponderGestureState,
  ): void
  onPanResponderTerminate?(
    event: TaoGestureResponderEvent,
    gestureState: TaoPanResponderGestureState,
  ): void
  onStartShouldSetPanResponder?(
    event: TaoGestureResponderEvent,
    gestureState: TaoPanResponderGestureState,
  ): boolean
}

export type TaoPanResponderDriver = {
  create(callbacks: TaoPanResponderCallbacks): TaoPanResponderInstance
}

export type TaoPanResponderShouldSet = NonNullable<TaoPanResponderCallbacks['onMoveShouldSetPanResponder']>

let testDriver: TaoPanResponderDriver | undefined

/** PanResponder exposes React Native gesture responder creation helpers. */
export const PanResponder = {
  /** create delegates gesture responder creation to React Native PanResponder.create. */
  create(callbacks: TaoPanResponderCallbacks = {}): TaoPanResponderInstance {
    return panResponderDriver().create(callbacks)
  },

  /** handlers returns the React Native panHandlers object for a responder. */
  handlers(responder: TaoPanResponderInstance): TaoPanResponderHandlers {
    return responder.panHandlers
  },

  /** shouldSet creates a stable PanResponder predicate for generated gesture defaults. */
  shouldSet(value: boolean): TaoPanResponderShouldSet {
    return () => value
  },

  /** setDriverForTests replaces React Native PanResponder for deterministic runtime tests. */
  setDriverForTests(driver?: TaoPanResponderDriver): void {
    testDriver = driver
  },
} as const

function panResponderDriver(): TaoPanResponderDriver {
  if (testDriver) {
    return testDriver
  }

  if (isJestRuntime()) {
    return {
      create() {
        return { panHandlers: {} }
      },
    }
  }

  const RN = require('react-native') as { PanResponder: TaoPanResponderDriver }
  return RN.PanResponder
}

function isJestRuntime(): boolean {
  return typeof process !== 'undefined'
    && (process.env['JEST_WORKER_ID'] !== undefined || process.env['NODE_ENV'] === 'test')
}
