import { Compiler } from '@tao/compiler'
import { FS } from '@tao/shared'

const rootPackageName = 'tao-lang'

/** Runtime exposes helpers for the Expo web host package. */
export namespace Runtime {
  /** CompileAppOptions declares path overrides for tests and tooling. */
  export type CompileAppOptions = {
    repoRoot?: string
    runtimePackageRoot?: string
    sourceBaseDir?: string
  }

  /** CompiledApp declares the source app path and generated TSX runtime output. */
  export type CompiledApp = {
    sourcePath: string
    outputDir: string
    outputPath: string
    code: string
  }

  /** compileApp compiles a Tao app file into the runtime generated app module. */
  export async function compileApp(appPath: string, opts: CompileAppOptions = {}): Promise<CompiledApp> {
    const repoRoot = opts.repoRoot ?? await findRepoRoot()
    const runtimePackageRoot = opts.runtimePackageRoot ?? FS.resolvePath(repoRoot, 'packages/runtime')
    const sourcePath = FS.resolvePath(opts.sourceBaseDir ?? process.cwd(), appPath)
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
}

async function writeGeneratedApp(path: string, code: string): Promise<void> {
  if (await FS.exists(path) && await FS.readText(path) === code) {
    return
  }
  await FS.writeText(path, code)
}

async function findRepoRoot(): Promise<string> {
  let dir = FS.resolvePath(process.cwd())

  while (true) {
    const packageJsonPath = FS.resolvePath(dir, 'package.json')
    if (await FS.isFile(packageJsonPath)) {
      const packageJson = await FS.readJson<{ name?: string }>(packageJsonPath)
      if (packageJson.name === rootPackageName) {
        return dir
      }
    }

    const parent = FS.dirname(dir)
    if (parent === dir) {
      throw new Error(`Could not find ${rootPackageName} repo root from ${process.cwd()}.`)
    }
    dir = parent
  }
}
