import { Command } from '@commander-js/extra-typings'
import { Errors, HCI, Platform } from '@shared'
import { runAppAgentCommand } from './agents-command'

/** Entry point shared by generated app-specific executables. The app owns all runtime state. */
export async function runAgentClient(bundle: string, argv = Platform.runtimeProcess.argv): Promise<void> {
  const cli = new Command().name('agents').description('Discover and execute this app’s exposed commands.')
  cli.command('commands').description('Start the app if needed and list exposed commands.').action(async () => {
    const started = await runAppAgentCommand('start', bundle)
    print(started.ok ? await runAppAgentCommand('commands', bundle) : started)
  })
  cli.command('run').argument('<command>', 'Canonical command id or unique exposed command name.')
    .option('--args <json>', 'Named JSON arguments.', '{}')
    .option('--stop-after', 'Stop the app after the request settles.')
    .action(async (command, options) => {
      let args: unknown
      try {
        args = JSON.parse(options.args)
      } catch {
        print({ ok: false, error: { code: 'invalid_args', message: '--args must contain valid JSON.' } })
        return
      }
      const started = await runAppAgentCommand('start', bundle)
      if (!started.ok) {
        print(started)
        return
      }
      let result = await runAppAgentCommand('commands', bundle)
      if (result.ok) {
        const catalog = result.result as { id: string; name: string }[]
        const matches = catalog.filter(entry => entry.id === command || entry.name === command)
        result = matches.length === 1
          ? await runAppAgentCommand('run', bundle, { commandId: matches[0]!.id, args })
          : {
            ok: false,
            error: { code: 'invalid_command', message: 'Choose a canonical id or unique name from commands.' },
          }
      }
      if (options.stopAfter) {
        const stopped = await runAppAgentCommand('stop', bundle)
        if (!stopped.ok) {
          HCI.writeErrorLine(JSON.stringify(stopped))
          if (result.ok) {
            result = stopped
          }
        }
      }
      print(result)
    })
  cli.command('stop').description('Stop the background app.').action(async () =>
    print(await runAppAgentCommand('stop', bundle))
  )
  try {
    await cli.parseAsync(argv, { from: 'node' })
  } catch (error) {
    print({ ok: false, error: { code: 'client_error', message: Errors.formatForUser(error) } })
  }
}

function print(result: Awaited<ReturnType<typeof runAppAgentCommand>>): void {
  HCI.writeLine(JSON.stringify(result))
  Platform.runtimeProcess.setExitCode(result.ok ? 0 : 1)
}
