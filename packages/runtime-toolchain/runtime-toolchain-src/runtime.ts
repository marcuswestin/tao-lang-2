import { AST } from '@parser'
import { FS } from '@shared'
import { Workspace } from '@workspace'
import { RuntimeToolchainPaths } from './runtime-toolchain-paths'

export { RuntimeToolchainPaths } from './runtime-toolchain-paths'

type GenerateAppOptions = {
  appName?: string
  cwd?: string
  runtimePackageRoot?: string
}

type GeneratedApp = {
  sourcePath: string
  outputPath: string
  code: string
}

const generationQueues = new Map<string, Promise<void>>()

/** generateApp generates the runtime app module from a Tao app file. */
async function generateApp(appPath: string, opts: GenerateAppOptions = {}): Promise<GeneratedApp> {
  const runtimePackageRoot = opts.runtimePackageRoot ?? defaultRuntimePackageRoot()
  const sourcePath = FS.resolvePath(appPath, opts.cwd)
  const generatedAppPath = FS.resolvePath('_gen_tao-app/App.tsx', runtimePackageRoot)
  const generatedAppRoot = FS.resolvePath('_gen_tao-app', runtimePackageRoot)
  return await serializeGeneration(generatedAppRoot, async () => {
    const compiled = await Workspace.compile(sourcePath, { appName: opts.appName })

    await writeGeneratedFiles(generatedAppRoot, compiled.files)

    return {
      sourcePath,
      outputPath: generatedAppPath,
      code: compiled.code,
    }
  })
}

/** Runtime exposes Expo runtime app generation functions. */
const Runtime = {
  appNames,
  generateApp,
}

export default Runtime

/** appNames returns the declared app keys in an entry file without generating output. */
async function appNames(appPath: string, opts: { cwd?: string } = {}): Promise<string[]> {
  const sourcePath = FS.resolvePath(appPath, opts.cwd)
  const parsed = await Workspace.parse(sourcePath)
  return AST.appValueDeclarationsInFile(parsed.entry.ast).map(statement => statement.name)
}

function defaultRuntimePackageRoot(): string {
  return RuntimeToolchainPaths.packageRoot
}

/** serializeGeneration publishes one complete generated module graph at a time per output root. */
function serializeGeneration<ResultT>(outputRoot: string, generate: () => Promise<ResultT>): Promise<ResultT> {
  const previous = generationQueues.get(outputRoot) ?? Promise.resolve()
  const result = previous.then(generate)
  const completion = result.then(() => undefined, () => undefined)
  generationQueues.set(outputRoot, completion)
  void completion.then(() => {
    if (generationQueues.get(outputRoot) === completion) {
      generationQueues.delete(outputRoot)
    }
  })
  return result
}

async function writeGeneratedFiles(
  outputRoot: string,
  files: Array<{ relativePath: string; code: string }>,
): Promise<void> {
  await removeStaleGeneratedFiles(outputRoot, new Set(files.map(file => file.relativePath)))
  for (const file of files) {
    await writeGeneratedApp(FS.resolvePath(file.relativePath, outputRoot), file.code)
  }
  await removeEmptyGeneratedDirectories(outputRoot)
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

async function removeEmptyGeneratedDirectories(outputRoot: string): Promise<void> {
  if (!await FS.exists(outputRoot)) {
    return
  }
  const directories: string[] = []
  for await (const path of FS.walk(outputRoot, { includeDirectories: true })) {
    if (await FS.isDirectory(path)) {
      directories.push(path)
    }
  }
  for (const path of directories.sort((left, right) => right.length - left.length)) {
    if (await FS.isEmptyDirectory(path)) {
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
