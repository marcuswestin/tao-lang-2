import { Platform } from '@shared'
import { ensureAndroidEmulator, ensureAndroidExpoGo, startExpoAndroid } from './android'
import { runWithCommands } from './commands/commands'

const invocationCwd = Platform.runtimeProcess.cwd()

await runWithCommands(commands => {
  commands.name('dev')

  commands
    .command('android-emulator')
    .description('Ensure an Android emulator exists and is booted.')
    .action(async () => {
      await ensureAndroidEmulator()
    })

  commands
    .command('android-expo-go')
    .description('Ensure Expo Go is installed on the booted Android emulator.')
    .action(async () => {
      await ensureAndroidExpoGo()
    })

  commands
    .command('compile-app <appPath>')
    .description('Compile a Tao app into the local runtime package.')
    .action(async (appPath: string) => {
      const { default: Runtime } = await import('@runtime')
      const generated = await Runtime.generateApp(appPath, { sourceBaseDir: invocationCwd })
      Platform.runtimeConsole.info(`Compiled ${generated.sourcePath} -> ${generated.outputPath}`)
    })

  commands
    .command('expo-android')
    .description('Start the Expo runtime and open it on the booted Android emulator.')
    .action(async () => {
      await startExpoAndroid()
    })
})
