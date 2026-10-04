import { runWithCommands } from '@cli-kit/RunWithCommands'
import { NOTIFICATION_SOUNDS, notifyDeveloper } from '../attention/NotifyDeveloper'

await runWithCommands(command => {
  command
    .name('notify-developer')
    .description(
      'Post a macOS notification, sound every four seconds with volume rising over two minutes, and flash after 30 seconds.',
    )
    .option(
      '--sound <name>',
      `Choose a macOS notification sound: ${NOTIFICATION_SOUNDS.join(', ')}`,
      NOTIFICATION_SOUNDS[0],
    )
    .option('--flash-screen', 'Start flashing immediately instead of waiting 30 seconds')
    .option('--message <text>', 'Explain what needs attention in the notification (one line, up to 2000 characters)')
    .option(
      '--context <text>',
      'Identify the task in the notification (one line, up to 256 characters; defaults to checkout)',
    )
    .option('--stop', 'Stop the machine-wide attention loop from any worktree (also: just stop)')
    .action(async options => {
      await notifyDeveloper(options)
    })
})
