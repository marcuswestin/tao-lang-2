import { runWithCommands } from '@cli-kit/RunWithCommands'
import { NOTIFICATION_SOUNDS, notifyDeveloper } from '../attention/NotifyDeveloper'

await runWithCommands(command => {
  command
    .name('notify-developer')
    .description(
      'Sound every four seconds, ramping volume from 20% to 100% over two minutes while waiting for developer attention.',
    )
    .option('--shutdown-id <id>', 'Identify this alert so it can be stopped independently', 'default')
    .option(
      '--sound <name>',
      `Choose a macOS notification sound: ${NOTIFICATION_SOUNDS.join(', ')}`,
      NOTIFICATION_SOUNDS[0],
    )
    .option('--flash-screen', 'Start flashing immediately instead of waiting 30 seconds')
    .option('--stop', 'Acknowledge and stop this alert')
    .action(async options => {
      await notifyDeveloper(options)
    })
})
