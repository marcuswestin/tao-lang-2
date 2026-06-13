import { afterEach, describe, expect, test } from 'bun:test'
import { AfterEach, Describe, Expect, Jest, type JestApi, setTestRuntime, Test, withTaoFiles } from './Test'

setTestRuntime({
  afterEach,
  describe,
  expect,
  jest: {
    resetModules() {
      getJest().resetModules()
    },
  },
  test,
})

export { AfterEach, Describe, Expect, Jest, Test, withTaoFiles }

function getJest(): JestApi {
  const value = (globalThis as unknown as { jest?: JestApi }).jest

  if (value === undefined) {
    throw new Error(`Test runtime global 'jest' is not available`)
  }

  return value
}
