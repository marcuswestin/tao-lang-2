import Runtime from '@runtime'
import { FS } from '@shared'

/** CompileResult declares the compiled app's source and generated output paths. */
export type CompileResult = {
  sourcePath: string
  outputPath: string
}

/** runCompile compiles the Tao app at `appPath` into the local runtime package. */
export async function runCompile(appPath: string): Promise<CompileResult> {
  const generated = await Runtime.generateApp(FS.resolvePath(appPath))
  return { sourcePath: generated.sourcePath, outputPath: generated.outputPath }
}
