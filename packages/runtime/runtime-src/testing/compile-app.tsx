import { FS, Repo } from '@shared'
import { renderCompiledApp } from './render-app'
import type { RuntimeApp } from './RuntimeApp'
import { TestCompiler } from './test-compiler/TestCompiler'
import { TestRunId } from './test-run-id'

export type { CompiledRuntimeApp, RuntimeScreen } from './RuntimeApp'

let renderId = 0
const testRunRootName = TestRunId.create()

/** compileAndRenderApp compiles a Tao app path, renders it, and returns the test screen. */
export async function compileAndRenderApp(appPath: string): Promise<RuntimeApp.Screen> {
  return renderCompiledApp(await compileAppForTest(appPath))
}

async function compileAppForTest(appPath: string): Promise<RuntimeApp.Compiled> {
  const runtimePackageRoot = Repo.resolvePath('packages/runtime')
  const testAppRoot = FS.resolvePath(`_gen_tao-app-test/${testRunRootName}-${++renderId}`, runtimePackageRoot)
  return await TestCompiler.Worker.compileApp(appPath, { runtimePackageRoot: testAppRoot })
}
