import { CLI, FS, HCI, Platform, Repo } from '@shared'
import { parseAgentFlags } from './AgentFlags'
import { buildJsonReport, buildReportText, startLine } from './AgentReport'
import { parseFailuresFromOutput } from './FailureParser'
import { readSummaryFailures } from './SummaryFailures'

/**
 * `AgentRunner` is the one place every `./agent` command runs through, replacing the raw
 * `stdio: 'inherit'` passthrough: it captures the child's stdout and stderr merged in the order
 * they arrived, writes that capture to this command's own log plus a refreshed `latest.log`, reads
 * or infers what failed, and prints the bounded report an agent can act on instead of a raw dump.
 */

/** POSIX signal numbers for the signals a supervised child is actually sent; `128 + n` is the
 * shell's own convention for reporting a death by signal as an exit status. */
const SIGNAL_NUMBERS: Record<string, number> = {
  SIGABRT: 6,
  SIGALRM: 14,
  SIGBUS: 7,
  SIGFPE: 8,
  SIGHUP: 1,
  SIGILL: 4,
  SIGINT: 2,
  SIGKILL: 9,
  SIGPIPE: 13,
  SIGQUIT: 3,
  SIGSEGV: 11,
  SIGTERM: 15,
  SIGTRAP: 5,
  SIGUSR1: 10,
  SIGUSR2: 12,
}

/** RunAgentCommandOptions describes one `./agent <command>` invocation. `spawnCommand`/`spawnArgs`
 * are separate from `command` so a test can point the runner at a tiny probe script instead of
 * `just`, without the report, policy, or log naming caring which process actually ran. */
export type RunAgentCommandOptions = {
  /** The raw arguments after the command name, including the front door's own flags. */
  args: readonly string[]
  /** The `./agent` command name: what the output policy, the log directory, and the lane-summary
   * guess are all keyed on. */
  command: string
  cwd?: string
  now?: () => number
  run?: typeof CLI.run
  spawnArgs: readonly string[]
  spawnCommand: string
}

/** runAgentCommand runs one command through the front door and returns its faithful exit status. */
export async function runAgentCommand(options: RunAgentCommandOptions): Promise<number> {
  const repositoryRoot = options.cwd ?? Repo.getRoot()
  const flags = parseAgentFlags(options.args)
  const run = options.run ?? CLI.run
  const now = options.now ?? Date.now
  const startedAt = now()

  const logDir = FS.resolvePath(`.artifacts/logs/agent/${options.command}`, repositoryRoot)
  const logPath = FS.resolvePath(`${agentRunStamp(startedAt)}.log`, logDir)
  const latestPath = FS.resolvePath('latest.log', logDir)
  await FS.mkdir(logDir)

  if (!flags.json) {
    HCI.writeLine(startLine(options.command, logPath))
  }

  const chunks: string[] = []
  const result = await run(options.spawnCommand, {
    args: [...options.spawnArgs, ...flags.rest],
    cwd: repositoryRoot,
    onOutput: (_stream, chunk) => {
      chunks.push(chunk.toString('utf8'))
    },
    stdio: flags.verbose ? 'stream' : 'pipe',
  })
  const output = chunks.join('')
  const durationMs = now() - startedAt
  const exitCode = exitStatusFor(result)

  await FS.writeText(logPath, output)
  await FS.writeText(latestPath, output)

  const summary = await readSummaryFailures({ command: options.command, output, repositoryRoot, startedAt })
  const failures = summary?.failures
    ?? (exitCode === 0 ? [] : parseFailuresFromOutput(output, options.command))

  const outcome = { args: flags.rest, command: options.command, durationMs, exitCode, failures, logPath, output }

  if (flags.json) {
    HCI.writeLine(JSON.stringify(buildJsonReport(outcome, { maxLines: flags.maxLines })))
  } else {
    HCI.writeLine('')
    HCI.writeLine(buildReportText(outcome, { maxLines: flags.maxLines, verbose: flags.verbose }))
  }

  return exitCode
}

/** exitStatusFor never hides a failure behind a clean-looking zero: a spawn error is 1, a signalled
 * child is 128+n, and only a real exit code is reported as itself. */
function exitStatusFor(result: { error?: Error; exitCode: number | null; signal: string | null }): number {
  if (result.error !== undefined) {
    return 1
  }
  if (result.exitCode !== null) {
    return result.exitCode
  }
  if (result.signal !== null) {
    return 128 + (SIGNAL_NUMBERS[result.signal] ?? 0)
  }
  return 1
}

function agentRunStamp(atMs: number): string {
  const timestamp = new Date(atMs).toISOString().replaceAll(/[:.]/g, '-')
  return `${timestamp}-${Platform.runtimeProcess.pid}`
}
