import { CLI, Errors, FS, HCI, Platform, Repo } from '@shared'
import { UiVisibility } from '@verification/UiVisibility'
import { parseAgentFlags } from './AgentFlags'
import type { AgentRunOutcome, BuildReportOptions } from './AgentReport'
import { buildJsonReport, buildReportText, startLine } from './AgentReport'
import { parseFailuresFromOutput } from './FailureParser'
import { readSummaryFailures } from './SummaryFailures'

/**
 * `AgentRunner` is the one place every `./agent` command runs through, replacing the raw
 * `stdio: 'inherit'` passthrough: it captures the child's stdout and stderr merged in the order
 * they arrived, appending each chunk to this command's own log plus a refreshed `latest.log` as it
 * arrives, reads or infers what failed, and prints the bounded report an agent can act on instead of
 * a raw dump.
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

/** The signals a harness plausibly cancels or times out a run with, each forwarded to the child so
 * nothing this front door started outlives it — `just` spawns grandchildren of its own, but
 * `CLI.start`'s own teardown already walks the whole owned process tree rather than only the direct
 * child, so forwarding the signal here is all this module needs to do. */
const TERMINATION_SIGNALS: readonly Platform.ProcessSignal[] = ['SIGINT', 'SIGTERM', 'SIGHUP']

/**
 * `./agent` commands whose own implementation can prompt over `HCI` when interactive, found by
 * reading every `JUST_COMMANDS` implementation for an `HCI.ask*` or `isInteractive` call:
 * `land-unlock --force`'s "Has it really stopped?" confirmation before breaking another worktree's
 * landing lock (`dev-cli-src/dev.ts`), `setup-clerk`'s hidden credential prompts, and optional
 * developer shell activation at the end of `setup` or through `shell-setup`.
 */
const PROMPTING_COMMANDS = new Set(['land-unlock', 'setup-clerk', 'setup', 'shell-setup'])

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
  /** Test seam: the environment whose `CI` makes output stream by default; the process's own otherwise. */
  env?: Readonly<Record<string, string | undefined>>
  /** Test seam: overrides `HCI.isInteractive`, which otherwise decides whether a prompting command
   * runs in passthrough mode. */
  isInteractive?: () => boolean
  now?: () => number
  /** Test seam: overrides `Platform.onProcessSignal`, so a test can simulate this process being
   * signalled without sending a real one to the process the test itself runs in. */
  onProcessSignal?: typeof Platform.onProcessSignal
  /** Test seam: overrides `CLI.start`, so a test can observe cancellation and log behavior against
   * a real child process without spawning `just`. */
  start?: typeof CLI.start
  spawnArgs: readonly string[]
  spawnCommand: string
}

