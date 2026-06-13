import {
  AfterEach,
  Describe,
  Expect,
  Jest,
  type JestApi,
  setTestRuntime,
  Test,
  type TestRuntime,
  withTaoFiles,
} from './Test'

const testGlobals = globalThis as unknown as Partial<TestRuntime>

setTestRuntime({
  afterEach: getTestRuntime('afterEach'),
  describe: getTestRuntime('describe'),
  expect: getTestRuntime('expect'),
  jest: getJest(),
  test: getTestRuntime('test'),
})

export { AfterEach, Describe, Expect, Jest, Test, withTaoFiles }

function getTestRuntime<Key extends keyof Omit<TestRuntime, 'jest'>>(key: Key): TestRuntime[Key] {
  const value = testGlobals[key]

  if (value === undefined) {
    throw new Error(`Test runtime global '${key}' is not available`)
  }

  return value as TestRuntime[Key]
}

function getJest(): JestApi {
  return (require('@jest/globals') as { jest: JestApi }).jest
}
