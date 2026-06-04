import Compiler from '@compiler'
import { FS, Platform, Repo } from '@shared'

type GenerateAppOptions = {
  repoRoot?: string
  runtimePackageRoot?: string
  sourceBaseDir?: string
}

type GeneratedApp = {
  sourcePath: string
  outputDir: string
  outputPath: string
  code: string
}

/** generateApp generates the runtime app module from a Tao app file. */
async function generateApp(appPath: string, opts: GenerateAppOptions = {}): Promise<GeneratedApp> {
  const runtimePackageRoot = opts.runtimePackageRoot ?? await defaultRuntimePackageRoot(opts.repoRoot)
  const sourcePath = FS.resolvePath(opts.sourceBaseDir ?? Platform.runtimeProcess.cwd(), appPath)
  const generatedAppDir = FS.resolvePath(runtimePackageRoot, '_gen_tao-app')
  const generatedAppPath = FS.resolvePath(generatedAppDir, 'App.tsx')
  const compiled = await Compiler.compileFile(sourcePath)

  await writeGeneratedApp(generatedAppPath, compiled.code)

  return {
    sourcePath,
    outputDir: generatedAppDir,
    outputPath: generatedAppPath,
    code: compiled.code,
  }
}

/** Runtime exposes Expo runtime app generation functions. */
const Runtime = {
  generateApp,
}

export default Runtime

async function defaultRuntimePackageRoot(repoRootOverride?: string): Promise<string> {
  const repoRoot = repoRootOverride ?? await Repo.getRoot()
  return FS.resolvePath(repoRoot, 'packages/runtime')
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
