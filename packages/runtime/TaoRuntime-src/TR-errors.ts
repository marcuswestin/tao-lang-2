/**
 * TR-errors owns every runtime error concern that is not React render containment: the error
 * vocabulary Tao throws, the unowned-failure escape hatch, the bounded redacted action-failure
 * diagnostics, and the dev-only warnings for a failure that was contained rather than surfaced and
 * for a declared design the platform cannot honor. `ErrorControls` is the whole surface `TR.Errors`
 * publishes; `TR-error-containment.tsx` owns the React boundary and reuses this module's redaction
 * and warning policy.
 *
 * The three thrown categories mirror the toolchain's `@shared` taxonomy, which this package cannot
 * import: `UnexpectedBehaviorError` is an invariant Tao itself owed and a Tao bug, `UserInputError`
 * is the Tao author's own data or contract and their message to fix, and `HostEnvironmentError` is
 * the device, native module, or host platform failing underneath both. `TR-assert.ts` owns the
 * guards that raise the first two for runtime code, and `ErrorControls.fail…` raises all three for
 * generated app code, whose only Tao import is `TR`.
 */

/** ErrorDetails declares structured context attached to a Tao runtime invariant failure. */
export type ErrorDetails = Record<string, unknown>

/** TaoActionFailureReport is the contained, redacted record published for one failed root action. */
export type TaoActionFailureReport = Readonly<{
  action: string
  arguments: readonly unknown[]
  case: string
  message: string
  retryEligible: boolean
  frames: readonly string[]
  timestamp: number
}>

/** ActionFailureContext is the transaction state an action-failure report reads, and nothing more. */
export type ActionFailureContext = Readonly<{
  externalEffects: boolean
  frames: readonly string[]
}>

type UnownedFailureListener = (error: unknown) => void

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

/** UserInputError reports a Tao program's own data or contract being wrong, which its author can fix. */
export class UserInputError extends Error {
  readonly details?: ErrorDetails
  readonly cause?: unknown
  readonly messageForUser: string
  override readonly name = 'UserInputError'

  constructor(messageForUser: string, details?: ErrorDetails) {
    super(messageForUser)
    this.cause = undefined
    this.details = details
    this.messageForUser = messageForUser
  }
}

/** HostEnvironmentError reports a failure of the device, a native module, or the host platform. */
export class HostEnvironmentError extends Error {
  readonly details?: ErrorDetails
  readonly cause?: unknown
  readonly messageForUser: string
  override readonly name = 'HostEnvironmentError'

  constructor(messageForUser: string, options: { cause?: unknown; details?: ErrorDetails } = {}) {
    super(messageForUser)
    this.cause = options.cause
    this.details = options.details
    this.messageForUser = messageForUser
  }
}

/** TaoViewDepthError is the contained render failure raised by the first frame beyond Tao's depth cap. */
export class TaoViewDepthError extends Error {
  readonly depth: number
  readonly view: string
  override readonly name = 'TaoViewDepthError'

  constructor(view: string, depth: number) {
    super(`View '${view}' exceeded Tao's maximum render depth of 256.`)
    this.depth = depth
    this.view = view
  }
}

/** TaoActionFailure is the deliberate, typed control-flow signal produced by `fail`. */
export class TaoActionFailure extends Error {
  override readonly name = 'TaoActionFailure'

  constructor(
    readonly caseName: string,
    readonly declaredSentence: string,
    readonly providerSentence?: string,
  ) {
    super(providerSentence || declaredSentence || 'The action failed.')
  }
}

/** ErrorControls is the runtime's one error-handling surface: the three throwing categories generated
 * code can reach, contained action reports, bounded redacted diagnostic history, and the escape hatch
 * for failures no caller can observe.
 *
 * The `fail*` members exist because generated app code imports `TR` and nothing else, so `TR.Errors`
 * is the only place a compiled program can name Tao's error taxonomy. They return `never`, but a call
 * through the `TR.Errors` property chain does not narrow afterwards, so a guarded generated value
 * reaches for `?? TR.Errors.fail…(…)` rather than a bare statement. */
export const ErrorControls = {
  capture: captureActionHistory,
  /** failHost reports the device, a native module, or the host platform failing underneath the app. */
  failHost: (message: string, details?: ErrorDetails): never => {
    throw new HostEnvironmentError(message, { details })
  },
  /** failInput reports the Tao program's own data or contract being wrong at runtime. */
  failInput: (message: string, details?: ErrorDetails): never => {
    throw new UserInputError(message, details)
  },
  /** failInvariant reports generated code meeting a state its compiler should have prevented. */
  failInvariant: (message: string, details?: ErrorDetails): never => {
    throw new UnexpectedBehaviorError(message, { details })
  },
  onFailure: onActionFailure,
  onUnowned: onUnownedFailure,
  reportUnowned: reportUnownedFailure,
  reset: resetActionDiagnostics,
} as const

