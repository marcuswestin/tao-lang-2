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
  /** Older diagnostic captures have no public sentence; their message is never a UI fallback. */
  publicMessage?: string
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

/** TaoActionExit retains the primary throw and each fault from lexical cleanup. */
export type TaoActionExit = Readonly<{
  kind: 'failure' | 'cancelled'
  primary: unknown
  cleanupFailures: readonly unknown[]
  stage: 'body' | 'cleanup'
  result?: unknown
}>

const actionExits = new WeakMap<object, TaoActionExit>()

/** actionExitOf recognizes only carriers created by lexical action cleanup. */
export function actionExitOf(error: unknown): TaoActionExit | undefined {
  return typeof error === 'object' && error !== null ? actionExits.get(error) : undefined
}

/** createActionExit combines a body's exit with faults in cleanup execution order. */
export function createActionExit(
  failed: boolean,
  error: unknown,
  result: unknown,
  cleanupErrors: readonly unknown[],
): unknown {
  const previous = failed ? actionExitOf(error) : undefined
  const cleanupFailures = [...(previous?.cleanupFailures ?? [])]
  for (const fault of cleanupErrors) {
    const nested = actionExitOf(fault)
    if (!nested) {
      cleanupFailures.push(fault)
    } else {
      if (nested.stage === 'body') {
        cleanupFailures.push(nested.primary)
      }
      cleanupFailures.push(...nested.cleanupFailures)
    }
  }
  const primary = failed ? previous ? previous.primary : error : cleanupFailures[0]
  const carrier = Object.freeze({})
  actionExits.set(
    carrier,
    Object.freeze({
      kind: previous?.kind ?? (primary instanceof TaoActionFailure && primary.caseName === 'cancelled'
        ? 'cancelled'
        : 'failure'),
      primary,
      cleanupFailures: Object.freeze(cleanupFailures),
      stage: previous?.stage ?? (failed ? 'body' : 'cleanup'),
      ...(!failed ? { result } : previous?.stage === 'cleanup' ? { result: previous.result } : {}),
    }),
  )
  const source = failed ? error : cleanupErrors[0]
  if (typeof source === 'object' && source !== null) {
    const frames = actionFailureFrames.get(source)
    if (frames) {
      actionFailureFrames.set(carrier, frames)
    }
  }
  return carrier
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
  owned: boolean | ((failure: TaoActionFailureReport) => boolean) = false,
): TaoActionFailureReport {
  const failure = actionFailureReport(error, transaction, action, arguments_)
  actionHistory.push(failure)
  if (actionHistory.length > 50) {
    actionHistory.splice(0, actionHistory.length - 50)
  }
  let accepted = false
  try {
    accepted = typeof owned === 'function' ? owned(failure) : owned
  } catch (deliveryError) {
    // A broken sink owns neither the original failure nor its own delivery failure.
    reportUnownedFailure(deliveryError)
  }
  for (const listener of actionFailureListeners) {
    listener(failure)
  }
  if (actionFailureListeners.size === 0 && !accepted) {
    reportUnownedFailure(unownedError ?? new TaoActionFailure(failure.case, failure.message))
  }
  return failure
}

/**
 * errorDetail is what a thrown value actually says about the failure, or nothing when it says
 * nothing. A platform event (a WebSocket `error`, a media failure) is an object with no `message`
 * and no useful `toString`, so a caller that knows the operation can name it instead of printing
 * `[object Object]`.
 */
export function errorDetail(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message.trim().length > 0 ? error.message : undefined
  }
  if (typeof error === 'string') {
    return error.trim().length > 0 ? error : undefined
  }
  if (typeof error === 'object' && error !== null) {
    const carried = (error as { message?: unknown }).message
    return typeof carried === 'string' && carried.trim().length > 0 ? carried : undefined
  }
  return error === undefined || error === null ? undefined : String(error)
}

/** errorStack is the stack of a thrown value that carries one, for a log that has to say where. */
export function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined
}

/** errorMessage is the one way the runtime reads a user-facing sentence out of an unknown throw. */
export function errorMessage(error: unknown): string {
  return errorDetail(error) ?? describeThrownValue(error)
}

/**
 * describeThrownValue names a value that carries no message. A class name (`Event`, `CloseEvent`)
 * identifies what the platform handed over, and own fields that are plain values add the rest;
 * `String(value)` would flatten all of it to `[object Object]`.
 */
function describeThrownValue(value: unknown): string {
  if (typeof value !== 'object' || value === null) {
    return String(value)
  }
  const name = value.constructor?.name ?? 'object'
  const fields = Object.entries(value)
    .filter(([, field]) => field === null || ['boolean', 'number', 'string'].includes(typeof field))
    .slice(0, 4)
    .map(([key, field]) => `${key}: ${typeof field === 'string' ? field : String(field)}`)
  return fields.length === 0 ? name : `${name} (${fields.join(', ')})`
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
  const failure = asActionFailure(error)
  const exit = actionExitOf(error)
  let original = error
  for (let primary = actionExitOf(original); primary; primary = actionExitOf(original)) {
    original = primary.primary
  }
  const publicFailure = original instanceof TaoActionFailure ? original : new TaoActionFailure('Unexpected', '')
  return Object.freeze({
    action,
    arguments: sanitize(arguments_) as readonly unknown[],
    case: failure.caseName,
    frames: typeof error === 'object' && error !== null
      ? [...(actionFailureFrames.get(error) ?? transaction.frames)]
      : [...transaction.frames],
    message: actionFailureMessage(failure, action, actionExitOf(error)?.stage),
    publicMessage: actionFailureMessage(publicFailure, action, exit?.stage, transaction.externalEffects),
    retryEligible: !transaction.externalEffects,
    timestamp: Date.now(),
  })
}

/** A public action surface never falls back to the diagnostic message of an older capture. */
export function actionFailurePublicMessage(failure: TaoActionFailureReport): string {
  return failure.publicMessage
    ?? actionFailureMessage(new TaoActionFailure('Unexpected', ''), failure.action, undefined, !failure.retryEligible)
}

/** asActionFailure reads any thrown value as an action failure; an undeclared throw is `Unexpected`. */
export function asActionFailure(error: unknown): TaoActionFailure {
  const exit = actionExitOf(error)
  if (exit) {
    error = exit.primary
  }
  return error instanceof TaoActionFailure
    ? error
    : new TaoActionFailure('Unexpected', '', error instanceof Error ? error.message : '')
}

/**
 * actionFailureMessage selects the one user message for a failure: the provider's sentence, then the
 * declared sentence, then a fallback naming the action. A failure report and a `when do` outcome
 * read the same ladder, so a person sees one sentence whichever of them surfaces it.
 */
export function actionFailureMessage(
  failure: TaoActionFailure,
  action: string,
  stage?: TaoActionExit['stage'],
  externalEffects = false,
): string {
  return failure.providerSentence
    || failure.declaredSentence
    || (stage === 'cleanup'
      ? `Couldn't finish cleanup for '${action}.'`
      : `Couldn't finish '${action}.'${externalEffects ? '' : ' Nothing was changed.'}`)
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
