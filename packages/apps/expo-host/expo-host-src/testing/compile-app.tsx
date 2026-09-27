import { Errors, FS } from '@shared'
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
  options: { appName?: string; signal?: AbortSignal } = {},
): Promise<RuntimeApp.Screen> {
  const assertActive = () => {
    if (options.signal?.aborted) {
      throw Errors.abortError('The runtime test ended before its app was ready.')
    }
  }
  assertActive()
  const compiled = await compileAppForTest(appPath, options)
  assertActive()
  const screen = renderCompiledApp(compiled)
  const unmount = screen.unmount
  let disposed = false
  const abort = () => screen.unmount()
  screen.unmount = () => {
    options.signal?.removeEventListener('abort', abort)
    if (!disposed) {
      disposed = true
      unmount()
    }
  }
  options.signal?.addEventListener('abort', abort, { once: true })
  try {
    assertActive()
    // Navigation restoration intentionally gates the first painted tree on its host-storage read.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await new Promise<void>(resolve => queueMicrotask(resolve))
    })
    assertActive()
    return screen
  } catch (error) {
    screen.unmount()
    throw error
  }
}

async function compileAppForTest(
  appPath: string,
  options: { appName?: string },
): Promise<RuntimeApp.Compiled> {
  const runRoot = await (testRunRoot ??= TestRunRoot.create('compile-app'))
  const testAppRoot = FS.resolvePath(`app-${++renderId}`, runRoot)
  return await TestCompiler.Worker.compileApp(appPath, { appName: options.appName, runtimePackageRoot: testAppRoot })
}
