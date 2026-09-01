import { type ErrorDetails, UnexpectedBehaviorError, UserInputError } from './Errors'

/*
 * Assert is the one way Tao writes a guarded failure. Its default entry point states an invariant
 * Tao itself owns, so it raises `UnexpectedBehaviorError` and reads as `Expected: <expected>`;
 * `Assert.input` states a precondition the Tao author owns, so it raises `UserInputError` and its
 * second argument is the finished sentence that author reads. Host and environment failures are
 * usually caught rather than guarded, so they stay with `Errors.throwHostEnvironment`.
 */
export const Assert: AssertApi = Object.assign(assertCondition, {
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
type AssertInput = (condition: unknown, messageForUser: string, details?: ErrorDetails) => asserts condition

type AssertApi = {
  (condition: unknown, expected: string, details?: ErrorDetails): asserts condition
  defined: <T>(value: T, expected: string, details?: ErrorDetails) => asserts value is NonNullable<T>
  input: AssertInput
  is: <T>(
    value: unknown,
    guard: (value: unknown) => value is T,
    expected: string,
    details?: ErrorDetails,
  ) => asserts value is T
  never: (value: never, message?: string) => never
}
