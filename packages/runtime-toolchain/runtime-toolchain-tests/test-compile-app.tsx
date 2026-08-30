import { beforeEach } from '@jest/globals'
import { RuntimeTesting } from '@runtime-toolchain/testing/runtime-testing'
import TR from '@runtime/TR'
import { FS } from '@shared'
import { AfterAll, AfterEach, Expect, withTaoFiles } from '@shared/test'
import { cleanup } from '@testing-library/react-native'

/** compileAndRenderApp exposes the shared runtime compile/render helper to local Jest tests. */
export const compileAndRenderApp = RuntimeTesting.compileAndRenderApp
export type RuntimeScreen = RuntimeTesting.Screen

type RuntimeFiles = Record<string, string>
type RuntimeScreenAssertions = (screen: RuntimeScreen) => void | Promise<void>
type RuntimeScreensAssertions = (screens: Readonly<Record<string, RuntimeScreen>>) => void | Promise<void>

/** registerRuntimeE2ELifecycle registers shared compiler and render cleanup for a runtime E2E suite. */
export function registerRuntimeE2ELifecycle(): void {
  beforeEach(() => {
    TR.Navigation.beginTest()
  })

  AfterAll(async () => {
    await RuntimeTesting.stopTestCompiler()
  })

  AfterEach(() => {
    cleanup()
    TR.setDevMode()
  })
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
  await withTaoFiles('tao-runtime-e2e-multi-', { 'App.tao': source }, async paths => {
    const screens: Record<string, RuntimeScreen> = {}
    for (const appName of appNames) {
      screens[appName] = await RuntimeTesting.compileAndRenderApp(paths['App.tao'], { appName })
    }
    await testsFunction(screens)
  })
}

/** testCompileFiles compiles temporary Tao files, renders the entry file, and runs screen assertions. */
export async function testCompileFiles(
  entryFile: string,
  files: RuntimeFiles,
  testsFunction: RuntimeScreenAssertions,
): Promise<void> {
  await withTaoFiles('tao-runtime-e2e-', files, async (_paths, rootDir) => {
    const screen = await RuntimeTesting.compileAndRenderApp(FS.resolvePath(entryFile, rootDir))

    await testsFunction(screen)
  })
}
