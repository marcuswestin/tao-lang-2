import Runtime from '@runtime'
import { FS, Platform } from '@shared'
import { ensureAndroidEmulator, ensureAndroidExpoGo, startExpoAndroid } from './android'
import { runWithCommands } from './commands/commands'

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
      const generated = await Runtime.generateApp(FS.resolvePath(appPath))
      Platform.runtimeConsole.info(`Compiled ${generated.sourcePath} -> ${generated.outputPath}`)
    })

  commands
    .command('expo-android')
    .description('Start the Expo runtime and open it on the booted Android emulator.')
    .action(async () => {
      await startExpoAndroid()
    })
})
