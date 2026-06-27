import { Errors, FS, HCI, Platform, Repo, Switch } from '@shared'
import { discoverSwitchableAppPaths } from '../AppDiscovery'
import CommandRunner from '../CommandRunner'
import { ExpoRunner } from '../expo-runner/ExpoRunner'
import Run from '../Run'
import { TUI } from '../TUI'
import { AppSwitchChoices } from './AppSwitchChoices'
import Commands, { type CommandKey } from './Commands'
import type { RawKeyInput } from './RawKeyInput'

const DEV_RELOAD_EXIT_CODE = 42
const MAX_SINGLE_KEY_APP_CHOICES = 9
const NEXT_APP_PATH = '.artifacts/dev/next-app-path'

type AppChoice = HCI.Choice<string> & { label: string }
type AppPathChoice =
  | { readonly kind: 'cancel' }
  | { readonly kind: 'exit'; readonly exitCode: number }
  | { readonly kind: 'selected'; readonly appPath: string }
type ActionCommandKey = Exclude<CommandKey, '\u0003'>
type CommandHandler = (context: CommandKeyContext) => Promise<boolean | void> | void

/** CommandKeyContext provides dependencies for a dev-loop key action. */
export type CommandKeyContext = {
  appPath: string
  finish: (exitCode: number) => Promise<void>
  keyInput: RawKeyInput
  repoRoot: string
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
      () => Run.recompileAndReload(context.repoRoot, context.appPath),
    ),
  d: context => context.finish(DEV_RELOAD_EXIT_CODE),
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
  s: context => CommandRunner.runNonInteractiveCommand('switch app', () => switchAppAndReload(context)),
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
  await context.finish(DEV_RELOAD_EXIT_CODE)
}

async function switchAppAndReload(context: CommandKeyContext): Promise<void> {
  context.keyInput.stop()
  let shouldRestartInput = true
  try {
    const choice = await askForAppPath(context.appPath)
    await Switch.kind<AppPathChoice, Promise<void>>(choice, {
      cancel: async () => {
        TUI.logDevLoop('dev', 'App switch cancelled.')
      },
      exit: async exitChoice => {
        shouldRestartInput = false
        await context.finish(exitChoice.exitCode)
      },
      selected: async selectedChoice => {
        if (selectedChoice.appPath === context.appPath) {
          TUI.logDevLoop('dev', 'App unchanged.')
          return
        }
        shouldRestartInput = false
        await FS.writeText(Repo.resolvePath(NEXT_APP_PATH), selectedChoice.appPath)
        TUI.logDevLoop('dev', `switching app to ${selectedChoice.appPath}`)
        await context.stopServices()
        await context.finish(DEV_RELOAD_EXIT_CODE)
      },
    })
  } finally {
    if (shouldRestartInput) {
      context.keyInput.start()
    }
  }
}

async function askForAppPath(currentAppPath: string): Promise<AppPathChoice> {
  const choices = (await appChoices()).slice(0, MAX_SINGLE_KEY_APP_CHOICES)
  TUI.printDevLoopAppChoices(choices, currentAppPath)
  while (true) {
    const key = await readSingleAppChoiceKey()
    TUI.logDevLoop('dev', key)
    const action = AppSwitchChoices.actionForKey(choices, key)
    const choice = Switch.kind<typeof action, AppPathChoice | undefined>(action, {
      cancel: cancel => cancel,
      choose: choose => ({ kind: 'selected', appPath: choose.appPath }),
      exit: exit => exit,
      invalid: () => undefined,
    })
    if (choice !== undefined) {
      return choice
    }
    TUI.logDevLoop('dev', `Choose an app with 1-${choices.length}.`)
  }
}

async function appChoices(): Promise<AppChoice[]> {
  const appsRoot = Repo.resolvePath('Apps')
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

async function readSingleAppChoiceKey(): Promise<string> {
  const rawMode = Platform.setStdinRawMode(true)
  Platform.runtimeProcess.stdin.resume()
  try {
    return await new Promise<string>(resolve => {
      const onData = (chunk: Buffer) => {
        Platform.runtimeProcess.stdin.off('data', onData)
        const input = chunk.toString('utf8')
        resolve(input.startsWith('\u001b') ? input : input[0] ?? '')
      }
      Platform.runtimeProcess.stdin.on('data', onData)
    })
  } finally {
    if (rawMode) {
      Platform.setStdinRawMode(false)
    }
  }
}

function formatCommandKey(key: CommandKey): string {
  return key === '\u0003' ? 'Ctrl-C' : `key ${key}`
}
