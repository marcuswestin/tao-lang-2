import { CLI, FS, Repo, Text } from '@shared'
import { Expect } from '@shared/test'
import { render } from '@testing-library/react-native'
import { type ComponentType, createElement } from 'react'

export type RuntimeScreen = ReturnType<typeof render>

type RuntimeFiles = Record<string, string>
type RuntimeScreenAssertions = (screen: RuntimeScreen) => void | Promise<void>

let renderId = 0

/** compileAndRenderApp compiles a Tao app path, renders it, and returns the test screen. */
export async function compileAndRenderApp(appPath: string): Promise<RuntimeScreen> {
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
  const appModule = require(testAppPath) as { default: ComponentType }
  return render(createElement(appModule.default))
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
