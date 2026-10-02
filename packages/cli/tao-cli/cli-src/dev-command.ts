import { lineDevLoopReporter } from '@expo-host/dev-loop/DevLoopOutput'
import { type DevAppSelection, type DevLoopOutcome, runDevLoop } from '@expo-host/dev-loop/expo-dev-loop'
import type { DevStartupTarget } from '@expo-host/dev-loop/expo-runner/run-targets'
import { Errors, FS, HCI, ProjectDevSession, Switch } from '@shared'
import { Platform } from '@shared'
import { connectDevLoopWorker, type DevLoopControlHooks } from '@shared/DevLoopControl'
import type { Readable, Writable } from 'node:stream'
import { TaoAppModules } from './app-modules'
import { discoverTaoDevProjects, type TaoDevApp } from './dev-app-discovery'
import { selectTaoDevApp, type TaoDevSelectionResult } from './dev-app-selection'
import { createInkDevLoopReporter } from './dev/dev-loop-tui'

/** TaoDevCommandOptions supplies explicit selection, terminal state, and a focused loop seam. */
type TaoDevCommandOptions = {
  appName?: string
  device?: string
  input?: Readable
  interactive?: boolean
  output?: Writable
  runLoop?: (selection: DevAppSelection, device?: string) => Promise<DevLoopOutcome>
  startupTargets?: readonly DevStartupTarget[]
  control?: DevLoopControlHooks
}

/** runTaoDev discovers, selects, and runs apps until the dev loop exits. */
export async function runTaoDev(
  targetPath = '.',
  options: TaoDevCommandOptions = {},
): Promise<number> {
  const target = FS.resolvePath(targetPath)
  const selectionOnly = Platform.runtimeProcess.env['TAO_DEV_LOOP_SELECTION_ONLY'] === '1'
  // Private worker state is consumed once, so downstream subprocesses cannot join its control plane.
  const credentials = Platform.runtimeProcess.env['TAO_DEV_LOOP_WORKER_CREDENTIALS']
  delete Platform.runtimeProcess.env['TAO_DEV_LOOP_WORKER_CREDENTIALS']
  delete Platform.runtimeProcess.env['TAO_DEV_LOOP_SELECTION_ONLY']
  let managed: Awaited<ReturnType<typeof connectDevLoopWorker>> | undefined
  let control = options.control
  const managedRequest = credentials !== undefined && credentials !== ''
  // `runDevLoop` renders through whichever reporter it is given; the dashboard is `tao dev`'s to
  // own, so this is the one place that wires the Ink implementation in.
  const runLoop = options.runLoop
    ?? ((selection, device) =>
      runDevLoop(
        selection,
        control === undefined ? createInkDevLoopReporter() : lineDevLoopReporter(),
        options.startupTargets,
        device,
        control,
      ))
  let current = await initialSelection(target, {
    ...options,
    ...(selectionOnly || control !== undefined || managedRequest ? { interactive: false } : {}),
  })
  if (current.kind !== 'selected') {
    return exitTaoDev(current.kind === 'exit' ? current.exitCode : 0, options)
  }
  let currentApp = current.app
  if (selectionOnly) {
    HCI.writeLine(JSON.stringify(currentApp))
    return 0
  }
  managed = managedRequest ? await connectDevLoopWorker(credentials) : undefined
  control ??= managed
  let lease: Awaited<ReturnType<typeof ProjectDevSession.acquire>> | undefined
  try {
    while (true) {
      if (control?.stopRequested?.()) {
        return exitTaoDev(0, options)
      }
      if (lease === undefined) {
        lease = await ProjectDevSession.acquire(currentApp.projectRoot, 'cli')
        await TaoAppModules.ensureProject(currentApp.projectRoot)
      }
      const previousProject = currentApp.projectRoot
      const outcome = await runLoop(currentApp, options.device)
      if (control?.stopRequested?.()) {
        return exitTaoDev(0, options)
      }
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
      if (currentApp.projectRoot !== previousProject) {
        await lease.release()
        lease = undefined
      }
    }
  } finally {
    await lease?.release()
    await managed?.close()
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
    Errors.throwUserInput(`No runnable Tao apps found under ${target}.`)
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