/** runAgentCommand runs one command through the front door and returns its faithful exit status. */
export async function runAgentCommand(options: RunAgentCommandOptions): Promise<number> {
  const repositoryRoot = options.cwd ?? Repo.getRoot()
  const flags = parseAgentFlags(options.args, options.env ?? Platform.runtimeProcess.env)
  const initialWarnings = UiVisibility.warningsForCommand(options.command, flags.rest)
  const start = options.start ?? CLI.start
  const now = options.now ?? Date.now
  const isInteractive = options.isInteractive ?? HCI.isInteractive
  const onProcessSignal = options.onProcessSignal ?? Platform.onProcessSignal
  const startedAt = now()

  const logDir = FS.resolvePath(`.artifacts/logs/agent/${options.command}`, repositoryRoot)
  const logPath = FS.resolvePath(`${agentRunStamp(startedAt)}.log`, logDir)
  const latestPath = FS.resolvePath('latest.log', logDir)
  const log = openRunLog(logPath, latestPath)

  if (!flags.json) {
    HCI.writeLine(startLine(options.command, logPath))
  }
  for (const warning of initialWarnings) {
    const line = `WARNING: ${warning}\n`
    if (flags.json) {
      HCI.writeStderr(line)
    } else {
      HCI.writeLine(line.trimEnd())
    }
    log.append(Buffer.from(line, 'utf8'))
  }

  const chunks: string[] = []
  const appendOutput = (chunk: Buffer): void => {
    chunks.push(chunk.toString('utf8'))
    log.append(chunk)
  }

  try {
    UiVisibility.preflightCommand(options.command, flags.rest)
  } catch (error) {
    appendOutput(Buffer.from(`error: ${Errors.messageOf(error)}\n`, 'utf8'))
    const output = chunks.join('')
    const logUnavailable = await log.close()
    printOutcome({
      args: flags.rest,
      command: options.command,
      durationMs: now() - startedAt,
      exitCode: 1,
      failures: parseFailuresFromOutput(output, options.command),
      logPath,
      ...(logUnavailable === undefined ? {} : { logUnavailable }),
      output,
      warnings: initialWarnings,
    }, { json: flags.json, maxLines: flags.maxLines })
    return 1
  }

  const runStdio = resolveRunStdio(options.command, flags, isInteractive)
  // Development launchers intentionally return with a managed server still running.
  const supervisesTests = /^(?:test(?:-|$)|verify(?:-|$)|check$|finalize$)/u.test(options.command)
  // Subscribe before spawning: a signal between the two would otherwise kill this process by default
  // and orphan the child it was meant to stop. Listeners run on the event loop, after `child` is set.
  let cancelledBy: Platform.ProcessSignal | undefined
  const unsubscribes = TERMINATION_SIGNALS.map(signal =>
    onProcessSignal(signal, () => {
      cancelledBy ??= signal
      child.kill(signal)
    })
  )
  const child = start(options.spawnCommand, {
    // Retain descendant identities while suites run, so a failed wrapper cannot orphan them.
    processPolicy: supervisesTests ? 'test' : 'tool',
    // Captured test commands own an isolated group; prompting commands retain terminal job control.
    detached: supervisesTests && runStdio.stdio !== 'inherit',
    args: [...options.spawnArgs, ...flags.rest],
    cwd: repositoryRoot,
    // Every command gets a real stdin: a prompting command otherwise reads from a stream that was
    // never opened, and `HCI.isInteractive` needs a real stdin to have any chance of seeing one.
    // `inherit` stdio already inherits it; this covers `pipe` and `stream`, whose stdout stays
    // captured either way.
    inheritStdin: true,
    onOutput: (_stream, chunk) => appendOutput(chunk),
    stdio: runStdio.stdio,
  })
  if (runStdio.note !== undefined) {
    appendOutput(Buffer.from(runStdio.note, 'utf8'))
  }

  const closeResult = await child.waitForClose()
  for (const unsubscribe of unsubscribes) {
    unsubscribe()
  }

  if (child.error !== undefined) {
    appendOutput(Buffer.from(formatSpawnError(options.spawnCommand, child.error), 'utf8'))
  }
  if (cancelledBy !== undefined) {
    appendOutput(Buffer.from(`cancelled by ${cancelledBy}\n`, 'utf8'))
  }

  const output = chunks.join('')
  const durationMs = now() - startedAt
  const exitCode = cancelledBy === undefined
    ? exitStatusFor({ error: child.error, exitCode: closeResult.exitCode, signal: closeResult.signal })
    : 128 + (SIGNAL_NUMBERS[cancelledBy] ?? 0)

  const logUnavailable = await log.close()

  const summary = await readSummaryFailures({ output, repositoryRoot })
  const summaryFailures = summary?.failures
  // An empty `failures: []` from a lane that nonetheless failed is not a real answer — it means the
  // lane's own classifier named nothing, not that nothing broke — so the fallback parser still runs.
  const failures = exitCode !== 0 && (summaryFailures?.length ?? 0) === 0
    ? parseFailuresFromOutput(output, options.command)
    : summaryFailures ?? []

  const outcome = {
    args: flags.rest,
    command: options.command,
    durationMs,
    exitCode,
    failures,
    logPath,
    ...(logUnavailable === undefined ? {} : { logUnavailable }),
    output,
    warnings: [...new Set([...initialWarnings, ...(summary?.warnings ?? [])])],
  }

  // `stream` and `inherit` already showed the child's output, so neither reprints it in the report.
  printOutcome(outcome, { json: flags.json, maxLines: flags.maxLines, verbose: runStdio.stdio !== 'pipe' })

  return exitCode
}

function printOutcome(outcome: AgentRunOutcome, options: BuildReportOptions & { json: boolean }): void {
  if (options.json) {
    HCI.writeLine(JSON.stringify(buildJsonReport(outcome, options)))
  } else {
    HCI.writeLine('')
    HCI.writeLine(buildReportText(outcome, options))
  }
}

