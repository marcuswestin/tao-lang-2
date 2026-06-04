import { UserInputError } from './Errors'
import { createNodeReadlineInterface, type Readable, runtimeProcess, type Writable } from './Platform'

type TerminalStreams = {
  input?: Readable
  output?: Writable
  interactive?: boolean
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

function isInteractive(options: TerminalStreams = {}): boolean {
  if (options.interactive !== undefined) {
    return options.interactive
  }

  const input = options.input ?? runtimeProcess.stdin
  const output = options.output ?? runtimeProcess.stdout

  return hasTruthyIsTTY(input) && hasTruthyIsTTY(output)
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
  return `${options.message}${suffix}: `
}

function formatConfirmQuestion(options: ConfirmPromptOptions): string {
  const suffix = options.defaultValue === true ? ' [Y/n]' : options.defaultValue === false ? ' [y/N]' : ' [y/n]'
  return `${options.message}${suffix}: `
}

function formatChoiceQuestion<ValueT extends string>(options: ChoicePromptOptions<ValueT>): string {
  const choices = options.choices
    .map((choice, index) => `${index + 1}) ${choice.label ?? choice.value}`)
    .join(' ')
  const suffix = options.defaultValue === undefined ? '' : ` [${options.defaultValue}]`

  return `${options.message}${suffix} ${choices}: `
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

function hasTruthyIsTTY(stream: Readable | Writable): boolean {
  return (stream as { isTTY?: boolean }).isTTY === true
}
