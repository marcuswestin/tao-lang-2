import * as CLI from '../CLI'
import { Assert } from '../core/Assert'
import { throwUnexpected, throwUserInput } from '../core/Errors'
import * as Text from '../core/Text'
import * as FS from '../FS'
import { logProcessError } from '../HCI'
import * as Platform from '../Platform'
import * as ProjectIdentity from '../ProjectIdentity'
import * as Repo from '../Repo'
import { runCleanups } from './TestCleanup'
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

/** Test wraps each case in its own fixture lifetime, including concurrently running cases. */
export const Test = ((...args: any[]) => {
  const callbackIndex = args.findIndex((arg, index) => index > 0 && typeof arg === 'function')
  if (callbackIndex >= 0) {
    const callback = args[callbackIndex] as (...callbackArgs: any[]) => unknown
    args[callbackIndex] = (...callbackArgs: any[]) =>
      temporaryDirectoryScope.run(new Set<string>(), async () => {
        let failure: unknown
        try {
          return await callback(...callbackArgs)
        } catch (error) {
          failure = error
          throw error
        } finally {
          const directories = [...(temporaryDirectoryScope.current() ?? [])]
          const kept = failure === undefined ? [] : directories.filter(directory => keptOnFailure.has(directory))
          for (const directory of kept) {
            temporaryDirectories.delete(directory)
            keptOnFailure.delete(directory)
            logProcessError('test-fixture', `Kept the failed test's Git fixture for debugging: ${directory}`)
          }
          await runCleanups(
            failure,
            directories.filter(directory => !kept.includes(directory)).map(directory => ({
              label: directory,
              run: async () => {
                await FS.remove(directory)
                temporaryDirectories.delete(directory)
                keptOnFailure.delete(directory)
              },
            })),
            { channel: 'test-fixture', subject: 'test directory' },
          )
        }
      })
  }
  return getTestRuntime().test(...args)
}) as TestRunnerFunction
const temporaryDirectories = new Set<string>()
const keptOnFailure = new Set<string>()
const temporaryDirectoryScope = Platform.createAsyncContext<Set<string>>()
let exitCleanupRegistered = false

guardGitDiscovery()

/**
 * guardGitDiscovery stops every git this test process starts from climbing out of a fixture. Git
 * finds its repository by walking up from its working directory, so a fixture whose `git init`
 * failed — the agent sandbox refuses it inside a checkout — hands the fixture's commits and branches
 * to whatever repository encloses it, which for worktree scratch is the real one. Child processes
 * inherit the ceiling: the OS temporary directory, where Git fixtures live, and this worktree's scratch.
 */
function guardGitDiscovery(): void {
  const env = Platform.runtimeProcess.env
  const root = Repo.tryGetRoot()
  const ceilings = [FS.tmpdir(), ...(root === undefined ? [] : [FS.resolvePath('.artifacts/scratch', root)])]
    .map(path => FS.existsSync(path) ? FS.realPathSync(path) : path)
  const existing = (env['GIT_CEILING_DIRECTORIES'] ?? '').split(':').filter((entry: string) => entry.length > 0)
  env['GIT_CEILING_DIRECTORIES'] = [...new Set([...existing, ...ceilings])].join(':')
}

/**
 * mkTestDir creates a unique directory in this worktree's ignored scratch. Use `location: 'host'`
 * only when a test needs its fixture outside this worktree's Git ignore boundary. The test runner
 * removes directories tests did not remove themselves; normal process exit is a second chance.
 * An interrupted run leaves scratch for a later owner-reviewed clean.
 */
