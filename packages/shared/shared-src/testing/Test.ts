import { Assert } from '../core/Assert'
import { throwUserInput } from '../core/Errors'
import * as Text from '../core/Text'
import * as FS from '../FS'
import * as Platform from '../Platform'
import * as Repo from '../Repo'
import { testOverrideSlot } from './TestOverride'

/** AfterEach wraps the active test runner's afterEach hook. */
export const AfterEach = createTestRunnerFunction('afterEach')

/** AfterAll wraps the active test runner's afterAll hook. */
export const AfterAll = createTestRunnerFunction('afterAll')

/** Describe wraps the active test runner's describe grouping API. */
export const Describe = createTestRunnerFunction('describe')

/** Expect wraps the active test runner's assertion API with Tao test narrowing helpers. */
export const Expect: ExpectApi = Object.assign(createExpectFunction(), {
  Is: ExpectIs,
  Unguarded: createUnguardedExpectFunction(),
})

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
const temporaryDirectories = new Set<string>()
let exitCleanupRegistered = false

/**
 * mkTestDir creates a unique directory in this worktree's ignored scratch. Use `location: 'host'`
 * only when a test needs its fixture outside this worktree's Git ignore boundary. Normal process
 * exit removes directories tests did not remove themselves. An interrupted run leaves scratch for
 * a later owner-reviewed clean.
 */
export async function mkTestDir(prefix: string, options: { location?: 'host' | 'worktree' } = {}): Promise<string> {
  Assert.input(
    prefix.length > 0 && FS.basename(prefix) === prefix && prefix !== '.' && prefix !== '..',
    `Test directory prefix must be one name: ${JSON.stringify(prefix)}.`,
  )
  const useHost = options.location === 'host'
  const path = await FS.realPath(await (useHost ? FS.mkTmpDir(prefix) : Repo.mkScratchDir(prefix)))
  temporaryDirectories.add(path)
  if (!exitCleanupRegistered) {
    exitCleanupRegistered = true
    Platform.onProcessExit(() => {
      for (const directory of temporaryDirectories) {
        try {
          FS.removeSync(directory)
        } catch {
          // An interrupted cleanup leaves worktree scratch for the next explicit clean.
        }
      }
    })
  }
  return path
}

/** WithTaoFilesOptions: `verbatim` writes sources as given, with no indent stripping and no synthesized project. */
export type WithTaoFilesOptions = {
  location?: 'host' | 'worktree'
  verbatim?: boolean
}

/** withTaoFiles creates temporary Tao source files for a test and removes them afterward. */
export async function withTaoFiles<const Files extends Record<string, string>>(
  prefix: string,
  files: Files,
  testFunction: (paths: { [Path in keyof Files]: string }, rootDir: string) => Promise<void> | void,
  options: WithTaoFilesOptions = {},
): Promise<void> {
  const rootDir = await mkTestDir(prefix, options)
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
  // `copyFunctionProperties` carries the runner's own statics (`expect.any`, `expect.objectContaining`,
  // …) across; these two are Tao's and are restored after it, in case a runner ever spells them too.
  Expect.Is = ExpectIs
  Expect.Unguarded = createUnguardedExpectFunction()
}

