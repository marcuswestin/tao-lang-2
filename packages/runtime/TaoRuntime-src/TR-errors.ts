/** ErrorDetails declares structured context attached to a Tao runtime invariant failure. */
export type ErrorDetails = Record<string, unknown>

type UnownedFailureListener = (error: unknown) => void

const unownedFailureListeners = new Set<UnownedFailureListener>()

/** reportUnownedFailure surfaces a failure no caller can observe, such as one inside a detached async block. */
export function reportUnownedFailure(error: unknown): void {
  if (unownedFailureListeners.size === 0) {
    // Rethrowing detached from the settled promise reaches the platform's unhandled error reporting.
    queueMicrotask(() => {
      throw error
    })
    return
  }
  for (const listener of unownedFailureListeners) {
    listener(error)
  }
}

/** onUnownedFailure observes unowned failures instead of letting them reach the platform. */
export function onUnownedFailure(listener: UnownedFailureListener): () => void {
  unownedFailureListeners.add(listener)
  return () => {
    unownedFailureListeners.delete(listener)
  }
}

/** UnexpectedBehaviorError reports a violated runtime invariant. */
export class UnexpectedBehaviorError extends Error {
  readonly details?: ErrorDetails
  readonly cause?: unknown
  readonly messageForUser: string
  override readonly name = 'UnexpectedBehaviorError'

  constructor(messageForUser: string, options: { cause?: unknown; details?: ErrorDetails } = {}) {
    super(messageForUser)
    this.cause = options.cause
    this.details = options.details
    this.messageForUser = messageForUser
  }
}
