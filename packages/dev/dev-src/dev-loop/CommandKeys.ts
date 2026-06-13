import { Errors, FS, HCI, Switch } from '@shared'
import { discoverSwitchableAppPaths } from './AppDiscovery'
import CommandRunner from './CommandRunner'
import Commands, { type CommandKey } from './Commands'
import { Expo } from './Expo'
import type { RawKeyInput } from './RawKeyInput'
import Run from './Run'

const DEV_RELOAD_EXIT_CODE = 42
const NEXT_APP_PATH = '.artifacts/dev/next-app-path'

type AppChoice = HCI.Choice<string> & { label: string }

/** CommandKeyContext provides dependencies for a dev-loop key action. */
export type CommandKeyContext = {
  appPath: string
  finish: (exitCode: number) => Promise<void>
  keyInput: RawKeyInput
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
    HCI.logProcessInfo('dev', `Command already running; ignored ${formatCommandKey(key)}.`)
    return
  }

  await Switch.value(key, {
    q: () => context.finish(0),
    r: () => CommandRunner.runNonInteractiveCommand('reload Expo app', Expo.reloadExpoApps),
    d: () => context.finish(DEV_RELOAD_EXIT_CODE),
    w: () => CommandRunner.runNonInteractiveCommand('open Expo web', Expo.openWeb),
    i: () => CommandRunner.runNonInteractiveCommand('open Expo iOS', Expo.openIosSimulator),
    c: () =>
      CommandRunner.runNonInteractiveCommand(
        'clean, install deps, and reload',
        () => cleanInstallDepsAndReload(context),
      ),
    f: () => CommandRunner.runNonInteractiveCommand('fix', () => Run.runJust(['fix'])),
    t: () => CommandRunner.runNonInteractiveCommand('test', () => Run.runJust(['test'])),
    p: () =>
      CommandRunner.runNonInteractiveCommand(
        'prep',
        () => Run.runJust(['prep']),
      ),
    e: () =>
      CommandRunner.runNonInteractiveCommand(
        'install IDE extension',
        () => Run.runJust(['install-ide-extension']),
      ),
    a: () => CommandRunner.runNonInteractiveCommand('open Expo Android', Expo.openAndroid),
    s: () => CommandRunner.runNonInteractiveCommand('switch app', () => switchAppAndReload(context)),
  })
}

async function cleanInstallDepsAndReload(context: CommandKeyContext): Promise<boolean | void> {
  await context.stopServices()
  try {
    await Run.runJust(['clean'])
    await Run.runJust(['deps'])
  } catch (error) {
    HCI.writeErrorLine(Errors.formatForLog(error))
    await context.finish(1)
    return false
  }
  await context.finish(DEV_RELOAD_EXIT_CODE)
}

async function switchAppAndReload(context: CommandKeyContext): Promise<void> {
  context.keyInput.stop()
  let shouldRestartInput = true
  try {
    const appPath = await askForAppPath(context.appPath)
    if (appPath === context.appPath) {
      HCI.logProcessInfo('dev', 'App unchanged.')
      return
    }

    shouldRestartInput = false
    await FS.writeText(FS.repoPath(NEXT_APP_PATH), appPath)
    HCI.logProcessInfo('dev', `switching app to ${appPath}`)
    await context.stopServices()
    await context.finish(DEV_RELOAD_EXIT_CODE)
  } finally {
    if (shouldRestartInput) {
      context.keyInput.start()
    }
  }
}

async function askForAppPath(currentAppPath: string): Promise<string> {
  const choices = await appChoices()
  const defaultValue = choices.find(choice => choice.value === currentAppPath)?.value
  return HCI.askChoice({
    choices,
    defaultValue,
    message: 'Switch app',
  })
}

async function appChoices(): Promise<HCI.Choice<string>[]> {
  const appsRoot = FS.repoPath('Apps')
  const appPaths = await discoverSwitchableAppPaths(appsRoot)
  const choices: AppChoice[] = appPaths.map(appPath => ({
    label: formatAppChoiceLabel(appsRoot, appPath),
    value: appPath,
  }))

  if (choices.length === 0) {
    throw new Errors.UserInputError('No switchable apps found in Apps/.')
  }
  return choices.sort((left, right) => left.label.localeCompare(right.label))
}

function formatAppChoiceLabel(appsRoot: string, appPath: string): string {
  return FS.slashPath(appPath.slice(appsRoot.length + 1)).replace(/\.tao$/, '')
}

function formatCommandKey(key: CommandKey): string {
  return key === '\u0003' ? 'Ctrl-C' : `key ${key}`
}
