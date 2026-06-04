import { Platform } from '@shared'
import { runWithCommands } from './commands/commands'

const invocationCwd = Platform.runtimeProcess.cwd()

await runWithCommands(commands => {
  commands.name('dev')

  commands
    .command('compile-app <appPath>')
    .description('Compile a Tao app into the local runtime package.')
    .action(async (appPath: string) => {
      const { default: Runtime } = await import('@runtime')
      const generated = await Runtime.generateApp(appPath, { sourceBaseDir: invocationCwd })
      Platform.runtimeConsole.info(`Compiled ${generated.sourcePath} -> ${generated.outputPath}`)
    })
})
