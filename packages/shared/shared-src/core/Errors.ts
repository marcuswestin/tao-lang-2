/*
 * Tao sorts every non-assertion failure into one of three categories, because each one has a
 * different reader and a different recovery:
 *
 * 1. `UnexpectedBehaviorError` — an invariant Tao itself, or a layer upstream of this one, should
 *    have guaranteed. It is a Tao bug, never the author's; the reader is a Tao developer. `Assert`
 *    raises this category, so a guard belongs in `Assert` rather than here.
 * 2. `UserInputError` — the author's own data or contract is wrong, and they can fix it. The reader
 *    is the person writing the Tao program, and the message must tell them what to change.
 *    `Assert.input` raises this category from a guard.
 * 3. `HostEnvironmentError` — the machine, toolchain, or an external process failed: a missing
 *    native module, an absent build artifact, a helper that would not start.
 *    `CommandExecutionError` is this category's subprocess specialization and carries the full
 *    command result.
 */

/** ProcessSignal declares a platform process signal value without depending on Node types. */
type ProcessSignal = string

/** TaoError declares errors expected by Tao command and library code. */
export type TaoError =
  | UserInputError
  | UnexpectedBehaviorError
  | HostEnvironmentError
  | CommandExecutionError

/** ErrorDetails declares structured context attached to Tao errors. */
export type ErrorDetails = Record<string, unknown>

type CommandErrorResult = {
  command: string
  args: readonly string[]
  cwd?: string
  exitCode: number | null
  signal: ProcessSignal | null
  stdout: string
  stderr: string
  error?: Error
}

const unexpectedErrorMessage = 'Something went wrong.'

class BaseTaoError extends Error {
  readonly details?: ErrorDetails
  readonly cause?: unknown
  readonly messageForUser: string

  constructor(name: TaoError['name'], messageForUser: string, opts: { cause?: unknown; details?: ErrorDetails } = {}) {
    super(messageForUser)
    this.name = name
    this.messageForUser = messageForUser
    this.cause = opts.cause
    this.details = opts.details
  }
}

/** UserInputError reports invalid input or expected user-correctable failures. */
export class UserInputError extends BaseTaoError {
  override readonly name = 'UserInputError'

  constructor(messageForUser: string, details?: ErrorDetails) {
    super('UserInputError', messageForUser, { details })
  }
}

/** UnexpectedBehaviorError reports internal failures that should not happen in normal use. */
export class UnexpectedBehaviorError extends BaseTaoError {
  override readonly name = 'UnexpectedBehaviorError'

  constructor(messageForUser = unexpectedErrorMessage, opts: { cause?: unknown; details?: ErrorDetails } = {}) {
    super('UnexpectedBehaviorError', messageForUser, opts)
  }
}

/** HostEnvironmentError reports a failure of the machine, toolchain, or an external process. */
export class HostEnvironmentError extends BaseTaoError {
  override readonly name = 'HostEnvironmentError'

  constructor(messageForUser: string, opts: { cause?: unknown; details?: ErrorDetails } = {}) {
    super('HostEnvironmentError', messageForUser, opts)
  }
}

/** CommandExecutionError reports a failed child process invocation. */
export class CommandExecutionError extends BaseTaoError {
  override readonly name = 'CommandExecutionError'
  readonly result: CommandErrorResult

  constructor(result: CommandErrorResult) {
    super('CommandExecutionError', `Command failed: ${formatCommandForError(result.command, result.args)}`, {
      cause: result.error,
      details: {
        cwd: result.cwd,
        exitCode: result.exitCode,
        signal: result.signal,
        stderr: result.stderr,
        stdout: result.stdout,
      },
    })
    this.result = result
  }
}

/** isTaoError checks whether a value is one of Tao's structured errors. */
export function isTaoError(error: unknown): error is TaoError {
  return error instanceof UserInputError
    || error instanceof UnexpectedBehaviorError
    || error instanceof HostEnvironmentError
    || error instanceof CommandExecutionError
}

/**
 * messageOf reads the message out of an unknown thrown value for a surface that shows it
 * verbatim, such as a status line or an inline alert. `formatForUser` is the terminal rendering.
 * `packages/apps/runtime/TaoRuntime-src/TR-errors.ts` keeps `errorMessage` as its mirror.
 */