/** ExpectApi wraps an active test runner expect function with Tao narrowing helpers. */
type ExpectApi = TestRunnerExpect & {
  Is: <T>(value: unknown, guard: (value: unknown) => value is T) => asserts value is T
  /**
   * Unguarded returns the runner's raw matcher object, with no Langium deep-equality guard. It is
   * for the rare test that genuinely needs structural equality on parsed nodes and accepts that a
   * failure may print a node the formatter cannot bound; assert on fields wherever you can instead.
   */
  Unguarded: TestRunnerExpect
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

/**
 * Deep-equality matchers print both operands when they fail, and bun's formatter expands a value
 * reachable by several paths once per path. A Langium AST node is reachable through `$container`,
 * `$document` and `$cstNode` at every level, so one failing `toEqual` on two nodes went from 185 MB
 * to 4.1 GB in two seconds and took a 128 GB machine out of application memory (bun issue #34178,
 * fix PR #34179 unreleased). These matchers therefore refuse a Langium-shaped operand outright.
 */
const GUARDED_MATCHERS = new Set([
  'toContainEqual',
  'toEqual',
  'toMatchInlineSnapshot',
  'toMatchObject',
  'toMatchSnapshot',
  'toStrictEqual',
])

/** The chains that re-expose the same matchers, and so need the same guard. */
const GUARDED_MATCHER_CHAINS = new Set(['not', 'rejects', 'resolves'])

/** How many values the shape check may inspect. The guard must never be the slow thing. */
const LANGIUM_SCAN_BUDGET = 64

function createExpectFunction(): TestRunnerExpect {
  return ((...args: any[]) => guardMatchers(getTestRuntime().expect(...args), args[0])) as TestRunnerExpect
}

function createUnguardedExpectFunction(): TestRunnerExpect {
  return ((...args: any[]) => getTestRuntime().expect(...args)) as TestRunnerExpect
}

/**
 * guardMatchers wraps a runner matcher object so the deep-equality matchers refuse a Langium node.
 * Every forwarded call and getter runs against the real matcher object rather than the proxy, so a
 * runner whose matchers keep native internal state is unaffected.
 */
function guardMatchers(matchers: unknown, received: unknown): any {
  if (matchers === null || typeof matchers !== 'object') {
    return matchers
  }
  return new Proxy(matchers, {
    get(target, property) {
      const value = Reflect.get(target, property)
      if (typeof property !== 'string') {
        return value
      }
      if (GUARDED_MATCHER_CHAINS.has(property)) {
        return guardMatchers(value, received)
      }
      if (typeof value !== 'function') {
        return value
      }
      if (!GUARDED_MATCHERS.has(property)) {
        return value.bind(target)
      }
      return (...args: unknown[]) => {
        refuseLangiumOperand(property, received, args)
        return Reflect.apply(value, target, args)
      }
    },
  })
}

function refuseLangiumOperand(matcher: string, received: unknown, args: readonly unknown[]): void {
  const operand = [received, ...args].some(value => hasLangiumNodeShape(value))
  if (!operand) {
    return
  }
  throwUserInput(
    `Expect(...).${matcher} refuses a Langium AST node. Bun's formatter prints a value once per path`
      + ` that reaches it, and an AST node is reachable through $container, $document and $cstNode at`
      + ` every level, so one failing comparison expands exponentially — this has already taken a`
      + ` 128 GB machine out of application memory. Assert on specific fields instead:`
      + ` Expect(nodes).toHaveLength(2), Expect(node.$type).toBe('Member'), or compare a mapped array`
      + ` of names. If this test genuinely needs structural equality on parsed nodes and accepts the`
      + ` risk, use Expect.Unguarded(value).${matcher}.`,
  )
}

/**
 * hasLangiumNodeShape looks at the value, its array elements, and a plain object's own values one
 * level deep, within a fixed budget. It never follows `$container` — recursing into the multiply
 * reachable links is the very thing that explodes.
 */
function hasLangiumNodeShape(value: unknown): boolean {
  let budget = LANGIUM_SCAN_BUDGET
  const inspect = (candidate: unknown, depth: number): boolean => {
    if (budget <= 0 || candidate === null || typeof candidate !== 'object') {
      return false
    }
    budget -= 1
    if (isLangiumNode(candidate)) {
      return true
    }
    if (depth <= 0) {
      return false
    }
    if (Array.isArray(candidate)) {
      return candidate.some(entry => inspect(entry, depth - 1))
    }
    return isPlainObject(candidate) && Object.values(candidate).some(entry => inspect(entry, depth - 1))
  }
  return inspect(value, 1)
}

function isLangiumNode(value: object): boolean {
  if (Array.isArray(value) || !isPlainObject(value)) {
    return false
  }
  const node = value as Record<string, unknown>
  return typeof node['$type'] === 'string' && (node['$container'] !== undefined || node['$cstNode'] !== undefined)
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
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
