import Compiler from '@compiler'
import { FS } from '@shared'

type GenerateAppOptions = {
  runtimePackageRoot?: string
}

type GeneratedApp = {
  sourcePath: string
  outputPath: string
  code: string
}

/** generateApp generates the runtime app module from a Tao app file. */
async function generateApp(appPath: string, opts: GenerateAppOptions = {}): Promise<GeneratedApp> {
  const runtimePackageRoot = opts.runtimePackageRoot ?? await defaultRuntimePackageRoot()
  const sourcePath = FS.resolvePath(appPath)
  const generatedAppPath = FS.resolvePath('_gen_tao-app/App.tsx', { cwd: runtimePackageRoot })
  const compiled = await Compiler.compileFile(sourcePath)

  await writeGeneratedApp(generatedAppPath, compiled.code)

  return {
    sourcePath,
    outputPath: generatedAppPath,
    code: compiled.code,
  }
}

/** Runtime exposes Expo runtime app generation functions. */
const Runtime = {
  generateApp,
}

export default Runtime

async function defaultRuntimePackageRoot(): Promise<string> {
  return await FS.resolveRepoPath('packages/runtime')
}

async function writeGeneratedApp(path: string, code: string): Promise<void> {
  try {
    if (await FS.readText(path) === code) {
      return
    }
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error
    }
  }
  await FS.writeText(path, code)
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT'
}
