/** ErrorDetails declares structured context attached to a Tao runtime invariant failure. */
export type ErrorDetails = Record<string, unknown>

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
