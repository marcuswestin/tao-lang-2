import { runWithCommands } from '@cli-kit/RunWithCommands'
import { notifyDeveloper } from '../attention/NotifyDeveloper'

await runWithCommands(command => {
  command
    .name('notify-developer')
    .description('Sound every four seconds while waiting for developer attention.')
    .option('--shutdown-id <id>', 'Identify this alert so it can be stopped independently', 'default')
    .option('--sound <name>', 'Choose a macOS notification sound', 'Glass')
    .option('--flash-screen', 'Start flashing immediately instead of waiting 30 seconds')
    .option('--stop', 'Acknowledge and stop this alert')
    .action(async options => {
      await notifyDeveloper(options)
    })
})
