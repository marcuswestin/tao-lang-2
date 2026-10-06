import { Errors, ReleaseCapabilities } from '@shared'
import CommandRunner from '../CommandRunner'
import { DEV_LOOP_CONTROLS, DevLoopOutput } from '../DevLoopOutput'
import type { ExpoRunnerSession } from '../expo-runner/ExpoRunner'
import Run from '../Run'
import Commands, { type CommandKey } from './Commands'
type ActionCommandKey = Exclude<CommandKey, '\u0003'>
type CommandHandler = (context: CommandKeyContext) => Promise<boolean | void> | void

/** CommandKeyContext provides dependencies for a dev-loop key action. */
type CommandKeyContext = {
  appName?: string
  appPath: string
  expo: ExpoRunnerSession
  openDesktop?: () => Promise<boolean>
  finish: (exitCode: number) => Promise<void>
  repoRoot: string
  repositoryControlsAvailable?: boolean
  runtimeRoot?: string
  restart: () => Promise<void>
  selectApp: () => Promise<void>
  shouldStop?: () => boolean
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

  const capability = DEV_LOOP_CONTROLS.find(control => control.key === key)?.capability
  if (capability !== undefined && !ReleaseCapabilities.allows(capability)) {
    DevLoopOutput.logDevLoop('dev', ReleaseCapabilities.diagnostic(capability), 'warn')
    return
  }

  if (context.repositoryControlsAvailable === false && REPOSITORY_COMMAND_KEYS.includes(key)) {
    DevLoopOutput.logDevLoop('dev', `Key ${key} requires a Tao source checkout.`, 'warn')
    return
  }

  if (CommandRunner.isCommandRunning()) {
    CommandRunner.reportBusy(formatCommandKey(key))
    return
  }

  await COMMAND_HANDLERS[key](context)
}

const COMMAND_HANDLERS = {
  q: context => context.finish(0),
  r: context =>
    CommandRunner.runNonInteractiveCommand('reload app', () => context.expo.reloadExpoApps(context.shouldStop)),
  d: context => CommandRunner.runNonInteractiveCommand('open Tao desktop', context.openDesktop ?? (async () => false)),
  p: context =>
    CommandRunner.runNonInteractiveCommand(
      'open physical device',
      () => context.expo.openPhysicalDevice(undefined, context.shouldStop),
    ),
  x: context => context.restart(),
  w: context => CommandRunner.runNonInteractiveCommand('open Expo web', context.expo.openWeb),
  i: context => CommandRunner.runNonInteractiveCommand('open Expo iOS', context.expo.openIosSimulator),
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
  a: context => CommandRunner.runNonInteractiveCommand('open Expo Android', context.expo.openAndroid),
  s: context => context.selectApp(),
} satisfies Record<ActionCommandKey, CommandHandler>

const REPOSITORY_COMMAND_KEYS: readonly string[] = DEV_LOOP_CONTROLS
  .filter(control => control.checkoutOnly === true)
  .map(control => control.key)

async function cleanInstallDepsAndReload(context: CommandKeyContext): Promise<boolean | void> {
  await context.stopServices()
  try {
    await Run.runJust(['clean'])
    await Run.runJust(['deps'])
  } catch (error) {
    DevLoopOutput.logDevLoop('dev', Errors.formatForLog(error), 'error')
    await context.finish(1)
    return false
  }
  await context.restart()
}

function formatCommandKey(key: CommandKey): string {
  return key === '\u0003' ? 'Ctrl-C' : `key ${key}`
}
