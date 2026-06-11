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
  const runtimePackageRoot = opts.runtimePackageRoot ?? defaultRuntimePackageRoot()
  const sourcePath = FS.resolvePath(appPath)
  const generatedAppPath = FS.resolvePath('_gen_tao-app/App.tsx', { cwd: runtimePackageRoot })
  const generatedAppRoot = FS.resolvePath('_gen_tao-app', { cwd: runtimePackageRoot })
  const compiled = await Compiler.compileFile(sourcePath)

  await writeGeneratedFiles(generatedAppRoot, compiled.files)

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

function defaultRuntimePackageRoot(): string {
  return FS.repoPath('packages/runtime')
}

async function writeGeneratedFiles(
  outputRoot: string,
  files: Array<{ relativePath: string; code: string }>,
): Promise<void> {
  await removeStaleGeneratedFiles(outputRoot, new Set(files.map(file => file.relativePath)))
  for (const file of files) {
    await writeGeneratedApp(FS.resolvePath(file.relativePath, { cwd: outputRoot }), file.code)
  }
}

async function removeStaleGeneratedFiles(outputRoot: string, currentRelativePaths: ReadonlySet<string>): Promise<void> {
  if (!await FS.exists(outputRoot)) {
    return
  }
  for await (const path of FS.walk(outputRoot)) {
    const relativePath = FS.relativePath(outputRoot, path)
    if (!currentRelativePaths.has(relativePath)) {
      await FS.remove(path)
    }
  }
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
