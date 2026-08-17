import { Text } from './core/shared-core'
import * as HCI from './HCI'
import * as Platform from './Platform'

/** CompletionCandidate describes one shell completion value. */
export type CompletionCandidate = {
  description: string
  value: string
}

/** CompletionRequest describes the shell words being completed. */
export type CompletionRequest = {
  current?: number
  words: readonly string[]
}

/** CompletionRegisterOptions configures shell completion commands for a CLI. */
export type CompletionRegisterOptions = {
  commandNames?: readonly string[]
  executableName: string
  functionName?: string
}

type CompletionCommand = {
  readonly commands: readonly CompletionCommand[]
  readonly options: readonly CompletionOption[]
  readonly registeredArguments: readonly unknown[]
  createHelp(): CompletionHelp
  description(): string
  name(): string
}

type CompletionHelp = {
  optionDescription(option: CompletionOption): string
  subcommandDescription(command: CompletionCommand): string
  visibleCommands(command: CompletionCommand): CompletionCommand[]
  visibleOptions(command: CompletionCommand): CompletionOption[]
}

type CompletionOption = {
  description: string
  flags: string
  long?: string
  optional: boolean
  required: boolean
  short?: string
  variadic: boolean
}

type CompletionCommandRegistrar = CompletionCommand & {
  command(nameAndArgs: string, options?: { hidden?: boolean }): CompletionCommandBuilder
}

type CompletionCommandBuilder = CompletionCommandRegistrar & {
  action(handler: (...args: never[]) => void | Promise<void>): CompletionCommandBuilder
  allowExcessArguments(value?: boolean): CompletionCommandBuilder
  allowUnknownOption(value?: boolean): CompletionCommandBuilder
  description(description: string): CompletionCommandBuilder
  option(flags: string, description?: string, defaultValue?: unknown): CompletionCommandBuilder
}

type CompletionProtocolOptions = {
  current?: string
}

/** Completion provides shared Commander-backed shell completion helpers. */
export const Completion = {
  candidates,
  formatCandidates,
  register,
  zshScript,
}

function candidates(rootCommand: CompletionCommand, request: CompletionRequest): CompletionCandidate[] {
  const currentIndex = request.current === undefined
    ? Math.max(0, request.words.length - 1)
    : Math.max(0, request.current - 1)
  const currentWord = request.words[currentIndex] ?? ''
  const previousWords = request.words.slice(1, currentIndex)
  const command = commandForWords(rootCommand, previousWords)

  if (currentWord.startsWith('-')) {
    return visibleOptions(command)
      .map(optionCandidate)
      .filter(candidate => candidate.value.startsWith(currentWord))
  }

  return visibleCommands(command)
    .map(commandCandidate(command))
    .filter(candidate => candidate.value.startsWith(currentWord))
}

function formatCandidates(completions: readonly CompletionCandidate[]): string {
  if (completions.length === 0) {
    return ''
  }
  return `${completions.map(candidate => `${candidate.value}\t${candidate.description}`).join('\n')}\n`
}

function register(rootCommand: CompletionCommand, options: CompletionRegisterOptions): void {
  const registrar = rootCommand as CompletionCommandRegistrar

  registrar
    .command('completion [shell]')
    .description('Print shell completion script.')
    .action((shell = 'zsh') => {
      if (shell !== 'zsh') {
        HCI.writeErrorLine(`Unsupported completion shell '${shell}'. Use 'zsh'.`)
        Platform.runtimeProcess.setExitCode(1)
        return
      }
      HCI.write(zshScript(options))
    })

  registrar
    .command('__complete [words...]', { hidden: true })
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .option('--current <index>', 'Current shell word index.')
    .action((words: string[] = [], commandOptions: CompletionProtocolOptions = {}) => {
      HCI.write(formatCandidates(candidates(rootCommand, {
        current: parseCurrent(commandOptions.current),
        words,
      })))
    })
}

function zshScript(options: CompletionRegisterOptions): string {
  const commandNames = [...new Set(options.commandNames?.length ? options.commandNames : [options.executableName])]
  const functionName = options.functionName ?? `_${sanitizeZshIdentifier(options.executableName)}`
  const tag = sanitizeZshIdentifier(`${options.executableName}-commands`)
  const quotedCommandNames = commandNames.map(quoteZshWord).join(' ')

  return Text.stripIndent(`
    #compdef ${commandNames.join(' ')}

    ${functionName}() {
      local -a completion_lines completion_candidates
      local line value description

      completion_lines=("\${(@f)$(command "\${words[1]}" __complete --current "\${CURRENT}" -- "\${words[@]}" 2>/dev/null)}")
      completion_candidates=()

      for line in "\${completion_lines[@]}"; do
        [[ -z "\${line}" ]] && continue
        value="\${line%%$'\\t'*}"
        if [[ "\${line}" == *$'\\t'* ]]; then
          description="\${line#*$'\\t'}"
        else
          description=''
        fi
        completion_candidates+=("\${value}:\${description}")
      done

      if (( \${#completion_candidates[@]} )); then
        _describe -t ${tag} '${options.executableName} commands' completion_candidates
      else
        _files
      fi
    }

    compdef ${functionName} ${quotedCommandNames}
  `)
}

function commandForWords(rootCommand: CompletionCommand, words: readonly string[]): CompletionCommand {
  let command = rootCommand
  for (let index = 0; index < words.length;) {
    const word = words[index] ?? ''
    if (word === '--') {
      return command
    }
    if (word.startsWith('-')) {
      const option = findOption(command, word)
      index += option !== undefined && optionTakesValue(option) && !word.includes('=') ? 2 : 1
      continue
    }

    const subcommand = visibleCommands(command).find(candidate => candidate.name() === word)
    if (subcommand === undefined) {
      return command
    }
    command = subcommand
    index += 1
  }
  return command
}

function visibleCommands(command: CompletionCommand): CompletionCommand[] {
  return command.createHelp().visibleCommands(command)
}

function visibleOptions(command: CompletionCommand): CompletionOption[] {
  return command.createHelp().visibleOptions(command)
}

function commandCandidate(parentCommand: CompletionCommand): (command: CompletionCommand) => CompletionCandidate {
  const help = parentCommand.createHelp()
  return command => ({
    description: help.subcommandDescription(command) || command.description(),
    value: command.name(),
  })
}

function optionCandidate(option: CompletionOption): CompletionCandidate {
  return {
    description: option.description,
    value: option.long ?? option.short ?? option.flags.split(/[ ,|]+/)[0] ?? '',
  }
}

function findOption(command: CompletionCommand, word: string): CompletionOption | undefined {
  const optionName = word.split('=')[0] ?? word
  return visibleOptions(command).find(option => option.short === optionName || option.long === optionName)
}

function optionTakesValue(option: CompletionOption): boolean {
  return option.required || option.optional || option.variadic
}

function parseCurrent(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function sanitizeZshIdentifier(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9_]+/g, '_').replaceAll(/^_+|_+$/g, '') || 'completion'
}

function quoteZshWord(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}
