import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { throwHostEnvironment } from '../core/Errors'
import { type JestApi, setTestRuntime } from './Test'

export {
  app,
  fence,
  primitiveAppValueSpellings,
  promptTagsApp,
  stubContainer,
  stubView,
  tsFence,
} from './TaoFixtures'
export {
  AfterAll,
  AfterEach,
  Describe,
  Expect,
  initGitTestRepository,
  mkGitTestDir,
  mkTestDir,
  MockModule,
  setClockForTest,
  setReactNativeDevModeForTest,
  Test,
  withTaoFiles,
} from './Test'
export { Deferred, settle, until, type UntilOptions } from './TestAsync'
export { runCleanups } from './TestCleanup'
export { type TestOverrideSlot, testOverrideSlot } from './TestOverride'
export { reactNativeStubs } from './TestReactNative'
export { type CapturedOutput, type FakeTerminal, fakeTerminal, withCapturedOutput } from './TestTerminal'

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
  mockModule(specifier, factory) {
    mock.module(specifier, factory)
  },
  test,
})

function getJest(): JestApi {
  const value = (globalThis as unknown as { jest?: JestApi }).jest

  if (value === undefined) {
    throwHostEnvironment(`Test runtime global 'jest' is not available`)
  }

  return value
}