export function messageOf(error: unknown): string {
  return errorDetail(error) ?? describeThrownValue(error)
}

function errorDetail(error: unknown): string | undefined {
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

/**
 * asError hands back a thrown value as an `Error`: an `Error` unchanged, anything else wrapped as an
 * `UnexpectedBehaviorError` carrying its text, for an emitter or rejection that needs the object.
 */
export function asError(error: unknown): Error {
  return error instanceof Error ? error : new UnexpectedBehaviorError(String(error))
}

/**
 * abortError is the cancellation an `AbortSignal` consumer expects: a plain `Error` named `AbortError`,
 * which is the Web contract, not a Tao failure category.
 */
export function abortError(message: string): Error {
  return Object.assign(new Error(message), { name: 'AbortError' })
}

/** fromUnknown normalizes an unknown thrown value into a Tao error. */
export function fromUnknown(error: unknown, details?: ErrorDetails): TaoError {
  if (isTaoError(error)) {
    return error
  }
  return new UnexpectedBehaviorError(unexpectedErrorMessage, { cause: error, details })
}

/** throwUserInput throws a user-correctable Tao error. */
export function throwUserInput(messageForUser: string, details?: ErrorDetails): never {
  throw new UserInputError(messageForUser, details)
}

/** throwUnexpected throws an internal Tao error. */
export function throwUnexpected(messageForUser: string, opts?: { cause?: unknown; details?: ErrorDetails }): never {
  throw new UnexpectedBehaviorError(messageForUser, opts)
}

/** throwHostEnvironment throws a Tao error blaming the machine, toolchain, or an external process. */
export function throwHostEnvironment(
  messageForUser: string,
  opts?: { cause?: unknown; details?: ErrorDetails },
): never {
  throw new HostEnvironmentError(messageForUser, opts)
}

/**
 * formatForUser renders an error message suitable for terminal users.
 *
 * `TAO_DEBUG_ERRORS=1` swaps in the log rendering instead. An `UnexpectedBehaviorError` reaches the
 * terminal as the bare sentence "Something went wrong.", which is right for a Tao developer and
 * useless for whoever has to find the cause; the switch is what turns that report into the same
 * name, details, cause, and stack the logs already carry.
 */
export function formatForUser(error: unknown): string {
  if (debugErrorsEnabled()) {
    return formatForLog(error)
  }
  return isTaoError(error) ? error.messageForUser : unexpectedErrorMessage
}

/**
 * DEBUG_ERRORS_ENV names the opt-in that makes every user-facing error render its diagnostics. It
 * is exported so the command boundaries that print the bare unexpected sentence can name the switch
 * in the same breath, rather than leaving a reader with a sentence and nowhere to go.
 */
export const DEBUG_ERRORS_ENV = 'TAO_DEBUG_ERRORS'

/**
 * This module is the leaf every other shared module throws through, so it depends on nothing —
 * `Platform` imports it, not the other way round. The switch is read off the ambient process
 * without a Node type in scope, and an environment that has no `process` simply never enables it.
 */
function debugErrorsEnabled(): boolean {
  const ambient = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  const value = ambient?.env?.[DEBUG_ERRORS_ENV]
  return value !== undefined && value !== '' && value !== '0' && value !== 'false'
}

/** formatForLog renders an error message with diagnostic details. */
export function formatForLog(error: unknown): string {
  const taoError = fromUnknown(error)
  const parts = [`${taoError.name}: ${taoError.message}`]

  if (taoError.details) {
    parts.push(`details=${safeJson(taoError.details)}`)
  }
  if (taoError.cause !== undefined) {
    parts.push(`cause=${formatCause(taoError.cause)}`)
  }
  if (taoError.stack) {
    parts.push(taoError.stack)
  }

  return parts.join('\n')
}

function formatCause(cause: unknown): string {
  return cause instanceof Error ? cause.stack ?? cause.message : safeJson(cause)
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return '<safeJson: unserializable>'
  }
}

function formatCommandForError(command: string, args: readonly string[]): string {
  return [command, ...args].map(formatCommandPart).join(' ')
}

/** formatCommandPart quotes a command word that a reader could not paste back as written. */
function formatCommandPart(value: string): string {
  return /^[\w./:=@+-]+$/.test(value) ? value : JSON.stringify(value)
}
