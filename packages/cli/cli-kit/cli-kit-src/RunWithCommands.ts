import { Command } from '@commander-js/extra-typings'
import { Platform, Repo, ResourceInventory } from '@shared'
import { registerResourceCommands } from './ResourceCommands'

/** runWithCommands runs a Commander program configured by `fn`. */
export async function runWithCommands(fn: (commands: Command) => void): Promise<void> {
  const commands = new Command()
  fn(commands)
  registerResourceCommands(commands)
  await ResourceInventory.notifyStartup({ checkout: Repo.tryGetRoot() ?? Platform.runtimeProcess.cwd() })
  await commands.parseAsync(Platform.runtimeProcess.argv, { from: 'node' })
}
