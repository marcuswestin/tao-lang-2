import Runtime from '@runtime'
import { Errors, FS } from '@shared'

/** CompileResult declares the compiled app's source and generated output paths. */
export type CompileResult = {
  sourcePath: string
  outputPath: string
}

/** runCompile compiles the Tao app at `appPath` into the local runtime package. */
export async function runCompile(appPath: string): Promise<CompileResult> {
  const sourcePath = FS.resolvePath(appPath)
  if (!await FS.isFile(sourcePath)) {
    Errors.throwUserInput(`No Tao app file found at ${sourcePath}`)
  }
  const generated = await Runtime.generateApp(sourcePath)
  return { sourcePath: generated.sourcePath, outputPath: generated.outputPath }
}
