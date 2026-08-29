import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { type JestApi, setTestRuntime } from './Test'

export { app, fence, stubLayout, stubView, tsFence } from './TaoFixtures'
export {
  AfterAll,
  AfterEach,
  Describe,
  Expect,
  Jest,
  mkTestDir,
  setReactNativeDevModeForTest,
  Test,
  withTaoFiles,
} from './Test'

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

function getJest(): JestApi {
  const value = (globalThis as unknown as { jest?: JestApi }).jest

  if (value === undefined) {
    throw new Error(`Test runtime global 'jest' is not available`)
  }

  return value
}
