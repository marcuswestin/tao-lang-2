import { createInterface as createNodeReadlineInterface } from 'node:readline/promises'
import type { Readable, Writable } from 'node:stream'
import { UserInputError } from './core/Errors'
import { runtimeProcess } from './Platform'

type TerminalStreams = {
  input?: Readable
  output?: Writable
  interactive?: boolean
}
type ProcessColor = (value: string) => string

/** OutputOptions declares the target stream for human-readable output. */
export type OutputOptions = {
  output?: Writable
}

/** TextPromptOptions declares options for text prompts. */
export type TextPromptOptions = TerminalStreams & {
  message: string
  defaultValue?: string
  validate?: (value: string) => string | undefined
}

/** ConfirmPromptOptions declares options for yes/no prompts. */
export type ConfirmPromptOptions = TerminalStreams & {
  message: string
  defaultValue?: boolean
}

/** Choice declares one selectable prompt value. */
export type Choice<ValueT extends string> = {
  value: ValueT
  label?: string
}

/** ChoicePromptOptions declares options for choice prompts. */
export type ChoicePromptOptions<ValueT extends string> = TerminalStreams & {
  message: string
  choices: readonly Choice<ValueT>[]
  defaultValue?: ValueT
}

const PROCESS_COLORS: Record<string, ProcessColor> = {
  clean: red,
  compile: green,
  deps: blue,
  dev: cyan,
  expo: magenta,
  extension: white,
  fix: yellow,
  just: yellow,
  parser: green,
  verify: blue,
  test: green,
}

export function isInteractive(options: TerminalStreams = {}): boolean {
  if (options.interactive !== undefined) {
    return options.interactive
  }

  const input = options.input ?? runtimeProcess.stdin
  const output = options.output ?? runtimeProcess.stdout

  return hasTruthyIsTTY(input) && hasTruthyIsTTY(output)
}

/** write writes human-readable output to stdout or the provided output stream. */
export function write(message: string | Uint8Array, options: OutputOptions = {}): void {
  ;(options.output ?? runtimeProcess.stdout).write(message)
}

/** writeLine writes human-readable text plus a newline to stdout or the provided output stream. */
export function writeLine(message = '', options: OutputOptions = {}): void {
  write(`${message}\n`, options)
}

/** writeError writes human-readable error output to stderr or the provided output stream. */
export function writeError(message: string | Uint8Array, options: OutputOptions = {}): void {
  ;(options.output ?? runtimeProcess.stderr).write(red(formatOutputMessage(message)))
}

/** writeErrorLine writes human-readable error text plus a newline to stderr or the provided output stream. */
export function writeErrorLine(message = '', options: OutputOptions = {}): void {
  writeError(`${message}\n`, options)
}

/** writeSuccess writes human-readable success output to stdout or the provided output stream. */
export function writeSuccess(message: string | Uint8Array, options: OutputOptions = {}): void {
  write(green(formatOutputMessage(message)), options)
}

/** logProcessInfo writes a prefixed informational process line. */
export function logProcessInfo(processName: string, message: string): void {
  writeLine(`${formatProcessPrefix(processName)} ${dim(message)}`)
}

/** logProcessOutput writes a prefixed process output line. */
export function logProcessOutput(processName: string, message: string, options: { stderr?: boolean } = {}): void {
  const line = `${formatProcessPrefix(processName)} ${dim(message)}\n`
  if (options.stderr) {
    writeErrorRaw(line)
  } else {
    write(line)
  }
}

/** logProcessWarn writes a prefixed warning process line. */
export function logProcessWarn(processName: string, message: string): void {
  writeErrorRaw(`${formatProcessPrefix(processName)} ${yellow(message)}\n`)
}

/** logProcessError writes a prefixed error process line. */
export function logProcessError(processName: string, message: string): void {
  writeErrorRaw(`${formatProcessPrefix(processName)} ${red(message)}\n`)
}

/** formatProcessPrefix returns a colored process prefix. */
export function formatProcessPrefix(processName: string): string {
  const color = PROCESS_COLORS[processName] ?? blue
  return `${color(`[${processName}]`)}${dim(':')}`
}

/** bold returns ANSI bold text. */
export function bold(value: string): string {
  return color(1, value)
}

/** dim returns ANSI dim text. */
export function dim(value: string): string {
  return color(2, value)
}

/** white returns ANSI white text. */
export function white(value: string): string {
  return color(37, value)
}

/** askText prompts for a text response. */
export async function askText(options: TextPromptOptions): Promise<string> {
  if (!isInteractive(options)) {
    return getNonInteractiveDefault(options.message, options.defaultValue)
  }

  return withReadline(options, async readline => {
    while (true) {
      const value = await readline.question(formatTextQuestion(options))
      const answer = value === '' && options.defaultValue !== undefined ? options.defaultValue : value
      const validationMessage = options.validate?.(answer)

      if (!validationMessage) {
        return answer
      }
      writeOutput(options, `${validationMessage}\n`)
    }
  })
}

