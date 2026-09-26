import { throwHostEnvironment } from '../core/Errors'
import { type JestApi, setTestRuntime, type TestRuntime } from './Test'

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
  Jest,
  mkGitTestDir,
  mkTestDir,
  MockModule,
  setClockForTest,
  setReactNativeDevModeForTest,
  Test,
  withTaoFiles,
} from './Test'
export { Deferred, settle, until, type UntilOptions } from './TestAsync'
export { type TestOverrideSlot, testOverrideSlot } from './TestOverride'
export { reactNativeStubs } from './TestReactNative'
export { type CapturedOutput, type FakeTerminal, fakeTerminal, withCapturedOutput } from './TestTerminal'

/** JestModuleApi adds Jest's module-replacement control to the shared Jest control surface. */
type JestModuleApi = JestApi & {
  mock(specifier: string, factory: () => unknown, options?: { virtual?: boolean }): void
}

const testGlobals = globalThis as unknown as Partial<TestRuntime>

setTestRuntime({
  afterEach: getTestRuntime('afterEach'),
  afterAll: getTestRuntime('afterAll'),
  describe: getTestRuntime('describe'),
  expect: getTestRuntime('expect'),
  jest: getJest(),
  // `virtual` matches Bun's `mock.module`, which registers a double for any specifier: without it Jest
  // rejects a specifier it cannot resolve, and the same test would only work on one of the two runners.
  mockModule(specifier, factory) {
    getJest().mock(specifier, factory, { virtual: true })
  },
  test: getTestRuntime('test'),
})

function getTestRuntime<Key extends keyof Omit<TestRuntime, 'jest' | 'mockModule'>>(key: Key): TestRuntime[Key] {
  const value = testGlobals[key]

  if (value === undefined) {
    throwHostEnvironment(`Test runtime global '${key}' is not available`)
  }

  return value as TestRuntime[Key]
}

function getJest(): JestModuleApi {
  return (require('@jest/globals') as { jest: JestModuleApi }).jest
}
