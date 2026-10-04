import { RuntimeTesting } from '@expo-host/testing/runtime-testing'
import { beforeEach } from '@jest/globals'
import TR from '@runtime/TR'
import { Errors, FS } from '@shared'
import { AfterAll, AfterEach, Expect, withTaoFiles } from '@shared/test'
import { cleanup } from '@testing-library/react-native'

/** compileAndRenderApp keeps local Jest renders within the test that requested them. */
export async function compileAndRenderApp(
  appPath: string,
  options: { appName?: string } = {},
): Promise<RuntimeScreen> {
  return await RuntimeTesting.compileAndRenderApp(appPath, { ...options, signal: activeLifetime?.signal })
}
export type RuntimeScreen = RuntimeTesting.Screen

type RuntimeFiles = Record<string, string>
type RuntimeFilesSource = RuntimeFiles | (() => Promise<RuntimeFiles>)
type RuntimeScreenAssertions = (screen: RuntimeScreen) => void | Promise<void>
type RuntimeScreensAssertions = (screens: Readonly<Record<string, RuntimeScreen>>) => void | Promise<void>
let activeLifetime: AbortController | undefined

/** registerRuntimeE2ELifecycle registers shared compiler and render cleanup for a runtime E2E suite. */
export function registerRuntimeE2ELifecycle(): { begin(): void; end(): void } {
  const begin = () => {
    activeLifetime?.abort(Errors.abortError('The previous runtime test ended.'))
    activeLifetime = new AbortController()
    TR.Navigation.beginTest()
  }
  const end = () => {
    const expired = activeLifetime
    activeLifetime = undefined
    expired?.abort(Errors.abortError('The runtime test ended.'))
    cleanup()
    TR.setDevMode()
  }
  beforeEach(begin)

  AfterAll(async () => {
    await RuntimeTesting.stopTestCompiler()
  })

  AfterEach(end)
  return { begin, end }
}

/** ExpectScreen wraps runtime render assertions in user-facing language. */
export function ExpectScreen(screen: RuntimeScreen): { toHaveText(text: string): void } {
  return {
    toHaveText(text: string): void {
      Expect(screen.getByText(text)).toBeDefined()
    },
  }
}

/** testCompileApp compiles a temporary Tao app, renders it, and runs assertions against the screen. */
export async function testCompileApp(
  source: string,
  testsFunction: RuntimeScreenAssertions,
): Promise<void> {
  await testCompileFiles('App.tao', { 'App.tao': source }, testsFunction)
}

/** testCompileApps renders multiple named apps from one source for app-local behavior comparisons. */
export async function testCompileApps(
  source: string,
  appNames: readonly string[],
  testsFunction: RuntimeScreensAssertions,
): Promise<void> {
  const signal = activeLifetime?.signal
  await withTaoFiles('tao-runtime-e2e-multi-', {
    'App.tao': source,
  }, async paths => {
    const screens: Record<string, RuntimeScreen> = {}
    for (const appName of appNames) {
      screens[appName] = await RuntimeTesting.compileAndRenderApp(paths['App.tao'], { appName, signal })
    }
    assertActive(signal)
    await testsFunction(screens)
  }, { location: 'host' })
}

/** testCompileFiles compiles temporary Tao files, renders the entry file, and runs screen assertions. */
export async function testCompileFiles(
  entryFile: string,
  source: RuntimeFilesSource,
  testsFunction: RuntimeScreenAssertions,
): Promise<void> {
  const signal = activeLifetime?.signal
  assertActive(signal)
  const files = typeof source === 'function' ? await source() : source
  assertActive(signal)
  await withTaoFiles('tao-runtime-e2e-', files, async (_paths, rootDir) => {
    const screen = await RuntimeTesting.compileAndRenderApp(FS.resolvePath(entryFile, rootDir), { signal })
    assertActive(signal)
    await testsFunction(screen)
  }, { location: 'host' })
}

function assertActive(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw Errors.abortError('The runtime test ended before its fixture was ready.')
  }
}