/** askConfirm prompts for a yes/no response. */
export async function askConfirm(options: ConfirmPromptOptions): Promise<boolean> {
  if (!isInteractive(options)) {
    return getNonInteractiveDefault(options.message, options.defaultValue)
  }

  return withReadline(options, async readline => {
    while (true) {
      const value = (await readline.question(formatConfirmQuestion(options))).trim().toLowerCase()

      if (value === '' && options.defaultValue !== undefined) {
        return options.defaultValue
      }
      if (value === 'y' || value === 'yes') {
        return true
      }
      if (value === 'n' || value === 'no') {
        return false
      }
      writeOutput(options, 'Answer yes or no.\n')
    }
  })
}

/** askChoice prompts for one value from a fixed choice list. */
export async function askChoice<ValueT extends string>(options: ChoicePromptOptions<ValueT>): Promise<ValueT> {
  assertChoices(options)

  if (!isInteractive(options)) {
    return getNonInteractiveDefault(options.message, options.defaultValue)
  }

  return withReadline(options, async readline => {
    while (true) {
      const value = (await readline.question(formatChoiceQuestion(options))).trim()
      const defaultChoice = options.defaultValue ? findChoice(options.choices, options.defaultValue) : undefined
      const answer = value === '' ? defaultChoice : parseChoice(options.choices, value)

      if (answer) {
        return answer.value
      }
      writeOutput(options, 'Choose one of the listed options.\n')
    }
  })
}

async function withReadline<T>(
  options: TerminalStreams,
  fn: (readline: ReturnType<typeof createNodeReadlineInterface>) => Promise<T>,
) {
  const readline = createNodeReadlineInterface({
    input: options.input ?? runtimeProcess.stdin,
    output: options.output ?? runtimeProcess.stdout,
  })

  try {
    return await fn(readline)
  } finally {
    readline.close()
  }
}

function getNonInteractiveDefault<T>(message: string, defaultValue: T | undefined): T {
  if (defaultValue !== undefined) {
    return defaultValue
  }
  throw new UserInputError(`Cannot ask "${message}" without an interactive terminal.`)
}

function formatTextQuestion(options: TextPromptOptions): string {
  const suffix = options.defaultValue === undefined ? '' : ` [${options.defaultValue}]`
  return `${bold(white(`${options.message}${suffix}`))}: `
}

function formatConfirmQuestion(options: ConfirmPromptOptions): string {
  const suffix = options.defaultValue === true ? ' [Y/n]' : options.defaultValue === false ? ' [y/N]' : ' [y/n]'
  return `${bold(white(`${options.message}${suffix}`))}: `
}

function formatChoiceQuestion<ValueT extends string>(options: ChoicePromptOptions<ValueT>): string {
  const choices = options.choices
    .map((choice, index) => `${index + 1}) ${choice.label ?? choice.value}`)
    .join('\n')
  const defaultChoice = options.defaultValue === undefined
    ? undefined
    : findChoice(options.choices, options.defaultValue)
  const suffix = defaultChoice === undefined ? '' : ` [${defaultChoice.label ?? defaultChoice.value}]`

  return `${bold(white(`${options.message}${suffix}`))}\n${choices}\n${bold(white('Choose'))}: `
}

function parseChoice<ValueT extends string>(
  choices: readonly Choice<ValueT>[],
  value: string,
): Choice<ValueT> | undefined {
  const indexedChoice = choices[Number(value) - 1]
  if (indexedChoice) {
    return indexedChoice
  }
  return choices.find(choice => choice.value === value || choice.label === value)
}

function findChoice<ValueT extends string>(
  choices: readonly Choice<ValueT>[],
  value: ValueT,
): Choice<ValueT> | undefined {
  return choices.find(choice => choice.value === value)
}

function assertChoices<ValueT extends string>(options: ChoicePromptOptions<ValueT>): void {
  if (options.choices.length === 0) {
    throw new UserInputError(`Prompt "${options.message}" must provide at least one choice.`)
  }
  if (options.defaultValue && !findChoice(options.choices, options.defaultValue)) {
    throw new UserInputError(`Prompt "${options.message}" default value must match one of its choices.`)
  }
}

function writeOutput(options: TerminalStreams, message: string): void {
  ;(options.output ?? runtimeProcess.stdout).write(message)
}

function writeErrorRaw(message: string | Uint8Array, options: OutputOptions = {}): void {
  ;(options.output ?? runtimeProcess.stderr).write(message)
}

function formatOutputMessage(message: string | Uint8Array): string {
  return typeof message === 'string' ? message : Buffer.from(message).toString('utf8')
}

function hasTruthyIsTTY(stream: Readable | Writable): boolean {
  return (stream as { isTTY?: boolean }).isTTY === true
}

function blue(value: string): string {
  return color(34, value)
}

function cyan(value: string): string {
  return color(36, value)
}

function green(value: string): string {
  return color(32, value)
}

function magenta(value: string): string {
  return color(35, value)
}

function red(value: string): string {
  return color(31, value)
}

function yellow(value: string): string {
  return color(33, value)
}

function color(code: number, value: string): string {
  return `\u001b[${code}m${value}\u001b[0m`
}
