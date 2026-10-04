import { runWithCommands } from '@cli-kit/RunWithCommands'
import { notifyDeveloper } from '../attention/NotifyDeveloper'

await runWithCommands(command => {
  command
    .name('notify-developer')
    .description('Sound every five seconds while waiting for developer attention.')
    .option('--id <id>', 'Scope this alert to a question or session', 'default')
    .option('--stop', 'Acknowledge and stop this alert')
    .action(async options => {
      await notifyDeveloper(options)
    })
})
