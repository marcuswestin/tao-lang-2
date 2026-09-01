import { FS } from '@shared'
import { act } from '@testing-library/react-native'
import { renderCompiledApp } from './render-app'
import type { RuntimeApp } from './RuntimeApp'
import { TestCompiler } from './test-compiler/TestCompiler'
import { TestRunRoot } from './test-run-root'

export type { CompiledRuntimeApp, RuntimeScreen } from './RuntimeApp'

let renderId = 0
// Every render in this harness process shares one run root, so the run is one prunable unit.
let testRunRoot: Promise<string> | undefined

/** compileAndRenderApp compiles a selected Tao app path, renders it, and returns the test screen. */
export async function compileAndRenderApp(
  appPath: string,
  options: { appName?: string } = {},
): Promise<RuntimeApp.Screen> {
  const screen = renderCompiledApp(await compileAppForTest(appPath, options))
  // Navigation restoration intentionally gates the first painted tree on its host-storage read.
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await new Promise<void>(resolve => queueMicrotask(resolve))
  })
  return screen
}

async function compileAppForTest(
  appPath: string,
  options: { appName?: string },
): Promise<RuntimeApp.Compiled> {
  const runRoot = await (testRunRoot ??= TestRunRoot.create('compile-app'))
  const testAppRoot = FS.resolvePath(`app-${++renderId}`, runRoot)
  return await TestCompiler.Worker.compileApp(appPath, { appName: options.appName, runtimePackageRoot: testAppRoot })
}
