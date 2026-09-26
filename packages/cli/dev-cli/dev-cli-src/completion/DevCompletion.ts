import type { runWithCommands } from '@cli-kit/RunWithCommands'

type Command = Parameters<Parameters<typeof runWithCommands>[0]>[0]
type ChildCommand = Command['commands'][number]

/** Generate the Zsh completion function from the commands and options registered on `dev`. */
export function devZshCompletion(root: Command): string {
  const commands = root.commands
  const lines = [
    '#compdef dev',
    '_tao_dev_completion() {',
    '  local -a candidates',
    '  if (( CURRENT == 2 )); then',
    `    candidates=(${commands.map(command => quote(command.name())).join(' ')})`,
    '    compadd -- "${candidates[@]}"',
    '    return',
    '  fi',
    '  if (( CURRENT == 3 )); then',
    '    case "$words[2]" in',
    ...commands.filter(command => command.commands.length > 0).flatMap(command => [
      `      ${quote(command.name())})`,
      `        candidates=(${command.commands.map(child => quote(child.name())).join(' ')})`,
      '        compadd -- "${candidates[@]}"',
      '        return',
      '        ;;',
    ]),
    '    esac',
    '  fi',
    '  if [[ "$PREFIX" == -* ]]; then',
    '    case "$words[2]" in',
    ...commands.flatMap(command => [
      `      ${quote(command.name())})`,
      `        candidates=(${optionNames(command).map(quote).join(' ')})`,
      '        compadd -- "${candidates[@]}"',
      '        return',
      '        ;;',
    ]),
    '    esac',
    '  fi',
    '  _files',
    '}',
    'compdef _tao_dev_completion dev ./dev',
    '',
  ]
  return lines.join('\n')
}

function optionNames(command: ChildCommand): string[] {
  return [
    ...new Set(command.options.flatMap(option => [option.short, option.long].filter(value => value !== undefined))),
  ]
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}
