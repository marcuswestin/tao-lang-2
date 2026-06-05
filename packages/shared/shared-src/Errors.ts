import type { ProcessSignal } from './Platform'

/** TaoError declares errors expected by Tao command and library code. */
export type TaoError =
  | UserInputError
  | UnexpectedBehaviorError
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

  constructor(messageForUser = 'Something went wrong.', opts: { cause?: unknown; details?: ErrorDetails } = {}) {
    super('UnexpectedBehaviorError', messageForUser, opts)
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
    || error instanceof CommandExecutionError
}

/** fromUnknown normalizes an unknown thrown value into a Tao error. */
export function fromUnknown(error: unknown, details?: ErrorDetails): TaoError {
  if (isTaoError(error)) {
    return error
  }
  return new UnexpectedBehaviorError('Something went wrong.', { cause: error, details })
}

/** throwUserInput throws a user-correctable Tao error. */
export function throwUserInput(messageForUser: string, details?: ErrorDetails): never {
  throw new UserInputError(messageForUser, details)
}

/** throwUnexpected throws an internal Tao error. */
export function throwUnexpected(messageForUser: string, opts?: { cause?: unknown; details?: ErrorDetails }): never {
  throw new UnexpectedBehaviorError(messageForUser, opts)
}

/** formatForUser renders an error message suitable for terminal users. */
export function formatForUser(error: unknown): string {
  return isTaoError(error) ? error.messageForUser : 'Something went wrong.'
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
  return [command, ...args].join(' ')
}