export async function mkTestDir(prefix: string, options: { location?: 'host' | 'worktree' } = {}): Promise<string> {
  Assert.input(
    prefix.length > 0 && FS.basename(prefix) === prefix && prefix !== '.' && prefix !== '..',
    `Test directory prefix must be one name: ${JSON.stringify(prefix)}.`,
  )
  const useHost = options.location === 'host'
  const path = await FS.realPath(await (useHost ? FS.mkTmpDir(prefix) : Repo.mkScratchDir(prefix)))
  temporaryDirectories.add(path)
  temporaryDirectoryScope.current()?.add(path)
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

/**
 * mkGitTestDir creates a directory for a fixture that holds Git repositories. It sits in the OS
 * temporary directory, outside every checkout, because the agent sandbox refuses `git init` inside
 * one. A passing test removes it; a failing test keeps it and prints its path for debugging.
 */
export async function mkGitTestDir(prefix: string): Promise<string> {
  const path = await mkTestDir(prefix, { location: 'host' })
  keptOnFailure.add(path)
  return path
}

/** GitTestRepositoryOptions shapes the repository `initGitTestRepository` creates. */
export type GitTestRepositoryOptions = {
  /** Create a bare repository, as a fixture's remote. */
  bare?: boolean
  /** Files for a first commit, which must then succeed too. */
  commit?: { files: Readonly<Record<string, string>>; message?: string }
  /** The unborn branch; `main` unless the fixture needs another. */
  initialBranch?: string
}

/**
 * initGitTestRepository makes `path` a Git repository and throws unless git then resolves `path`
 * itself as the repository, so a failed or misplaced `git init` stops the test instead of leaving
 * the fixture's later commits to land in whatever repository encloses it.
 */
export async function initGitTestRepository(path: string, options: GitTestRepositoryOptions = {}): Promise<void> {
  Assert.input(!(options.bare && options.commit), 'A bare Git test repository cannot take a first commit.')
  await FS.mkdir(path)
  const git = (...args: string[]) => CLI.mustRun('git', { args: ['-C', path, ...args], stdio: 'pipe' })
  const initialBranch = `--initial-branch=${options.initialBranch ?? 'main'}`
  await git('init', '--quiet', initialBranch, ...(options.bare ? ['--bare'] : []))
  const gitDirectory = await FS.realPath((await git('rev-parse', '--absolute-git-dir')).stdout.trim())
  const expected = FS.resolvePath(options.bare ? '.' : '.git', await FS.realPath(path))
  if (gitDirectory !== expected) {
    throwUnexpected(`git init left ${path} outside its own repository: git resolves it to ${gitDirectory}.`)
  }
  if (options.commit === undefined) {
    return
  }
  for (const [relativePath, content] of Object.entries(options.commit.files)) {
    const filePath = FS.resolvePath(relativePath, path)
    await FS.mkdir(FS.dirname(filePath))
    await FS.writeText(filePath, content)
  }
  await git('add', '--all')
  await git(...GIT_TEST_IDENTITY, 'commit', '--quiet', '--no-verify', '-m', options.commit.message ?? 'Initial')
}

/** GIT_TEST_IDENTITY commits as a fixed author, whatever the host's Git configuration says. */
const GIT_TEST_IDENTITY = ['-c', 'user.name=Tao Test', '-c', 'user.email=tao@example.test']

/** WithTaoFilesOptions: `verbatim` writes sources as given without stripping indentation or adding a root marker. */
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
    if (!options.verbatim) {
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', rootDir), '')
      await ProjectIdentity.ensure(rootDir)
    }
    for (const relativePath of Object.keys(files) as Array<keyof Files & string>) {
      const source = files[relativePath]
      Assert.defined(source, 'Tao test fixture source exists', { relativePath })
      const path = FS.resolvePath(relativePath, rootDir)
      await FS.writeText(path, options.verbatim ? source : Text.stripIndent(source))
      paths[relativePath] = path
    }
    if (!options.verbatim) {
      for (const relativePath of Object.keys(files)) {
        if (relativePath.endsWith('/.tao/.gitkeep')) {
          await ProjectIdentity.ensure(FS.dirname(FS.dirname(FS.resolvePath(relativePath, rootDir))))
        }
      }
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
  // Bun exposes skip lazily, so Reflect.ownKeys does not enumerate it.
  Test['skip'] = nextRuntime.test['skip']
  Describe['skip'] = nextRuntime.describe['skip']
  // `copyFunctionProperties` carries the runner's own statics (`expect.any`, `expect.objectContaining`,
  // …) across; these two are Tao's and are restored after it, in case a runner ever spells them too.
  Expect.Is = ExpectIs
  Expect.Unguarded = createUnguardedExpectFunction()
}

/** ExpectApi wraps an active test runner expect function with Tao narrowing helpers. */
type ExpectApi = TestRunnerExpect & {
  Is: <T>(value: unknown, guard: (value: unknown) => value is T) => asserts value is T
  /**
   * Unguarded omits the Langium deep-equality guard but retains safe promise scheduling. It is
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
  return ((...args: any[]) => guardMatchers(getTestRuntime().expect(...args), args[0], false)) as TestRunnerExpect
}

/**
 * guardMatchers protects promise scheduling and, unless opted out, refuses Langium deep equality.
 * Every forwarded call and getter runs against the real matcher object rather than the proxy, so a
 * runner whose matchers keep native internal state is unaffected.
 */
function guardMatchers(matchers: unknown, received: unknown, guard = true, asynchronous = false): any {
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
        return guardMatchers(value, received, guard, asynchronous || property === 'resolves' || property === 'rejects')
      }
      if (typeof value !== 'function') {
        return value
      }
      if (!asynchronous && (!guard || !GUARDED_MATCHERS.has(property))) {
        return value.bind(target)
      }
      return (...args: unknown[]) => {
        const guarded = guard && GUARDED_MATCHERS.has(property)
        if (guarded) {
          refuseLangiumOperand(property, received, args)
        }
        if (asynchronous && received instanceof Promise) {
          return invokeSettledMatcher(received, () => Reflect.apply(value, target, args), settled => {
            if (guarded) {
              refuseLangiumOperand(property, settled, args)
            }
          })
        }
        return Reflect.apply(value, target, args)
      }
    },
  })
}

/**
 * Bun's promise matchers synchronously pump the event loop while their input is pending. From an
 * I/O continuation that can overwrite the current poll batch and lose another child's pipe/exit
 * event forever (oven-sh/bun#33261). Await the input ourselves, then invoke the original matcher
 * with its original, now-settled promise: native negation, rejection and diagnostic semantics stay
 * intact. Awaiting the matcher at its call site is too late to prevent the synchronous re-entry.
 * Only native promises take this path: awaiting a stateful thenable before the runner consumes it
 * would execute it twice. Invalid inputs and Jest's callable rejection inputs stay runner-owned.
 */
async function invokeSettledMatcher(
  received: unknown,
  invoke: () => unknown,
  check: (settled: unknown) => void,
): Promise<unknown> {
  let settled: unknown
  try {
    settled = await received
  } catch (error) {
    settled = error
  }
  check(settled)
  return invoke()
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
