import { FS } from '@shared'
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
  return renderCompiledApp(await compileAppForTest(appPath, options))
}

async function compileAppForTest(
  appPath: string,
  options: { appName?: string },
): Promise<RuntimeApp.Compiled> {
  const runtimePackageRoot = RuntimeToolchainPaths.packageRoot
  const testAppRoot = FS.resolvePath(`_gen_tao-app-test/${testRunRootName}-${++renderId}`, runtimePackageRoot)
  return await TestCompiler.Worker.compileApp(appPath, { appName: options.appName, runtimePackageRoot: testAppRoot })
}
