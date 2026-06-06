import { CLI, FS, Text } from '@shared'
import { Jest } from '@shared/test'
import { render } from '@testing-library/react-native'
import { type ComponentType, createElement } from 'react'

type RuntimeScreen = ReturnType<typeof render>

/** compileAndRenderApp compiles a Tao app path, renders it, and returns the test screen. */
export async function compileAndRenderApp(repoRoot: string, appPath: string): Promise<RuntimeScreen> {
  const runtimePackageRoot = FS.repoPath('packages/runtime')
  const generatedAppPath = FS.resolvePath('_gen_tao-app/App.tsx', { cwd: runtimePackageRoot })

  await CLI.mustRun(FS.repoPath('dev'), {
    args: ['compile-app', appPath],
    cwd: repoRoot,
  })

  Jest.resetModules()
  const appModule = require(generatedAppPath) as { default: ComponentType }
  return render(createElement(appModule.default))
}

/** testCompileApp compiles a temporary Tao app, renders it, and runs assertions against the screen. */
export async function testCompileApp(
  repoRoot: string,
  appPath: string,
  source: string,
  testsFunction: (screen: RuntimeScreen) => void,
): Promise<void> {
  const appDir = FS.dirname(appPath)

  try {
    await FS.writeText(appPath, Text.stripIndent(source))
    const screen = await compileAndRenderApp(repoRoot, appPath)

    testsFunction(screen)
  } finally {
    await FS.remove(appDir)
  }
}
