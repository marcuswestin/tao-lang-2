import { RuntimeTesting } from '@runtime/testing/runtime-testing'
import { FS, Text } from '@shared'
import { Expect, mkTestDir } from '@shared/test'

/** compileAndRenderApp exposes the shared runtime compile/render helper to local Jest tests. */
export const compileAndRenderApp = RuntimeTesting.compileAndRenderApp
export type RuntimeScreen = RuntimeTesting.Screen

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
  const appDir = await mkTestDir('tao-runtime-e2e-')
  const appPath = FS.resolvePath(entryFile, appDir)

  try {
    for (const [relativePath, source] of Object.entries(files)) {
      await FS.writeText(FS.resolvePath(relativePath, appDir), Text.stripIndent(source))
    }
    const screen = await RuntimeTesting.compileAndRenderApp(appPath)

    await testsFunction(screen)
  } finally {
    await FS.remove(appDir)
  }
}
