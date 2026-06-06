const afterEachBase = ((...args: unknown[]) => getTestRuntime('afterEach')(...args)) as TestRunnerFunction
const describeBase = ((...args: unknown[]) => getTestRuntime('describe')(...args)) as TestRunnerFunction
const expectBase = ((...args: unknown[]) => getTestRuntime('expect')(...args)) as ExpectBaseApi
const testBase = ((...args: unknown[]) => getTestRuntime('test')(...args)) as TestRunnerFunction

/** AfterEach wraps the active test runner's afterEach hook. */
export const AfterEach = Object.assign(afterEachBase, getTestRuntime('afterEach'))

/** Describe wraps the active test runner's describe grouping API. */
export const Describe = Object.assign(describeBase, getTestRuntime('describe'))

/** Expect wraps the active test runner's assertion API with Tao test narrowing helpers. */
export const Expect: ExpectApi = Object.assign(expectBase, getTestRuntime('expect'), {
  Is: ExpectIs,
})

/** Jest wraps the active Jest control API for Jest-only runtime tests. */
export const Jest: JestApi = {
  resetModules() {
    getJest().resetModules()
  },
}

/** Test wraps the active test runner's test case API. */
export const Test = Object.assign(testBase, getTestRuntime('test'))

function ExpectIs<T>(value: unknown, guard: (value: unknown) => value is T): asserts value is T {
  Expect(guard(value)).toBe(true)
}

function getTestRuntime<Key extends keyof TestRuntimeGlobals>(key: Key): TestRuntimeGlobals[Key] {
  const value = (globalThis as unknown as Partial<TestRuntimeGlobals>)[key]

  if (value === undefined) {
    throw new Error(`Test runtime global '${key}' is not available`)
  }

  return value as TestRuntimeGlobals[Key]
}

function getJest(): JestApi {
  return (require('@jest/globals') as { jest: JestApi }).jest
}

type ExpectApi = ExpectBaseApi & {
  Is: <T>(value: unknown, guard: (value: unknown) => value is T) => asserts value is T
}

type ExpectBaseApi = ((...args: unknown[]) => TestExpectation) & Record<string, unknown>

type JestApi = {
  resetModules(): void
}

type TestExpectation = {
  toBe(expected: unknown): unknown
}

type TestRunnerFunction = ((...args: unknown[]) => unknown) & Record<string, unknown>

type TestRuntimeGlobals = {
  afterEach: TestRunnerFunction
  describe: TestRunnerFunction
  expect: ExpectBaseApi
  test: TestRunnerFunction
}
