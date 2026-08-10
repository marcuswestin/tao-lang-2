import { Command } from '@commander-js/extra-typings'
import { Platform } from '@shared'

/** runWithCommands runs a Commander program configured by `fn`. */
export async function runWithCommands(fn: (commands: Command) => void): Promise<void> {
  const commands = new Command()
  fn(commands)
  await commands.parseAsync(Platform.runtimeProcess.argv, { from: 'node' })
}
