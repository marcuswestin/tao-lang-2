import { Errors, HCI, Platform } from '@shared'
import { Android } from './android'
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
      await Android.ensureEmulator()
    })

  commands
    .command('android-expo-go')
    .description('Ensure Expo Go is installed on the booted Android emulator.')
    .action(async () => {
      await Android.ensureExpoGo()
    })

  commands
    .command('expo-android')
    .description('Start the Expo runtime and open it on the booted Android emulator.')
    .action(async () => {
      await Android.startExpo()
    })
})
