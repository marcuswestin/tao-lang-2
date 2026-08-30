import { type DevAppSelection, type DevLoopOutcome, runDevLoop } from '@expo-dev-loop'
import { Errors, FS, HCI, Switch } from '@shared'
import type { Readable, Writable } from 'node:stream'
import { discoverTaoDevProjects, type TaoDevApp } from './dev-app-discovery'
import { selectTaoDevApp, type TaoDevSelectionResult } from './dev-app-selection'

/** TaoDevCommandOptions supplies explicit selection, terminal state, and a focused loop seam. */
type TaoDevCommandOptions = {
  appName?: string
  input?: Readable
  interactive?: boolean
  output?: Writable
  runLoop?: (selection: DevAppSelection) => Promise<DevLoopOutcome>
}

/** runTaoDev discovers, selects, and runs apps until the dev loop exits. */
export async function runTaoDev(
  targetPath = '.',
  options: TaoDevCommandOptions = {},
): Promise<number> {
  const target = FS.resolvePath(targetPath)
  const runLoop = options.runLoop ?? runDevLoop
  let current = await initialSelection(target, options)
  if (current.kind !== 'selected') {
    return exitTaoDev(current.kind === 'exit' ? current.exitCode : 0, options)
  }
  let currentApp = current.app

  while (true) {
    const outcome = await runLoop(currentApp)
    const exitCode = await Switch.kind<typeof outcome, Promise<number | undefined>>(outcome, {
      exit: async exit => exit.exitCode,
      restart: async () => undefined,
      'select-app': async () => {
        const selection = await interactiveSelection(target, options, currentApp)
        return Switch.kind<typeof selection, number | undefined>(selection, {
          cancel: () => undefined,
          exit: exit => exit.exitCode,
          selected: selected => {
            currentApp = selected.app
            return undefined
          },
        })
      },
    })
    if (exitCode !== undefined) {
      return exitTaoDev(exitCode, options)
    }
  }
}

/** exitTaoDev announces the exit; closing the dev-loop dashboard restores the primary screen, which
 * still shows the stale app selector, so a silent exit reads as returning to app selection. */
function exitTaoDev(exitCode: number, options: TaoDevCommandOptions): number {
  HCI.writeLine('Exited Tao dev.', options)
  return exitCode
}

async function initialSelection(
  target: string,
  options: TaoDevCommandOptions,
): Promise<TaoDevSelectionResult> {
  const projects = await discoverTaoDevProjects(target)
  const apps = projects.flatMap(project => project.apps)
  if (apps.length === 0) {
    throw new Errors.UserInputError(`No runnable Tao apps found under ${target}.`)
  }
  if (options.appName !== undefined) {
    return { kind: 'selected', app: resolveNamedApp(apps, options.appName) }
  }
  if (apps.length === 1) {
    return { kind: 'selected', app: apps[0]! }
  }
  return await selectTaoDevApp(projects, options)
}

async function interactiveSelection(
  target: string,
  options: TaoDevCommandOptions,
  current: TaoDevApp,
): Promise<TaoDevSelectionResult> {
  return await selectTaoDevApp(await discoverTaoDevProjects(target), {
    input: options.input,
    interactive: options.interactive,
    output: options.output,
    current,
  })
}

function resolveNamedApp(apps: readonly TaoDevApp[], requested: string): TaoDevApp {
  const matches = apps.filter(app => app.appName === requested)
  if (matches.length === 1) {
    return matches[0]!
  }
  if (matches.length === 0) {
    Errors.throwUserInput(
      `No runnable Tao app named '${requested}' was found. Available apps: ${apps.map(app => app.appName).join(', ')}.`,
    )
  }
  Errors.throwUserInput(
    `App name '${requested}' is ambiguous across projects: ${
      matches.map(app => `${app.projectName} (${app.appPath})`).join(', ')
    }. Narrow the dev target path.`,
  )
}
