import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import {
  AfterAll,
  AfterEach,
  Describe,
  Expect,
  Jest,
  type JestApi,
  mkTestDir,
  setTestRuntime,
  Test,
  withTaoFiles,
} from './Test'
export { app, fence, stubLayout, stubView, tsFence } from './TaoFixtures'

setTestRuntime({
  afterAll,
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

export { AfterAll, AfterEach, Describe, Expect, Jest, mkTestDir, Test, withTaoFiles }

function getJest(): JestApi {
  const value = (globalThis as unknown as { jest?: JestApi }).jest

  if (value === undefined) {
    throw new Error(`Test runtime global 'jest' is not available`)
  }

  return value
}
