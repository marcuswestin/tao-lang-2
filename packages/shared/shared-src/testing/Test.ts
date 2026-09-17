import { Assert } from '../core/Assert'
import * as Text from '../core/Text'
import * as FS from '../FS'
import { testOverrideSlot } from './TestOverride'

/** AfterEach wraps the active test runner's afterEach hook. */
export const AfterEach = createTestRunnerFunction('afterEach')

/** AfterAll wraps the active test runner's afterAll hook. */
export const AfterAll = createTestRunnerFunction('afterAll')

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

/**
 * MockModule replaces a module specifier with a test double on the active test runner. The call is not
 * hoisted above the importing module's own imports, so register the double first and reach for the module
 * under test through a dynamic `await import(...)` afterwards. A specifier that resolves to nothing becomes
 * a virtual module rather than an error, on both runners.
 */
export function MockModule(specifier: string, factory: () => unknown): void {
  Assert.input(
    !specifier.startsWith('.'),
    `MockModule cannot resolve relative specifier '${specifier}'; use a package or configured alias.`,
  )
  getTestRuntime().mockModule(specifier, factory)
}

/** Test wraps the active test runner's test case API. */
export const Test = createTestRunnerFunction('test')
let temporaryProjectSequence = 0

/**
 * mkTestDir creates a unique temporary directory under the host temp directory. The canonical path
 * is returned because the host temp directory is a symlink on macOS: a test that builds a path from
 * the uncanonical one and compares it with a path the code under test resolved would never match.
 */
export async function mkTestDir(prefix: string): Promise<string> {
  return await FS.realPath(await FS.mkTmpDir(FS.resolvePath(prefix, FS.tmpdir())))
}

/** WithTaoFilesOptions: `verbatim` writes sources as given, with no indent stripping and no synthesized project. */
export type WithTaoFilesOptions = {
  verbatim?: boolean
}

/** withTaoFiles creates temporary Tao source files for a test and removes them afterward. */
export async function withTaoFiles<const Files extends Record<string, string>>(
  prefix: string,
  files: Files,
  testFunction: (paths: { [Path in keyof Files]: string }, rootDir: string) => Promise<void> | void,
  options: WithTaoFilesOptions = {},
): Promise<void> {
  const rootDir = await mkTestDir(prefix)
  const paths = {} as { [Path in keyof Files]: string }

  try {
    if (!options.verbatim && !Object.values(files).some(source => /\bproject\s*\{/u.test(source))) {
      const projectId = `tao-temporary-test-project-${++temporaryProjectSequence}`
      await FS.writeText(
        FS.resolvePath('Project.tao', rootDir),
        `project { id "${projectId}" name "Temporary test project" }`,
      )
    }
    for (const relativePath of Object.keys(files) as Array<keyof Files & string>) {
      const source = files[relativePath]
      Assert.defined(source, 'Tao test fixture source exists', { relativePath })
      const path = FS.resolvePath(relativePath, rootDir)
      await FS.writeText(path, options.verbatim ? source : Text.stripIndent(source))
      paths[relativePath] = path
    }

    await testFunction(paths, rootDir)
  } finally {
    await FS.remove(rootDir)
  }
}

/**
 * setReactNativeDevModeForTest overrides the React Native `__DEV__` global and returns a restore function.
 * Overlapping overrides stack, so restoring in any order leaves the mode the newest live override chose.
 */
export function setReactNativeDevModeForTest(value: boolean): () => void {
  return reactNativeDevModeSlot.install({ configurable: true, value, writable: true })
}

/**
 * setClockForTest pins `Date.now` to a fixed reading or a scripted clock and returns a restore function.
 * Pass a function when a test advances time between steps, so each read observes the value set for that step.
 * Overlapping pins stack, so restoring in any order leaves the clock the newest live pin chose, and the real
 * clock comes back only once every pin has been restored.
 */
export function setClockForTest(now: number | (() => number)): () => void {
  return clockSlot.install(typeof now === 'function' ? now : () => now)
}

/** setTestRuntime configures the active runner used by Tao test wrappers. */
export function setTestRuntime(nextRuntime: TestRuntime): void {
  testRuntime = nextRuntime
  copyFunctionProperties(AfterAll, nextRuntime.afterAll)
  copyFunctionProperties(AfterEach, nextRuntime.afterEach)
  copyFunctionProperties(Describe, nextRuntime.describe)
  copyFunctionProperties(Expect, nextRuntime.expect)
  copyFunctionProperties(Test, nextRuntime.test)
  Expect.Is = ExpectIs
}

/** ExpectApi wraps an active test runner expect function with Tao narrowing helpers. */
type ExpectApi = TestRunnerExpect & {
  Is: <T>(value: unknown, guard: (value: unknown) => value is T) => asserts value is T
}

/** JestApi exposes Jest-only control operations used by runtime tests. */
export type JestApi = {
  resetModules(): void
}

/** TestRuntime provides the active test runner functions for shared Tao test wrappers. */
export type TestRuntime = {
  afterAll: TestRunnerFunction
  afterEach: TestRunnerFunction
  describe: TestRunnerFunction
  expect: TestRunnerExpect
  jest: JestApi
  mockModule: (specifier: string, factory: () => unknown) => void
  test: TestRunnerFunction
}

/** TestRunnerExpect describes the callable expect API from a test runner. */
type TestRunnerExpect = (<T = unknown>(value?: T, ...args: any[]) => any) & Record<string, any>

/** TestRunnerFunction describes callable test runner grouping and hook APIs. */
type TestRunnerFunction = ((...args: any[]) => any) & Record<string, any>

let testRuntime: TestRuntime | undefined

const clockSlot = testOverrideSlot<() => number>({
  read: () => Date.now,
  write: next => {
    Date.now = next
  },
})

const reactNativeDevModeSlot = testOverrideSlot<PropertyDescriptor | undefined>({
  // `getOwnPropertyDescriptor` hands back a fresh object every call, so identity would never match the
  // descriptor this slot wrote; what a re-read has to agree on is the value the property now holds.
  equals: (left, right) =>
    left === right
    || (left !== undefined && right !== undefined
      && left.value === right.value && left.get === right.get && left.set === right.set),
  read: () => Object.getOwnPropertyDescriptor(globalThis, '__DEV__'),
  write: descriptor => {
    if (descriptor === undefined) {
      delete (globalThis as { __DEV__?: unknown }).__DEV__
      return
    }
    Object.defineProperty(globalThis, '__DEV__', descriptor)
  },
})

function ExpectIs<T>(value: unknown, guard: (value: unknown) => value is T): asserts value is T {
  Expect(guard(value)).toBe(true)
}

function createExpectFunction(): TestRunnerExpect {
  return ((...args: any[]) => getTestRuntime().expect(...args)) as TestRunnerExpect
}

function createTestRunnerFunction(key: 'afterAll' | 'afterEach' | 'describe' | 'test'): TestRunnerFunction {
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
  Assert.defined(testRuntime, 'the test runtime to be configured before a test helper runs')

  return testRuntime
}
