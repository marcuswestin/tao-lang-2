import type { Command } from '@commander-js/extra-typings'
import { CLI, FS, HCI, Platform, Repo, Text } from '@shared'
import { formatArtifactRunId } from './artifacts'
import { runCommand } from './commands'

const STREAMED_JUST_RECIPES = new Set(['android', 'dev'])
const FAILURE_REPLAY_LIMIT = 8_000
const FAILURE_EXCERPT_LIMIT = 1_200

/** registerJustCommand registers the repo-root Just command passthrough. */
export function registerJustCommand(commands: Command): void {
  commands
    .command('just [args...]')
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .passThroughOptions()
    .description('Run a Just recipe from the repo root.')
    .action(async (args: string[] = []) => {
      Platform.runtimeProcess.setExitCode(await runJust(args))
    })
}

/** runJust runs Just from the repo root with output filtering for successful commands. */
async function runJust(args: readonly string[]): Promise<number> {
  const commandArgs = ['--justfile', FS.repoPath('Justfile'), ...args]
  const repoRoot = Repo.getRoot()

  if (shouldStreamJustOutput(args)) {
    return await runCommand('just', commandArgs, { cwd: repoRoot })
  }

  const startedAt = Date.now()
  const result = await CLI.run('just', { args: commandArgs, cwd: repoRoot })
  const elapsedMs = Date.now() - startedAt

  if (result.error === undefined && result.exitCode === 0) {
    HCI.writeLine(formatJustSuccessLine(args, `${result.stdout}\n${result.stderr}`, elapsedMs))
    return 0
  }

  const logDir = await writeJustFailureLogs(args, result, { elapsedMs, repoRoot })
  writeJustFailureReport(args, result, { elapsedMs, logDir })
  return result.error ? 1 : (result.exitCode ?? 1)
}

/** shouldStreamJustOutput returns whether a Just invocation needs inherited output. */
export function shouldStreamJustOutput(args: readonly string[]): boolean {
  return args.length === 0 || args[0] === 'help' || STREAMED_JUST_RECIPES.has(args[0] ?? '')
    || args.includes('--help') || args.includes('-h')
    || args.includes('--list') || args.includes('-l')
}

/** formatJustSuccessLine formats the quiet Just success summary. */
export function formatJustSuccessLine(args: readonly string[], output: string, elapsedMs: number): string {
  const summary = parseJustSuccessSummary(output)
  return `[just]: ${formatJustRecipe(args)} ok in ${formatElapsed(elapsedMs)}${
    summary === undefined ? '' : ` (${summary})`
  }`
}

/** parseJustSuccessSummary extracts useful counts from hidden successful Just output. */
export function parseJustSuccessSummary(output: string): string | undefined {
  let testCount = 0

  for (const line of output.split('\n')) {
    const match = [
      /\bTests?:\s+\d+\s+failed,\s+(\d+)\s+passed\b/i,
      /\bTests?:\s+(\d+)\s+passed\b/i,
      /\b(\d+)\s+tests?\s+passed\b/i,
      /^\s*(\d+)\s+pass(?:ed)?\b/i,
    ]
      .map(pattern => pattern.exec(line))
      .find(lineMatch => lineMatch?.[1] !== undefined)

    if (match?.[1] !== undefined) {
      testCount += Number.parseInt(match[1], 10)
    }
  }

  return testCount === 0 ? undefined : `${testCount} tests passed`
}

function formatJustRecipe(args: readonly string[]): string {
  const recipe = args.find(arg => !arg.startsWith('-'))
  return recipe ?? 'default'
}

function formatElapsed(elapsedMs: number): string {
  if (elapsedMs < 1_000) {
    return `${elapsedMs}ms`
  }
  return `${(elapsedMs / 1_000).toFixed(1)}s`
}

async function writeJustFailureLogs(
  args: readonly string[],
  result: CLI.CommandResult,
  options: { elapsedMs: number; repoRoot: string },
): Promise<string> {
  const logDir = FS.resolvePath(
    `.artifacts/logs/agent/${formatArtifactRunId()}-just-${sanitizeLogName(formatJustRecipe(args))}`,
    { cwd: options.repoRoot },
  )
  await FS.mkdir(logDir)
  await FS.writeText(FS.resolvePath('command.txt', { cwd: logDir }), formatFailureCommand(result, options.elapsedMs))
  await FS.writeText(FS.resolvePath('stdout.log', { cwd: logDir }), result.stdout)
  await FS.writeText(FS.resolvePath('stderr.log', { cwd: logDir }), result.stderr)
  return logDir
}

function writeJustFailureReport(
  args: readonly string[],
  result: CLI.CommandResult,
  options: { elapsedMs: number; logDir: string },
): void {
  const exitCode = result.error ? 1 : (result.exitCode ?? 1)
  const command = CLI.formatCommand(result.command, { args: result.args })
  const combinedOutput = `${result.stdout}${result.stderr}`

  HCI.writeErrorLine(
    `[just]: ${formatJustRecipe(args)} failed in ${formatElapsed(options.elapsedMs)} (exit ${exitCode})`,
  )
  HCI.writeErrorLine(`command: ${command}`)
  HCI.writeErrorLine(`logs: ${options.logDir}`)

  if (result.error !== undefined) {
    HCI.writeErrorLine(`error: ${result.error.message}`)
  }
  if (combinedOutput.length === 0) {
    return
  }
  if (combinedOutput.length <= FAILURE_REPLAY_LIMIT) {
    HCI.write(result.stdout)
    HCI.writeError(result.stderr)
    return
  }

  const stdoutExcerpt = excerpt(result.stdout)
  const stderrExcerpt = excerpt(result.stderr)
  if (stdoutExcerpt.length > 0) {
    HCI.writeErrorLine('stdout excerpt:')
    HCI.writeErrorLine(Text.indentLines(stdoutExcerpt, 2))
  }
  if (stderrExcerpt.length > 0) {
    HCI.writeErrorLine('stderr excerpt:')
    HCI.writeErrorLine(Text.indentLines(stderrExcerpt, 2))
  }
}

function formatFailureCommand(result: CLI.CommandResult, elapsedMs: number): string {
  return Text.stripIndent(`
    command: ${CLI.formatCommand(result.command, { args: result.args })}
    cwd: ${result.cwd ?? ''}
    exitCode: ${result.exitCode ?? ''}
    signal: ${result.signal ?? ''}
    elapsed: ${formatElapsed(elapsedMs)}
  `)
}

function excerpt(output: string): string {
  const trimmed = output.trim()
  if (trimmed.length <= FAILURE_EXCERPT_LIMIT) {
    return trimmed
  }
  const excerptPartLength = Math.floor(FAILURE_EXCERPT_LIMIT / 2)
  return `${trimmed.slice(0, excerptPartLength)}\n...\n${trimmed.slice(-excerptPartLength)}`
}

function sanitizeLogName(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9._-]+/g, '-').replaceAll(/^-|-$/g, '') || 'recipe'
}
