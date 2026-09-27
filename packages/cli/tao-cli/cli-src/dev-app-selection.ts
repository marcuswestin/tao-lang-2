import { Errors, FS, HCI } from '@shared'
import type { Readable, Writable } from 'node:stream'
import { discoverTaoDevProjects, type TaoDevApp, type TaoDevProject } from './dev-app-discovery'

const NUMBERED_APP_CHOICES = 9
const QUIT_KEY = 'Q'
const LETTERED_APP_CHOICES = 25
const MAX_APP_CHOICES = NUMBERED_APP_CHOICES + LETTERED_APP_CHOICES

/** TaoDevSelectionOptions supplies terminal state and the current app for selection. */
type TaoDevSelectionOptions = {
  current?: TaoDevApp
  input?: Readable
  interactive?: boolean
  output?: Writable
}

/** TaoDevSelectionResult distinguishes a selected app, cancellation, and Ctrl-C. */
export type TaoDevSelectionResult =
  | { kind: 'cancel' }
  | { kind: 'exit'; exitCode: number }
  | { kind: 'selected'; app: TaoDevApp }

/** selectTaoDevApp presents grouped projects and resolves on one valid keypress. */
export async function selectTaoDevApp(
  projects: readonly TaoDevProject[],
  options: TaoDevSelectionOptions = {},
): Promise<TaoDevSelectionResult> {
  const apps = projects.flatMap(project => project.apps)
  if (apps.length === 0) {
    Errors.throwUserInput('No runnable Tao apps found under the target path.')
  }
  if (apps.length > MAX_APP_CHOICES) {
    Errors.throwUserInput(
      `Found ${apps.length} runnable Tao apps, but the single-key selector supports ${MAX_APP_CHOICES}. Narrow the dev target path.`,
    )
  }
  if (!HCI.isInteractive(options)) {
    Errors.throwUserInput(
      `Multiple runnable Tao apps were found: ${apps.map(app => app.appName).join(', ')}. Select one with --app.`,
    )
  }

  return await HCI.withRawKeys(async readKey => {
    printChoices(projects, options)
    while (true) {
      const key = await readKey()
      if (key === HCI.RawKey.interrupt) {
        return { kind: 'exit', exitCode: 130 }
      }

      const choiceIndex = choiceIndexForKey(key)
      const app = choiceIndex === undefined ? undefined : apps[choiceIndex]
      if (app !== undefined) {
        return { kind: 'selected', app }
      }
      if (key === HCI.RawKey.escape) {
        return { kind: 'cancel' }
      }
      if (key.toLowerCase() === 'q') {
        return { kind: 'exit', exitCode: 0 }
      }
      HCI.writeLine(`Choose an app with ${choiceKeySummary(apps.length)}, or Q to quit.`, options)
      printChoicePrompt(options)
    }
  }, options)
}

/**
 * chooseTaoApp resolves the one app a single-shot command acts on: the `--app` name, the only app
 * under the path, or a choice made at the terminal. `activity` names the command in a cancellation.
 */
export async function chooseTaoApp(path: string, appName: string | undefined, activity: string): Promise<TaoDevApp> {
  const projects = await discoverTaoDevProjects(path)
  const apps = projects.flatMap(project => project.apps)
  if (apps.length === 0) {
    Errors.throwUserInput(`No runnable Tao apps found under ${FS.displayPath(FS.resolvePath(path))}.`)
  }
  if (appName !== undefined) {
    const matches = apps.filter(app => app.appName === appName)
    if (matches.length !== 1) {
      Errors.throwUserInput(`--app '${appName}' must identify exactly one runnable app (${matches.length} found).`)
    }
    return matches[0]!
  }
  if (apps.length === 1) {
    return apps[0]!
  }
  if (!HCI.isInteractive()) {
    Errors.throwUserInput('Multiple Tao apps found; choose one with --app in a non-interactive terminal.')
  }
  const selected = await selectTaoDevApp(projects)
  if (selected.kind !== 'selected') {
    Errors.throwUserInput(`${activity} app selection was cancelled.`)
  }
  return selected.app
}

/** keyForChoiceIndex labels choices 1-9 followed by A-Z, reserving Q for quit. */
export function keyForChoiceIndex(index: number): string | undefined {
  if (index >= 0 && index < NUMBERED_APP_CHOICES) {
    return String(index + 1)
  }
  if (index >= NUMBERED_APP_CHOICES && index < MAX_APP_CHOICES) {
    const letterOffset = index - NUMBERED_APP_CHOICES
    const reservedOffset = QUIT_KEY.charCodeAt(0) - 'A'.charCodeAt(0)
    return String.fromCharCode('A'.charCodeAt(0) + letterOffset + (letterOffset >= reservedOffset ? 1 : 0))
  }
  return undefined
}

/** choiceIndexForKey accepts displayed keys in either case and reserves Q for quit. */
export function choiceIndexForKey(key: string): number | undefined {
  if (/^[1-9]$/.test(key)) {
    return Number(key) - 1
  }
  const normalized = key.toUpperCase()
  if (/^[A-Z]$/.test(normalized) && normalized !== QUIT_KEY) {
    const letterOffset = normalized.charCodeAt(0) - 'A'.charCodeAt(0)
    const reservedOffset = QUIT_KEY.charCodeAt(0) - 'A'.charCodeAt(0)
    return NUMBERED_APP_CHOICES + letterOffset - (letterOffset > reservedOffset ? 1 : 0)
  }
  return undefined
}

/** choiceKeySummary describes the addressable keys for one selector. */
export function choiceKeySummary(choiceCount: number): string {
  const lastKey = keyForChoiceIndex(choiceCount - 1)
  if (lastKey === undefined) {
    return 'no choices'
  }
  return choiceCount <= NUMBERED_APP_CHOICES ? `1-${lastKey}` : `1-9 or A-${lastKey}`
}

function printChoices(
  projects: readonly TaoDevProject[],
  options: Pick<TaoDevSelectionOptions, 'current' | 'output'>,
): void {
  HCI.writeLine(HCI.bold(HCI.white('Choose the Tao app to run')), options)
  let choiceIndex = 0
  for (const [projectIndex, project] of projects.entries()) {
    if (projectIndex > 0) {
      HCI.writeLine('', options)
    }
    HCI.writeLine(`${HCI.bold(project.name)}:`, options)
    for (const app of project.apps) {
      const key = keyForChoiceIndex(choiceIndex)
      const current = options.current?.appPath === app.appPath && options.current.appName === app.appName
        ? ` ${HCI.dim('(current)')}`
        : ''
      HCI.writeLine(`${HCI.bold(HCI.white(String(key)))}) ${app.appName}${current}`, options)
      choiceIndex += 1
    }
  }
  HCI.writeLine('', options)
  HCI.writeLine(`${HCI.bold(HCI.white(QUIT_KEY))}) Quit`, options)
  printChoicePrompt(options)
}

function printChoicePrompt(options: Pick<TaoDevSelectionOptions, 'output'>): void {
  HCI.write(`${HCI.bold(HCI.white('Choose'))}: `, options)
}
