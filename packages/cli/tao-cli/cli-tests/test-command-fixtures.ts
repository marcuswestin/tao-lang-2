import { RuntimeTesting } from '@expo-host/testing/runtime-testing'
import { FS, Platform, Text } from '@shared'

export const taoApp = (name: string) => `
  use Text from @tao/ui
  app ${name} { id "${name.toLowerCase()}" version "1.0.0" name "${name}" view Main }
  view Main() { render Text("${name}") }
`

export const taoTest = (name: string) => `
  use ${name} from ./
  test "${name}" {
    test "runs" {
      run ${name}
      expect text "${name}"
    }
  }
`

/** withJestStub points the runtime test runner at an inert module for the duration of one test. */
export async function withJestStub(rootDir: string, run: () => Promise<void>): Promise<void> {
  await withEnv('TAO_TEST_JEST_PATH', FS.resolvePath('jest-stub.mjs', rootDir), run)
}

/** withRuntimeRoot compiles one run's generated code under a throwaway runtime package root. */
export async function withRuntimeRoot(runtimeRoot: string, run: () => Promise<void>): Promise<void> {
  await withEnv('TAO_TEST_RUNTIME_ROOT', runtimeRoot, run)
}

export async function withEnv(name: string, value: string | undefined, run: () => Promise<void>): Promise<void> {
  const previous = Platform.runtimeProcess.env[name]
  if (value === undefined) {
    delete Platform.runtimeProcess.env[name]
  } else {
    Platform.runtimeProcess.env[name] = value
  }
  try {
    await run()
  } finally {
    if (previous === undefined) {
      delete Platform.runtimeProcess.env[name]
    } else {
      Platform.runtimeProcess.env[name] = previous
    }
  }
}

/** argvEchoStubSource writes a runtime test runner stand-in that reports the arguments it received. */
export function argvEchoStubSource(): string {
  return 'process.stderr.write(`runner args: ${process.argv.slice(2).join(" ")}\\n`)\n'
}

export function outputText(result: { stderr: string; stdout: string }): string {
  return Text.stripAnsi(`${result.stdout}${result.stderr}`)
}

export const reportFixture = {
  '.tao/.gitkeep': '',
  'App.tao': taoApp('Reported'),
  'App.test.tao': taoTest('Reported'),
} as const

/** listRunRoots lists the generated `tao test` run roots left under one runtime package root. */
export async function listRunRoots(runtimeRoot: string): Promise<string[]> {
  const categoryRoot = FS.resolvePath('_gen_tao-app-test/tao-test-command', runtimeRoot)
  // The category also holds the reuse index, which is not generated code and never a run root.
  return await FS.isDirectory(categoryRoot)
    ? (await FS.listDir(categoryRoot)).filter(name => name.startsWith('run-'))
    : []
}

/** writeStaleRunRoot writes a run root whose id claims a run finished long before this one. */
export async function writeStaleRunRoot(runtimeRoot: string, ageHours: number): Promise<string> {
  const name = `run-${Date.now() - ageHours * 60 * 60 * 1000}-${Math.random().toString(36).slice(2)}`
  await FS.writeText(FS.resolvePath(`_gen_tao-app-test/tao-test-command/${name}/App.tsx`, runtimeRoot), '')
  return name
}

export const lifecycleFixture = {
  '.tao/.gitkeep': '',
  'App.tao': taoApp('Lifecycle'),
  'App.test.tao': taoTest('Lifecycle'),
} as const

export const reuseFixture = {
  '.tao/.gitkeep': '',
  'App.tao': taoApp('Reused'),
  'App.test.tao': taoTest('Reused'),
} as const

/** COMPILED and REUSED are the phase lines that say which of the two paths one run took. */
export const COMPILED = 'Compiling apps'

export const REUSED = 'Reusing compiled apps'

/**
 * taoTestJourneys writes a Tao test file of `count` journeys, which is what decides whether a run
 * has enough work to be worth dividing between Jest entrypoints at all.
 */
function taoTestJourneys(name: string, count: number): string {
  return [
    `use ${name} from ./`,
    `test "${name}" {`,
    ...Array.from({ length: count }, (_unused, index) => [
      `  test "runs ${index + 1}" {`,
      `    run ${name}`,
      `    expect text "${name}"`,
      '  }',
    ]).flat(),
    '}',
    '',
  ].join('\n')
}

/**
 * splittableFixture is two Tao test files carrying between them exactly the journeys two Jest
 * entrypoints need to be worth their two module registries.
 */
export const splittableFixture = {
  '.tao/.gitkeep': '',
  'One/App.tao': taoApp('SplitOne'),
  'One/App.test.tao': taoTestJourneys('SplitOne', RuntimeTesting.TestHarnessFiles.JOURNEYS_PER_SHARD),
  'Two/App.tao': taoApp('SplitTwo'),
  'Two/App.test.tao': taoTestJourneys('SplitTwo', RuntimeTesting.TestHarnessFiles.JOURNEYS_PER_SHARD),
} as const

/** listEntrypoints lists the Jest entrypoints of the plan a run `width` workers wide generated. */
export async function listEntrypoints(runtimeRoot: string, width: number): Promise<string[]> {
  const found: string[] = []
  // Plans live beside the run roots rather than inside one, so that the directory Jest is configured
  // with does not move from compile to compile.
  const plans = FS.resolvePath(
    `_gen_tao-app-test/tao-test-command/${RuntimeTesting.TestHarnessFiles.DIRECTORY_NAME}`,
    runtimeRoot,
  )
  for (const plan of await FS.isDirectory(plans) ? await FS.listDir(plans) : []) {
    if (plan.startsWith(`${width}-`)) {
      found.push(...await FS.listDir(FS.resolvePath(plan, plans)))
    }
  }
  return found.toSorted()
}

/** listCachedFingerprints lists the reuse index entries left under one runtime package root. */
export async function listCachedFingerprints(runtimeRoot: string): Promise<string[]> {
  const cacheRoot = FS.resolvePath('_gen_tao-app-test/tao-test-command/.cache', runtimeRoot)
  return await FS.isDirectory(cacheRoot) ? await FS.listDir(cacheRoot) : []
}
