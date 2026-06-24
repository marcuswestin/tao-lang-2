import {
  compileAndRenderApp,
  compileAppForTest,
  type CompiledRuntimeApp,
  renderCompiledApp,
  type RuntimeScreen,
} from '@runtime/testing/compile-app'
import { FS, Text } from '@shared'
import { Expect } from '@shared/test'

export { compileAndRenderApp, compileAppForTest, renderCompiledApp }
export type { CompiledRuntimeApp, RuntimeScreen }

type RuntimeFiles = Record<string, string>
type RuntimeScreenAssertions = (screen: RuntimeScreen) => void | Promise<void>

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

/** testCompileFiles compiles temporary Tao files, renders the entry file, and runs screen assertions. */
export async function testCompileFiles(
  entryFile: string,
  files: RuntimeFiles,
  testsFunction: RuntimeScreenAssertions,
): Promise<void> {
  const appDir = await FS.mkTmpDir(FS.resolvePath('tao-runtime-e2e-', { cwd: FS.tmpdir() }))
  const appPath = FS.resolvePath(entryFile, { cwd: appDir })

  try {
    for (const [relativePath, source] of Object.entries(files)) {
      await FS.writeText(FS.resolvePath(relativePath, { cwd: appDir }), Text.stripIndent(source))
    }
    const screen = await compileAndRenderApp(appPath)

    await testsFunction(screen)
  } finally {
    await FS.remove(appDir)
  }
}
