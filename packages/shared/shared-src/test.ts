import { afterEach, describe, expect, test } from 'bun:test'

const afterEachBase =
  ((...args: unknown[]) => (afterEach as (...args: unknown[]) => unknown)(...args)) as typeof afterEach
const describeBase = ((...args: unknown[]) => (describe as (...args: unknown[]) => unknown)(...args)) as typeof describe
const expectBase = ((...args: unknown[]) => (expect as (...args: unknown[]) => unknown)(...args)) as typeof expect
const testBase = ((...args: unknown[]) => (test as (...args: unknown[]) => unknown)(...args)) as typeof test

/** AfterEach wraps the active test runner's afterEach hook. */
export const AfterEach: typeof afterEach = Object.assign(afterEachBase, afterEach)

/** Describe wraps the active test runner's describe grouping API. */
export const Describe: typeof describe = Object.assign(describeBase, describe)

/** Expect wraps the active test runner's assertion API with Tao test narrowing helpers. */
export const Expect: ExpectApi = Object.assign(expectBase, expect, {
  Is: ExpectIs,
})

/** Jest wraps the active Jest control API for Jest-only runtime tests. */
export const Jest: JestApi = {
  resetModules() {
    getJest().resetModules()
  },
}

/** Test wraps the active test runner's test case API. */
export const Test: typeof test = Object.assign(testBase, test)

function ExpectIs<T>(value: unknown, guard: (value: unknown) => value is T): asserts value is T {
  Expect(guard(value)).toBe(true)
}

function getJest(): JestApi {
  const value = (globalThis as unknown as { jest?: JestApi }).jest

  if (value === undefined) {
    throw new Error(`Test runtime global 'jest' is not available`)
  }

  return value
}

type ExpectApi = typeof expect & {
  Is: <T>(value: unknown, guard: (value: unknown) => value is T) => asserts value is T
}

type JestApi = {
  resetModules(): void
}
