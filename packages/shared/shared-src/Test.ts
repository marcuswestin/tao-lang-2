/** AfterEach wraps the active test runner's afterEach hook. */
export const AfterEach = createTestRunnerFunction('afterEach')

/** Describe wraps the active test runner's describe grouping API. */
export const Describe = createTestRunnerFunction('describe')

/** Expect wraps the active test runner's assertion API with Tao test narrowing helpers. */
export const Expect: ExpectApi = Object.assign(createExpectFunction(), { Is: ExpectIs })

/** Jest wraps the active Jest control API for Jest-only runtime tests. */
export const Jest: JestApi = {
  resetModules() {
    getTestRuntime().jest.resetModules()
  },
}

/** Test wraps the active test runner's test case API. */
export const Test = createTestRunnerFunction('test')

/** setTestRuntime configures the active runner used by Tao test wrappers. */
export function setTestRuntime(nextRuntime: TestRuntime): void {
  testRuntime = nextRuntime
  copyFunctionProperties(AfterEach, nextRuntime.afterEach)
  copyFunctionProperties(Describe, nextRuntime.describe)
  copyFunctionProperties(Expect, nextRuntime.expect)
  copyFunctionProperties(Test, nextRuntime.test)
  Expect.Is = ExpectIs
}

/** DynamicMatcher represents assertion matcher chains from the active test runner. */
export type DynamicMatcher = ((...args: any[]) => any) & Record<string, any>

/** ExpectApi wraps an active test runner expect function with Tao narrowing helpers. */
export type ExpectApi = TestRunnerExpect & {
  Is: <T>(value: unknown, guard: (value: unknown) => value is T) => asserts value is T
}

/** JestApi exposes Jest-only control operations used by runtime tests. */
export type JestApi = {
  resetModules(): void
}

/** TestRuntime provides the active test runner functions for shared Tao test wrappers. */
export type TestRuntime = {
  afterEach: TestRunnerFunction
  describe: TestRunnerFunction
  expect: TestRunnerExpect
  jest: JestApi
  test: TestRunnerFunction
}

/** TestRunnerExpect describes the callable expect API from a test runner. */
export type TestRunnerExpect = (<T = unknown>(value?: T, ...args: any[]) => any) & Record<string, any>

/** TestRunnerFunction describes callable test runner grouping and hook APIs. */
export type TestRunnerFunction = ((...args: any[]) => any) & Record<string, any>

let testRuntime: TestRuntime | undefined

function ExpectIs<T>(value: unknown, guard: (value: unknown) => value is T): asserts value is T {
  Expect(guard(value)).toBe(true)
}

function createExpectFunction(): TestRunnerExpect {
  return ((...args: any[]) => getTestRuntime().expect(...args)) as TestRunnerExpect
}

function createTestRunnerFunction(key: 'afterEach' | 'describe' | 'test'): TestRunnerFunction {
  return ((...args: any[]) => getTestRuntime()[key](...args)) as TestRunnerFunction
}

function copyFunctionProperties(
  target: TestRunnerFunction | TestRunnerExpect,
  source: TestRunnerFunction | TestRunnerExpect,
): void {
  for (const key of Reflect.ownKeys(source)) {
    if (key === 'length' || key === 'name' || key === 'prototype') {
      continue
    }

    const descriptor = Object.getOwnPropertyDescriptor(source, key)
    if (descriptor !== undefined) {
      Object.defineProperty(target, key, descriptor)
    }
  }
}

function getTestRuntime(): TestRuntime {
  if (testRuntime === undefined) {
    throw new Error('Test runtime has not been configured')
  }

  return testRuntime
}
