import Runtime from '@runtime'
import { Errors, FS, HCI, Platform } from '@shared'
import { ensureAndroidEmulator, ensureAndroidExpoGo, startExpoAndroid } from './android'
import { runWithCommands } from './commands/commands'
import { runDevLoop } from './dev-loop/dev-loop'

await runWithCommands(commands => {
  commands
    .name('dev')
    .argument('[appPath]', 'Tao app path to run in the dev loop.')
    .action(async (appPath?: string) => {
      try {
        const devLoop = await runDevLoop(appPath)
        Platform.runtimeProcess.exit(devLoop)
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.exit(1)
      }
    })

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
      HCI.writeLine(`Compiled ${generated.sourcePath} -> ${generated.outputPath}`)
    })

  commands
    .command('expo-android')
    .description('Start the Expo runtime and open it on the booted Android emulator.')
    .action(async () => {
      await startExpoAndroid()
    })
})