/** RunStdioDecision is how one run's child stdio is wired, and the note (if any) explaining to the
 * log and report why its output looks the way it does. */
type RunStdioDecision = {
  note?: string
  stdio: CLI.CommandStdio
}

/**
 * resolveRunStdio decides how a child's stdio is wired. `--verbose` streams the captured output live
 * over a pipe. A prompting command running at a real interactive terminal instead inherits every
 * descriptor outright — the only way its own `HCI.isInteractive()` reads true, since that check
 * reads stdin AND stdout and a piped stdout is never a TTY even when this process relays every byte
 * it receives — so its prompt is both visible and answerable, at the cost of this run's own output
 * capture, which the note below explains. An agent harness has no TTY of its own, so this condition
 * never holds there and a prompting command never blocks on an unanswerable prompt.
 */
export function resolveRunStdio(
  command: string,
  flags: { verbose: boolean; json?: boolean },
  isInteractive: () => boolean,
): RunStdioDecision {
  if (!flags.json && PROMPTING_COMMANDS.has(command) && isInteractive()) {
    return {
      note: 'ran at an interactive terminal; its output went straight there and was not captured for this log\n',
      stdio: 'inherit',
    }
  }
  return { stdio: !flags.json && flags.verbose ? 'stream' : 'pipe' }
}

/** formatSpawnError turns a child-process spawn failure into a line the report and log both show —
 * `result.error.message` previously vanished, leaving `failed (exit 1) in 0ms` with no reason. ENOENT
 * means the command itself was not found, almost always because the devenv profile that puts `just`
 * on PATH is not active in this shell. */
function formatSpawnError(command: string, error: Error): string {
  const code = (error as NodeJS.ErrnoException).code
  const hint = code === 'ENOENT'
    ? ` '${command}' was not found on PATH — the devenv profile may not be active; run `
      + `'./enter-tao-dev-env'.`
    : ''
  return `spawn error: ${error.message}${hint}\n`
}

/** RunLog is this run's own log plus the refreshed `latest.log`, written to as output arrives. */
type RunLog = {
  /** Queues a chunk to both files, in arrival order; never throws. */
  append: (chunk: Buffer) => void
  /** Flushes every queued append and closes both handles, returning why the log could not be
   * trusted, if anything went wrong at any point — never throws. */
  close: () => Promise<string | undefined>
}

/**
 * openRunLog opens both this run's own log and the refreshed `latest.log` before the child spawns,
 * so a run the harness kills mid-flight still leaves a non-empty log at the path already advertised,
 * rather than an empty directory and a path that was never written. A log I/O failure — a denied
 * `mkdir`, an EACCES write — is caught here rather than thrown through the whole command, which
 * would otherwise discard the child's real verdict along with it.
 */
function openRunLog(logPath: string, latestPath: string): RunLog {
  let failure: string | undefined
  const noteFailure = (error: unknown) => {
    failure ??= Errors.messageOf(error)
  }

  const ready = (async (): Promise<{ latest: FS.FileHandle; log: FS.FileHandle } | undefined> => {
    let latestHandle: FS.FileHandle | undefined
    try {
      // `latest.log` is reused across runs; truncate it before appending, since `openAppend` alone
      // would tack this run's output onto whatever the previous run left behind.
      await FS.writeText(latestPath, '')
      latestHandle = await FS.openAppend(latestPath)
      return { latest: latestHandle, log: await FS.openAppend(logPath) }
    } catch (error) {
      // A failure opening `logPath` after `latestPath` already opened must not leak that handle.
      await latestHandle?.close().catch(() => {})
      noteFailure(error)
      return undefined
    }
  })()

  let chain: Promise<void> = ready.then(() => undefined)

  return {
    append: chunk => {
      chain = chain.then(async () => {
        const handles = await ready
        if (handles === undefined) {
          return
        }
        try {
          await handles.log.write(chunk)
          await handles.latest.write(chunk)
        } catch (error) {
          noteFailure(error)
        }
      })
    },
    close: async () => {
      await chain
      const handles = await ready
      if (handles !== undefined) {
        await handles.log.close().catch(noteFailure)
        await handles.latest.close().catch(noteFailure)
      }
      return failure
    },
  }
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
