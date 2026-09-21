import { type ErrorDetails, UnexpectedBehaviorError, UserInputError } from './TR-errors'

/*
 * RuntimeAssert is the one way the runtime writes a guarded failure, mirroring the toolchain's
 * shared `Assert` without importing it — the same sanctioned duplication `TR-switch.ts` makes of the
 * shared `Switch`, because `packages/runtime` ships to the device and depends on no Tao package.
 *
 * Its default entry point states an invariant Tao itself owns, so it raises
 * `UnexpectedBehaviorError` and reads as `Expected: <expected>`; `RuntimeAssert.input` states a
 * precondition the Tao author owns, so it raises `UserInputError` and its second argument is the
 * finished sentence that author reads. Device and host failures are usually caught rather than
 * guarded, so they throw `HostEnvironmentError` directly.
 *
 * The explicit `RuntimeAssertApi` annotation is load-bearing: TypeScript refuses an assertion call
 * whose callee has no explicit type annotation.
 */
export const RuntimeAssert: RuntimeAssertApi = Object.assign(assertCondition, {
  defined: assertDefined,
  input: assertInput,
  is: assertIs,
  never: assertNever,
})

function assertCondition(
  condition: unknown,
  expected: string,
  details?: ErrorDetails,
): asserts condition {
  if (!condition) {
    throw new UnexpectedBehaviorError(`Expected: ${expected}`, { details: { condition, ...details } })
  }
}

function assertDefined<T>(value: T, expected: string, details?: ErrorDetails): asserts value is NonNullable<T> {
  assertCondition(value !== undefined && value !== null, expected, { value, ...details })
}

function assertInput(
  condition: unknown,
  messageForUser: string,
  details?: ErrorDetails,
): asserts condition {
  if (!condition) {
    throw new UserInputError(messageForUser, details)
  }
}

function assertIs<T>(
  value: unknown,
  guard: (value: unknown) => value is T,
  expected: string,
  details?: ErrorDetails,
): asserts value is T {
  assertCondition(guard(value), expected, { value, ...details })
}

function assertNever(value: never, message = 'Unexpected unreachable value'): never {
  throw new UnexpectedBehaviorError(message, { details: { value } })
}

/**
 * Extracted because a bare `asserts condition` predicate greedily consumes a following `is`,
 * which would swallow the `is:` member declared after it.
 */
type RuntimeAssertInput = (condition: unknown, messageForUser: string, details?: ErrorDetails) => asserts condition

type RuntimeAssertApi = {
  (condition: unknown, expected: string, details?: ErrorDetails): asserts condition
  defined: <T>(value: T, expected: string, details?: ErrorDetails) => asserts value is NonNullable<T>
  input: RuntimeAssertInput
  is: <T>(
    value: unknown,
    guard: (value: unknown) => value is T,
    expected: string,
    details?: ErrorDetails,
  ) => asserts value is T
  never: (value: never, message?: string) => never
}
