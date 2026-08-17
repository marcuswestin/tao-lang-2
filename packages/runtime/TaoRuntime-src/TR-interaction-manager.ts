export type TaoInteractionTask = {
  cancel?(): void
}

export type TaoInteractionManagerDriver = {
  runAfterInteractions(task: () => void): TaoInteractionTask
}

export type TaoInteractionAction = {
  invoke(): TaoInteractionTask
}

export type TaoInteractionWorkAction = {
  invoke(): void
}

let testDriver: TaoInteractionManagerDriver | undefined

/** InteractionManager exposes React Native post-interaction scheduling helpers. */
export const InteractionManager = {
  /** defer runs work after native gestures and animations settle. */
  defer(task: TaoInteractionWorkAction): TaoInteractionTask {
    return interactionManagerDriver().runAfterInteractions(() => task.invoke())
  },

  /** deferAction creates a Pressable-compatible action that defers its body until after interactions. */
  deferAction(task: TaoInteractionWorkAction): TaoInteractionAction {
    return {
      invoke() {
        return InteractionManager.defer(task)
      },
    }
  },

  /** taskAction adapts deferred work into an InteractionManager-compatible action. */
  taskAction(work: () => void): TaoInteractionWorkAction {
    return {
      invoke() {
        work()
      },
    }
  },

  /** setDriverForTests replaces React Native InteractionManager for deterministic runtime tests. */
  setDriverForTests(driver?: TaoInteractionManagerDriver): void {
    testDriver = driver
  },
} as const

function interactionManagerDriver(): TaoInteractionManagerDriver {
  if (testDriver) {
    return testDriver
  }

  if (isJestRuntime()) {
    return {
      runAfterInteractions(task) {
        task()
        return {}
      },
    }
  }

  const RN = require('react-native') as { InteractionManager: TaoInteractionManagerDriver }
  return RN.InteractionManager
}

function isJestRuntime(): boolean {
  return typeof process !== 'undefined'
    && (process.env['JEST_WORKER_ID'] !== undefined || process.env['NODE_ENV'] === 'test')
}
