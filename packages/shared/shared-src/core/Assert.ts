import { type ErrorDetails, UnexpectedBehaviorError } from './Errors'

export const Assert: AssertApi = Object.assign(assertCondition, {
  defined: assertDefined,
  is: assertIs,
  never: assertNever,
})

function assertCondition<T>(
  condition: T,
  expected: string,
  details?: ErrorDetails,
): asserts condition is NonNullable<T> {
  if (!condition) {
    throw new UnexpectedBehaviorError(`Expected: ${expected}`, { details: { condition, ...details } })
  }
}

function assertDefined<T>(value: T, expected: string, details?: ErrorDetails): asserts value is NonNullable<T> {
  assertCondition(value !== undefined && value !== null, expected, { value, ...details })
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

type AssertApi = {
  <T>(condition: T, expected: string, details?: ErrorDetails): asserts condition is NonNullable<T>
  defined: <T>(value: T, expected: string, details?: ErrorDetails) => asserts value is NonNullable<T>
  is: <T>(
    value: unknown,
    guard: (value: unknown) => value is T,
    expected: string,
    details?: ErrorDetails,
  ) => asserts value is T
  never: (value: never, message?: string) => never
}
