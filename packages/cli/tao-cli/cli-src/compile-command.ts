import Runtime from '@expo-host'
import { Errors, FS, HCI } from '@shared'
import type { Readable, Writable } from 'node:stream'
import { TaoAppModules } from './app-modules'

/** CompileCommandResult declares the compiled app's source and generated output paths. */
type CompileCommandResult = {
  sourcePath: string
  outputPath: string
}

type CompileCommandOptions = {
  appName?: string
  interactive?: boolean
  input?: Readable
  output?: Writable
  runtimePackageRoot?: string
}

/** runCompile compiles the Tao app at `appPath` into the local runtime package. */
export async function runCompile(
  appPath: string,
  options: CompileCommandOptions = {},
): Promise<CompileCommandResult> {
  const sourcePath = FS.resolvePath(appPath)
  if (!await FS.isFile(sourcePath)) {
    Errors.throwUserInput(`No Tao app file found at ${sourcePath}`)
  }
  await TaoAppModules.ensureForPath(sourcePath)
  const appNames = await Runtime.appNames(sourcePath)
  const appName = await selectAppName(sourcePath, appNames, options)
  const generated = await Runtime.generateApp(sourcePath, {
    appName,
    runtimePackageRoot: options.runtimePackageRoot,
  })
  return { sourcePath: generated.sourcePath, outputPath: generated.outputPath }
}

async function selectAppName(
  sourcePath: string,
  appNames: readonly string[],
  options: CompileCommandOptions,
): Promise<string | undefined> {
  if (options.appName || appNames.length <= 1) {
    return options.appName ?? appNames[0]
  }
  if (
    !HCI.isInteractive({
      input: options.input,
      output: options.output,
      interactive: options.interactive,
    })
  ) {
    Errors.throwUserInput(
      `Multiple apps are declared in ${sourcePath}: ${appNames.join(', ')}. Select one with --app ${appNames[0]}.`,
    )
  }
  return await HCI.askChoice({
    interactive: options.interactive,
    input: options.input,
    output: options.output,
    message: 'Choose the Tao app to compile',
    choices: appNames.map(value => ({ value })),
  })
}
