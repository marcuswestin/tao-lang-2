import { Command } from '@commander-js/extra-typings'
import { CLI, FS } from '@shared'

const COMMAND_WHITELIST = ['ls', 'rg', 'git', 'cp', 'mv', 'rm', 'just'] as const

const REPO_ROOT = process.env['TAO_REPO_ROOT'] ?? FS.resolvePath('../..')
const MAIN_JUSTFILE = FS.joinPath(REPO_ROOT, 'Justfile')
const INVOCATION_CWD = process.env['TAO_AGENT_CWD'] ?? process.cwd()

type WhitelistedCommand = typeof COMMAND_WHITELIST[number]

const program = new Command()

program
  .name('agent')
  .helpOption(false)
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .passThroughOptions()
  .argument('[command]')
  .argument('[args...]')
  .action(async (command: string | undefined, commandArgs: string[]) => {
    process.exitCode = await runAgent(command, commandArgs)
  })

program.parse(Bun.argv)

async function runAgent(command: string | undefined, commandArgs: readonly string[]): Promise<number> {
  if (command === undefined || command === 'help') {
    return await printHelp()
  }

  if (!isWhitelistedCommand(command)) {
    process.stderr.write(`Error: Command '${command}' is not whitelisted. Ask if you can add it.\n`)
    return 1
  }

  if (command === 'just') {
    return await runJust(commandArgs)
  }

  return await runWithInheritedOutput(command, commandArgs, INVOCATION_CWD)
}

function isWhitelistedCommand(command: string): command is WhitelistedCommand {
  return COMMAND_WHITELIST.includes(command as WhitelistedCommand)
}

async function printHelp(): Promise<number> {
  const justList = await CLI.run({
    command: 'just',
    args: ['--justfile', MAIN_JUSTFILE, '--list'],
    cwd: REPO_ROOT,
  })

  if (justList.exitCode !== 0) {
    process.stdout.write(justList.stdout)
    process.stderr.write(justList.stderr)
    return justList.exitCode ?? 1
  }

  process.stdout.write(`Usage:
  ./agent help
  ./agent just <recipe> [args...]
  ./agent <allowlisted-command> [args...]

Behavior:
  - just recipes run from the repo root.
  - successful just recipe output is hidden to save tokens.
  - failed just recipes replay captured stdout/stderr.
  - shell commands run from the directory where ./agent was invoked.
  - use shell cd or tool workdir before invoking ./agent when you need another cwd.

Examples:
  ./agent just check
  ./agent just test
  ./agent rg -n "pattern" packages

Just recipes:
${indent(justList.stdout.trimEnd())}

Allowlisted shell commands:
`)

  for (const command of COMMAND_WHITELIST) {
    process.stdout.write(`    ${command}\n`)
  }

  return 0
}

function indent(text: string): string {
  return text.split('\n').map(line => `  ${line}`).join('\n')
}

async function runJust(args: readonly string[]): Promise<number> {
  const commandArgs = ['--justfile', MAIN_JUSTFILE, ...args]

  if (shouldShowJustOutput(args)) {
    return await runWithInheritedOutput('just', commandArgs, REPO_ROOT)
  }

  return await runQuietly('just', commandArgs, REPO_ROOT)
}

function shouldShowJustOutput(args: readonly string[]): boolean {
  return args.length === 0 || args[0] === 'help' || args.includes('--list') || args.includes('-l')
}

async function runQuietly(command: string, args: readonly string[], cwd: string): Promise<number> {
  const result = await CLI.run({ command, args, cwd })

  if (result.exitCode !== 0 || result.error !== undefined) {
    process.stdout.write(result.stdout)
    process.stderr.write(result.stderr)

    if (result.error !== undefined) {
      process.stderr.write(
        `Error: Failed to execute ${CLI.formatCommand({ command, args })}: ${result.error.message}\n`,
      )
    }
  }

  return result.exitCode ?? 1
}

async function runWithInheritedOutput(command: string, args: readonly string[], cwd: string): Promise<number> {
  const result = await CLI.run({
    command,
    args,
    cwd,
    stdio: 'inherit',
  })

  if (result.error !== undefined) {
    process.stderr.write(`Error: Failed to execute ${CLI.formatCommand({ command, args })}: ${result.error.message}\n`)
  }

  return result.exitCode ?? 1
}
