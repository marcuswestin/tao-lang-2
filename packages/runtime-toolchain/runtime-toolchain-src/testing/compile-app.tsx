import { FS } from '@shared'
import { act } from '@testing-library/react-native'
import { RuntimeToolchainPaths } from '../runtime-toolchain-paths'
import { renderCompiledApp } from './render-app'
import type { RuntimeApp } from './RuntimeApp'
import { TestCompiler } from './test-compiler/TestCompiler'
import { TestRunId } from './test-run-id'

export type { CompiledRuntimeApp, RuntimeScreen } from './RuntimeApp'

let renderId = 0
const testRunRootName = TestRunId.create()

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
  const runtimePackageRoot = RuntimeToolchainPaths.packageRoot
  const testAppRoot = FS.resolvePath(`_gen_tao-app-test/${testRunRootName}-${++renderId}`, runtimePackageRoot)
  return await TestCompiler.Worker.compileApp(appPath, { appName: options.appName, runtimePackageRoot: testAppRoot })
}