const unownedFailureListeners = new Set<UnownedFailureListener>()
const actionFailureListeners = new Set<(failure: TaoActionFailureReport) => void>()
const actionHistory: TaoActionFailureReport[] = []
const actionFailureFrames = new WeakMap<object, readonly string[]>()
const redactedKeys = /credential|password|secret|token|authorization/i

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

/** onActionFailure observes contained root action failures. */
export function onActionFailure(listener: (failure: TaoActionFailureReport) => void): () => void {
  actionFailureListeners.add(listener)
  return () => actionFailureListeners.delete(listener)
}

/** captureActionHistory returns the bounded, structurally redacted diagnostic action log. */
export function captureActionHistory(): readonly TaoActionFailureReport[] {
  return actionHistory.map(entry => ({ ...entry, arguments: [...entry.arguments], frames: [...entry.frames] }))
}

/** resetActionDiagnostics clears retained diagnostic history without changing app state. */
export function resetActionDiagnostics(): void {
  actionHistory.length = 0
}

/** recordActionFailureFrames pins the innermost `do` frames to an error still unwinding to its root. */
export function recordActionFailureFrames(error: unknown, frames: readonly string[]): void {
  if (typeof error === 'object' && error !== null && !actionFailureFrames.has(error)) {
    actionFailureFrames.set(error, [...frames])
  }
}

/** reportActionFailure publishes the contained report for one rolled-back root action. */
export function reportActionFailure(
  error: unknown,
  transaction: ActionFailureContext,
  action: string,
  arguments_: readonly unknown[],
  unownedError?: unknown,
): void {
  const failure = actionFailureReport(error, transaction, action, arguments_)
  actionHistory.push(failure)
  if (actionHistory.length > 50) {
    actionHistory.splice(0, actionHistory.length - 50)
  }
  for (const listener of actionFailureListeners) {
    listener(failure)
  }
  if (actionFailureListeners.size === 0) {
    reportUnownedFailure(unownedError ?? new TaoActionFailure(failure.case, failure.message))
  }
}

/** errorMessage is the one way the runtime reads a user-facing sentence out of an unknown throw. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** isRedactedKey names the one credential-shaped key policy every runtime diagnostic capture applies. */
export function isRedactedKey(key: string): boolean {
  return redactedKeys.test(key)
}

/** warnContainedFailure reports, outside production only, a failure the runtime deliberately swallowed. */
export function warnContainedFailure(message: string, error: unknown): void {
  if (typeof process === 'undefined' || process.env.NODE_ENV === 'production') {
    return
  }
  console.warn(message, error ?? '')
}

/**
 * warnDesignDivergence reports, outside production, a declared style the platform cannot honor.
 * It is deliberately not `warnContainedFailure`: nothing failed and nothing was swallowed, so there
 * is no error to attach — the app renders as asked of the platform, and the notice names the gap
 * between what the Tao author declared and what the screen can show.
 */
export function warnDesignDivergence(message: string): void {
  if (typeof process === 'undefined' || process.env.NODE_ENV === 'production') {
    return
  }
  console.warn(message)
}

function actionFailureReport(
  error: unknown,
  transaction: ActionFailureContext,
  action: string,
  arguments_: readonly unknown[],
): TaoActionFailureReport {
  const failure = error instanceof TaoActionFailure
    ? error
    : new TaoActionFailure('Unexpected', '', error instanceof Error ? error.message : '')
  return Object.freeze({
    action,
    arguments: sanitize(arguments_) as readonly unknown[],
    case: failure.caseName,
    frames: typeof error === 'object' && error !== null
      ? [...(actionFailureFrames.get(error) ?? transaction.frames)]
      : [...transaction.frames],
    message: failure.providerSentence
      || failure.declaredSentence
      || `Couldn't finish '${action}.' Nothing was changed.`,
    retryEligible: !transaction.externalEffects,
    timestamp: Date.now(),
  })
}

function sanitize(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value
  }
  if (typeof value !== 'object') {
    return undefined
  }
  if (seen.has(value)) {
    return '[circular]'
  }
  seen.add(value)
  if (Array.isArray(value)) {
    return value.map(item => sanitize(item, seen))
  }
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isRedactedKey(key)) {
      continue
    }
    result[key] = sanitize(entry, seen)
  }
  return result
}

/** restoreActionHistory replaces retained diagnostics from a validated runtime-capture domain. */
export function restoreActionHistory(value: unknown): void {
  actionHistory.length = 0
  if (!Array.isArray(value)) {
    return
  }
  actionHistory.push(...value.slice(-50) as TaoActionFailureReport[])
}
