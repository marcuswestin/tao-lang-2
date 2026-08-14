import { Errors } from '@shared'
import CommandRunner from '../CommandRunner'
import { ExpoRunner } from '../expo-runner/ExpoRunner'
import Run from '../Run'
import { TUI } from '../TUI'
import Commands, { type CommandKey } from './Commands'
type ActionCommandKey = Exclude<CommandKey, '\u0003'>
type CommandHandler = (context: CommandKeyContext) => Promise<boolean | void> | void

/** CommandKeyContext provides dependencies for a dev-loop key action. */
type CommandKeyContext = {
  appName?: string
  appPath: string
  finish: (exitCode: number) => Promise<void>
  repoRoot: string
  restart: () => Promise<void>
  selectApp: () => Promise<void>
  stopServices: () => Promise<void>
}

/** handleCommandKey dispatches one raw keypress to its dev-loop command. */
export async function handleCommandKey(key: string, context: CommandKeyContext): Promise<void> {
  if (!Commands.isCommandKey(key)) {
    return
  }

  if (key === '\u0003') {
    await context.finish(130)
    return
  }

  if (CommandRunner.isCommandRunning()) {
    TUI.logDevLoop('dev', `Command already running; ignored ${formatCommandKey(key)}.`)
    return
  }

  await COMMAND_HANDLERS[key](context)
}

const COMMAND_HANDLERS = {
  q: context => context.finish(0),
  r: context =>
    CommandRunner.runNonInteractiveCommand(
      'recompile and reload Expo app',
      () => Run.recompileAndReload(context.repoRoot, context.appPath, context.appName),
    ),
  d: context => context.restart(),
  w: () => CommandRunner.runNonInteractiveCommand('open Expo web', ExpoRunner.openWeb),
  i: () => CommandRunner.runNonInteractiveCommand('open Expo iOS', ExpoRunner.openIosSimulator),
  c: context =>
    CommandRunner.runNonInteractiveCommand(
      'clean, install deps, and reload',
      () => cleanInstallDepsAndReload(context),
    ),
  f: () => CommandRunner.runNonInteractiveCommand('fix', () => Run.runJust(['fix'])),
  t: context => CommandRunner.runNonInteractiveCommand('test', () => Run.runTests(context.repoRoot)),
  v: () =>
    CommandRunner.runNonInteractiveCommand(
      'verify',
      () => Run.runJust(['verify']),
    ),
  e: () =>
    CommandRunner.runNonInteractiveCommand(
      'install IDE extension',
      () => Run.runJust(['install-ide-extension']),
    ),
  a: () => CommandRunner.runNonInteractiveCommand('open Expo Android', ExpoRunner.openAndroid),
  s: context => context.selectApp(),
} satisfies Record<ActionCommandKey, CommandHandler>

async function cleanInstallDepsAndReload(context: CommandKeyContext): Promise<boolean | void> {
  await context.stopServices()
  try {
    await Run.runJust(['clean'])
    await Run.runJust(['deps'])
  } catch (error) {
    TUI.logDevLoop('dev', Errors.formatForLog(error), 'error')
    await context.finish(1)
    return false
  }
  await context.restart()
}

function formatCommandKey(key: CommandKey): string {
  return key === '\u0003' ? 'Ctrl-C' : `key ${key}`
}
