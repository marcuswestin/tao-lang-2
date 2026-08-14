import { Errors, HCI, Platform } from '@shared'
import type { Readable, Writable } from 'node:stream'
import type { TaoDevApp, TaoDevProject } from './dev-app-discovery'

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
    throw new Errors.UserInputError('No runnable Tao apps found under the target path.')
  }
  if (apps.length > MAX_APP_CHOICES) {
    throw new Errors.UserInputError(
      `Found ${apps.length} runnable Tao apps, but the single-key selector supports ${MAX_APP_CHOICES}. Narrow the dev target path.`,
    )
  }
  if (!HCI.isInteractive(options)) {
    throw new Errors.UserInputError(
      `Multiple runnable Tao apps were found: ${apps.map(app => app.appName).join(', ')}. Select one with --app.`,
    )
  }

  return await withRawChoiceInput(options.input, async readKey => {
    printChoices(projects, options)
    while (true) {
      const key = await readKey()
      if (key === '\u0003') {
        return { kind: 'exit', exitCode: 130 }
      }

      const choiceIndex = choiceIndexForKey(key)
      const app = choiceIndex === undefined ? undefined : apps[choiceIndex]
      if (app !== undefined) {
        return { kind: 'selected', app }
      }
      if (key === '\u001b') {
        return { kind: 'cancel' }
      }
      if (key.toLowerCase() === 'q') {
        return { kind: 'exit', exitCode: 0 }
      }
      HCI.writeLine(`Choose an app with ${choiceKeySummary(apps.length)}, or Q to quit.`, options)
      printChoicePrompt(options)
    }
  })
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

async function withRawChoiceInput<Result>(
  input: Readable = Platform.runtimeProcess.stdin,
  run: (readKey: () => Promise<string>) => Promise<Result>,
): Promise<Result> {
  const rawMode = input === Platform.runtimeProcess.stdin
    ? Platform.setStdinRawMode(true)
    : setCustomInputRawMode(input, true)
  input.resume()
  try {
    return await run(() => readChoiceKey(input))
  } finally {
    if (rawMode) {
      if (input === Platform.runtimeProcess.stdin) {
        Platform.setStdinRawMode(false)
      } else {
        setCustomInputRawMode(input, false)
      }
    }
  }
}

async function readChoiceKey(input: Readable): Promise<string> {
  return await new Promise<string>(resolve => {
    const finish = (key: string) => {
      input.off('data', onData)
      input.off('end', onEnd)
      resolve(key)
    }
    const onData = (chunk: Buffer | string) => {
      const value = chunk.toString()
      finish(value.startsWith('\u001b') ? '\u001b' : value[0] ?? '')
    }
    const onEnd = () => finish('\u0003')
    input.on('data', onData)
    input.on('end', onEnd)
  })
}

function setCustomInputRawMode(input: Readable, enabled: boolean): boolean {
  const rawInput = input as Readable & { isTTY?: boolean; setRawMode?: (rawMode: boolean) => void }
  if (rawInput.isTTY !== true || rawInput.setRawMode === undefined) {
    return false
  }
  rawInput.setRawMode(enabled)
  return true
}
