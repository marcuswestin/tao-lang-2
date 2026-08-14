import { Assert } from '../core/Assert'
import * as Text from '../core/Text'
import * as FS from '../FS'

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

/** Test wraps the active test runner's test case API. */
export const Test = createTestRunnerFunction('test')

/** mkTestDir creates a unique temporary directory under the host temp directory. */
export async function mkTestDir(prefix: string): Promise<string> {
  return await FS.mkTmpDir(FS.resolvePath(prefix, FS.tmpdir()))
}

/** withTaoFiles creates temporary Tao source files for a test and removes them afterward. */
export async function withTaoFiles<const Files extends Record<string, string>>(
  prefix: string,
  files: Files,
  testFunction: (paths: { [Path in keyof Files]: string }, rootDir: string) => Promise<void> | void,
): Promise<void> {
  const rootDir = await mkTestDir(prefix)
  const paths = {} as { [Path in keyof Files]: string }

  try {
    for (const relativePath of Object.keys(files) as Array<keyof Files & string>) {
      const source = files[relativePath]
      Assert.defined(source, 'Tao test fixture source exists', { relativePath })
      const path = FS.resolvePath(relativePath, rootDir)
      await FS.writeText(path, Text.stripIndent(source))
      paths[relativePath] = path
    }

    await testFunction(paths, rootDir)
  } finally {
    await FS.remove(rootDir)
  }
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
  test: TestRunnerFunction
}

/** TestRunnerExpect describes the callable expect API from a test runner. */
type TestRunnerExpect = (<T = unknown>(value?: T, ...args: any[]) => any) & Record<string, any>

/** TestRunnerFunction describes callable test runner grouping and hook APIs. */
type TestRunnerFunction = ((...args: any[]) => any) & Record<string, any>

let testRuntime: TestRuntime | undefined

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
  if (testRuntime === undefined) {
    throw new Error('Test runtime has not been configured')
  }

  return testRuntime
}
