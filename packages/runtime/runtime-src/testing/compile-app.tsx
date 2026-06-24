import { CLI, FS, Repo } from '@shared'
import { render } from '@testing-library/react-native'
import { type ComponentType, createElement } from 'react'

/** RuntimeScreen represents a rendered React Native Testing Library app screen. */
export type RuntimeScreen = ReturnType<typeof render>

/** CompiledRuntimeApp represents an isolated generated app module ready to render in Jest. */
export type CompiledRuntimeApp = {
  testAppPath: string
}

let renderId = 0

/** compileAndRenderApp compiles a Tao app path, renders it, and returns the test screen. */
export async function compileAndRenderApp(appPath: string): Promise<RuntimeScreen> {
  return renderCompiledApp(await compileAppForTest(appPath))
}

/** compileAppForTest compiles a Tao app path into an isolated runtime test app. */
export async function compileAppForTest(appPath: string): Promise<CompiledRuntimeApp> {
  const repoRoot = Repo.getRoot()
  const runtimePackageRoot = FS.repoPath('packages/runtime')
  const generatedAppRoot = FS.resolvePath('_gen_tao-app', { cwd: runtimePackageRoot })
  const testAppRoot = FS.resolvePath(`_gen_tao-app-test/run-${++renderId}`, { cwd: runtimePackageRoot })
  const testAppPath = FS.resolvePath('App.tsx', { cwd: testAppRoot })

  await CLI.mustRun(FS.repoPath('tao'), {
    args: ['compile', appPath],
    cwd: repoRoot,
  })

  await FS.copyDirectory(generatedAppRoot, testAppRoot)
  return { testAppPath }
}

/** renderCompiledApp renders a previously compiled runtime test app. */
export function renderCompiledApp(compiledApp: CompiledRuntimeApp): RuntimeScreen {
  const testAppPath = compiledApp.testAppPath
  const appModule = require(testAppPath) as { default: ComponentType }
  return render(createElement(appModule.default))
}
