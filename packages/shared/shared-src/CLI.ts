import { CommandExecutionError, throwUnexpected } from './core/Errors'
import type { FileHandle } from './FS'
import * as HCI from './HCI'
import * as Platform from './Platform'
import { ProcessTree, type TrackedProcess } from './ProcessTree'

/** CommandOutputStream names a command output stream. */
export type CommandOutputStream = 'stderr' | 'stdout'

/** PrefixedOutputOptions configures line-prefixed command output. */
type PrefixedOutputOptions = {
  logFile?: FileHandle
  processName: string
  terminal?: boolean
}

/** CommandOutputBuffer buffers command output chunks until whole prefixed lines can be written. */
type CommandOutputBuffer = {
  close: () => Promise<void>
  write: (stream: CommandOutputStream, chunk: Buffer) => void
}

/** CommandStdio configures child process stdio handling. */
export type CommandStdio = 'inherit' | 'pipe' | 'stream' | Platform.SpawnOptions['stdio']

/**
 * CommandProcessPolicy declares how a child is supervised.
 *
 * - `tool` is the default: a short-lived command. `kill` stops every descendant the wrapper tracked,
 *   not just the direct child, so nothing the child started can outlive the signal.
 * - `test` adds the parent-enforced `timeoutMs` and `idleOutputMs` bounds. A synchronous runaway
 *   inside a test runner never reaches the runner's own timeout (bun issue #21277), so the only
 *   bound that holds is one this process applies from outside.
 * - `server` opts out of every bound and signals the direct child only. Metro, Studio, a simulator
 *   and the dev servers idle legitimately and must never be stopped by test-shaped rules.
 *
 * No policy changes process-group membership. Detaching a child is the caller's own decision through
 * `detached`, because a child that stays in the caller's process group is a child the terminal's
 * Ctrl-C still reaches — and silently losing that is the failure the supervision exists to prevent.
 * Teardown does not need detachment: the tracked-descendant signalling reaches a grandchild whether
 * or not the child leads a group.
 */
type CommandProcessPolicy = 'server' | 'test' | 'tool'

/** CommandSpec describes process invocation options for shared CLI helpers. */
export type CommandSpec = {
  args?: readonly string[]
  cwd?: string
  detached?: boolean
  env?: Platform.ProcessEnv
  /** `test` policy only: stop the tree once the child has printed nothing for this long. */
  idleOutputMs?: number
  /**
   * Inherits the caller's stdin (fd 0) under `pipe` or `stream` stdio, instead of leaving it closed.
   * `inherit` stdio already inherits stdin on its own; this is for a child whose own prompts need a
   * real stream to read from while its stdout still goes through the ordinary capture. Inheriting
   * stdin alone does not make the child interactive — `HCI.isInteractive` reads stdin AND stdout, so
   * a child whose stdout is piped still sees no TTY; pair this with `inherit` stdio for a prompt that
   * must both show and read.
   */
  inheritStdin?: boolean
  onOutput?: (stream: CommandOutputStream, chunk: Buffer) => void
  prefixedOutput?: PrefixedOutputOptions
  /** How this child is supervised. `tool` is the default; `server` opts out of every bound. */
  processPolicy?: CommandProcessPolicy
  stdin?: string | Uint8Array
  stdio?: CommandStdio
  /** `test` policy only: stop the tree once the child has been running this long. */
  timeoutMs?: number
  unref?: boolean
}

/** CommandSyncSpec describes a synchronous process invocation. */
export type CommandSyncSpec = Omit<
  CommandSpec,
  'detached' | 'idleOutputMs' | 'prefixedOutput' | 'processPolicy' | 'timeoutMs' | 'unref'
>

/** CommandResult records a completed process invocation. */
export type CommandResult = {
  command: string
  args: string[]
  cwd?: string
  exitCode: number | null
  signal: Platform.ProcessSignal | null
  stdout: string
  stderr: string
  error?: Error
}

/** SandboxDenialOutcome is the slice of a command result `isSandboxDenial` reads. `error` is kept
 * as broad as `unknown` because a caller's own probe result may carry a caught exception rather
 * than the narrower `Error` a supervised `CLI` command reports. */
type SandboxDenialOutcome = Pick<CommandResult, 'stderr' | 'stdout'> & { error?: unknown }

const SANDBOX_DENIAL = /\b(operation not permitted|permission denied|eperm|eacces|sandbox)\b/i

/** isSandboxDenial recognizes the policy-denial evidence shared by capability and command diagnostics. */
export function isSandboxDenial(result: SandboxDenialOutcome): boolean {
  const output = `${result.stderr}\n${result.stdout}`.trim()
  const fallback = result.error instanceof Error ? result.error.message : ''
  return SANDBOX_DENIAL.test(output || fallback)
}

/**
 * Only a variable a harness sets *because* the command is sandboxed belongs here: Claude Code's
 * sandboxed shell sets `SANDBOX_RUNTIME` and Codex's sets `CODEX_SANDBOX`. Claude Code also sets
 * `CLAUDE_CODE_TMPDIR` in every session, sandboxed or not, so keying on it reported every agent as
 * sandboxed.
 */
const SANDBOX_SIGNALS: readonly string[] = ['SANDBOX_RUNTIME', 'CODEX_SANDBOX']

/** inAgentSandbox reports whether this process runs under an agent harness's sandbox policy. */
export function inAgentSandbox(
  env: Readonly<Record<string, string | undefined>> = Platform.runtimeProcess.env,
): boolean {
  return SANDBOX_SIGNALS.some(name => (env[name] ?? '') !== '')
}

/** CommandCloseResult records process close status. */
export type CommandCloseResult = {
  exitCode: number | null
  signal: Platform.ProcessSignal | null
}

/** CommandCloseListener handles process close status. */
type CommandCloseListener = (exitCode: number | null, signal: Platform.ProcessSignal | null) => void

/** StartedCommand exposes a started child process through the shared CLI wrapper. */
export type StartedCommand = {
  readonly args: string[]
  readonly command: string
  readonly cwd?: string
  readonly error?: Error
  readonly exitCode: number | null
  /**
   * The child's PID, for a caller that must reach its process tree through `ProcessTree`. Optional
   * so the test doubles that stand in for a started command keep satisfying this type.
   */
  readonly pid?: number
  readonly signalCode: Platform.ProcessSignal | null
  closeOutput: () => Promise<void>
  dispose: () => void
  endStdin: () => void
  kill: (signal?: Platform.ProcessSignal) => boolean
  onceClose: (listener: CommandCloseListener) => void
  onceError: (listener: (error: Error) => void) => void
  waitForClose: () => Promise<CommandCloseResult>
  writeStdin: (chunk: string | Uint8Array) => boolean
}

type StartedCommandInternal = StartedCommand & {
  stderrChunks: Buffer[]
  stdoutChunks: Buffer[]
}

type ResolvedCommandStdio = {
  stdio: Platform.SpawnOptions['stdio']
  streamOutput: boolean
}

/** run starts a command and returns its captured completion result. */
export async function run(command: string, spec: CommandSpec = {}): Promise<CommandResult> {
  const startedCommand = startCommand(command, spec, { captureOutput: true })
  const { exitCode, signal } = await startedCommand.waitForClose()
  await startedCommand.closeOutput()

  return {
    command: startedCommand.command,
    args: startedCommand.args,
    cwd: startedCommand.cwd,
    exitCode,
    signal,
    stdout: Buffer.concat(startedCommand.stdoutChunks).toString('utf8'),
    stderr: Buffer.concat(startedCommand.stderrChunks).toString('utf8'),
    error: startedCommand.error,
  }
}

/** start starts a command and returns a running command handle. */
export function start(command: string, spec: CommandSpec = {}): StartedCommand {
  return startCommand(command, spec, { captureOutput: false })
}

function startCommand(
  command: string,
  spec: CommandSpec,
  options: { captureOutput: boolean },
): StartedCommandInternal {
  const args = [...(spec.args ?? [])]
  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []
  const prefixedOutput = spec.prefixedOutput ? createPrefixedOutputBuffer(spec.prefixedOutput) : undefined
  const stdio = resolveCommandStdio(spec, {
    captureOutput: options.captureOutput,
    prefixedOutput: prefixedOutput !== undefined,
  })
  const policy = spec.processPolicy ?? 'tool'
  const bounds = resolveProcessBounds(command, policy, spec)
  const child = Platform.spawn(command, {
    args,
    cwd: spec.cwd,
    // Detachment is the caller's call, never the policy's: a child in the caller's process group is
    // one the terminal's Ctrl-C reaches, and the teardown below does not need a group leader.
    detached: spec.detached,
    env: spec.env,
    stdio: stdio.stdio,
  })

  if (spec.unref) {
    child.unref()
  }

  let closed = false
  let boundFailure: string | undefined
  let escalation: ReturnType<typeof setTimeout> | undefined
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let wallClockTimer: ReturnType<typeof setTimeout> | undefined
  let trackedDescendants: TrackedProcess[] | undefined

  /**
   * A child whose output is inherited writes straight to the terminal, so nothing in this wrapper
   * sees it — and a bound's reason line would have had nowhere to go. It goes to `HCI` instead,
   * beside the output it explains, rather than being silently dropped.
   */
  const outputHasWrapperSink = options.captureOutput
    || spec.onOutput !== undefined
    || stdio.streamOutput
    || prefixedOutput !== undefined

  const deliverOutput = (stream: CommandOutputStream, buffer: Buffer) => {
    if (options.captureOutput) {
      ;(stream === 'stdout' ? stdoutChunks : stderrChunks).push(buffer)
    }
    spec.onOutput?.(stream, buffer)
    if (stdio.streamOutput) {
      if (stream === 'stdout') {
        HCI.write(buffer)
      } else {
        // stderr names the file descriptor, not the severity. Git and many other tools write
        // ordinary progress there, so preserve the child's own presentation and let the caller's
        // final verdict carry success or error color.
        HCI.writeStderr(buffer)
      }
    } else if (prefixedOutput) {
      prefixedOutput.write(stream, buffer)
    }
  }

  /**
   * stopProcessTree is the whole point of a supervised policy: the tracked descendants are signalled
   * deepest-first by start identity, then the child, and SIGTERM escalates to SIGKILL. A child
   * stopped for hanging may ignore SIGTERM and would otherwise hold the lane open forever.
   *
   * The `signalGroup` call beside them is belt and braces for a caller that did pass `detached`: it
   * catches a descendant that re-parented away and so left the tracked snapshot, and it fails
   * harmlessly when the pid leads no group, which is the ordinary case.
   */
  const stopProcessTree = (signal: Platform.ProcessSignal): boolean => {
    const pid = child.pid
    if (policy === 'server' || pid === undefined || closed) {
      return child.kill(signal)
    }
    // Snapshot once: after the first signal the tree is already coming apart, and a second walk
    // would miss exactly the descendants that have not died yet.
    trackedDescendants ??= ProcessTree.descendants(pid)
    const descendants = trackedDescendants
    ProcessTree.signalTracked(descendants, signal)
    const groupSignalled = ProcessTree.signalGroup(pid, signal)
    const directSignalled = child.kill(signal)
    if (signal !== 'SIGKILL' && escalation === undefined) {
      escalation = setTimeout(() => {
        ProcessTree.signalTracked(descendants, 'SIGKILL')
        ProcessTree.signalGroup(pid, 'SIGKILL')
        child.kill('SIGKILL')
      }, ProcessTree.FORCE_KILL_GRACE_MS)
    }
    return directSignalled || groupSignalled
  }

  const clearBounds = () => {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer)
      idleTimer = undefined
    }
    if (wallClockTimer !== undefined) {
      clearTimeout(wallClockTimer)
      wallClockTimer = undefined
    }
  }

  const exceedBound = (reason: string) => {
    if (closed || boundFailure !== undefined) {
      return
    }
    boundFailure = reason
    clearBounds()
    const line = Buffer.from(`${reason}\n`, 'utf8')
    if (outputHasWrapperSink) {
      deliverOutput('stderr', line)
    } else {
      HCI.writeError(line)
    }
    stopProcessTree('SIGTERM')
  }

  const restartIdleBound = () => {
    const idleOutputMs = bounds.idleOutputMs
    if (idleOutputMs === undefined || closed || boundFailure !== undefined) {
      return
    }
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer)
    }
    idleTimer = setTimeout(
      () => exceedBound(`timed out with no output for ${formatBoundDuration(idleOutputMs)}`),
      idleOutputMs,
    )
  }

  const attachOutputHandler = (readable: typeof child.stdout, stream: CommandOutputStream) => {
    readable?.on('data', chunk => {
      deliverOutput(stream, Buffer.from(chunk))
      restartIdleBound()
    })
  }
  attachOutputHandler(child.stdout, 'stdout')
  attachOutputHandler(child.stderr, 'stderr')

  const timeoutMs = bounds.timeoutMs
  if (timeoutMs !== undefined) {
    wallClockTimer = setTimeout(() => exceedBound(`timed out after ${formatBoundDuration(timeoutMs)}`), timeoutMs)
  }
  restartIdleBound()

  if (spec.stdin !== undefined) {
    child.stdin?.end(spec.stdin)
  }

  /** closeResultFor reports the bound that stopped the tree, so a caller never reads a clean exit. */
  const closeResultFor = (
    exitCode: number | null,
    signal: Platform.ProcessSignal | null,
  ): CommandCloseResult => ({
    exitCode,
    signal: boundFailure === undefined ? signal : signal ?? 'SIGTERM',
  })

  let spawnError: Error | undefined
  const closePromise = new Promise<CommandCloseResult>(resolve => {
    child.once('close', (exitCode, signal) => {
      closed = true
      clearBounds()
      if (escalation !== undefined) {
        clearTimeout(escalation)
        escalation = undefined
      }
      resolve(closeResultFor(exitCode, signal))
    })
  })

  child.on('error', error => {
    spawnError = error
  })

  return {
    args,
    command,
    cwd: spec.cwd,
    dispose: () => {
      child.stdin?.destroy()
      child.stdout?.destroy()
      child.stderr?.destroy()
      child.removeAllListeners()
    },
    endStdin: () => {
      child.stdin?.end()
    },
    stderrChunks,
    stdoutChunks,
    closeOutput: () => prefixedOutput?.close() ?? Promise.resolve(),
    get error() {
      return spawnError
    },
    get exitCode() {
      return child.exitCode
    },
    get pid() {
      return child.pid
    },
    get signalCode() {
      return child.signalCode
    },
    kill: signal => stopProcessTree(signal ?? 'SIGTERM'),
    onceClose: listener => {
      child.once('close', (exitCode, signal) => {
        const result = closeResultFor(exitCode, signal)
        listener(result.exitCode, result.signal)
      })
    },
    onceError: listener => {
      child.once('error', listener)
    },
    waitForClose: () => closePromise,
    writeStdin: chunk => child.stdin?.write(chunk) ?? false,
  }
}

/** runSync runs a command synchronously; `mustRunSync` is the checked entry point callers reach for. */
function runSync(command: string, spec: CommandSyncSpec = {}): CommandResult {
  const args = [...(spec.args ?? [])]
  const stdio = resolveCommandStdio(spec, {
    captureOutput: true,
    prefixedOutput: false,
  })
  const result = Platform.spawnSync(command, {
    args,
    cwd: spec.cwd,
    env: spec.env,
    input: spec.stdin,
    stdio: stdio.stdio,
  })
  const stdout = bufferToString(result.stdout)
  const stderr = bufferToString(result.stderr)

  if (stdio.streamOutput) {
    HCI.write(stdout)
    HCI.writeStderr(stderr)
  }

  return {
    command,
    args,
    cwd: spec.cwd,
    exitCode: result.status,
    signal: result.signal as Platform.ProcessSignal | null,
    stdout,
    stderr,
    error: result.error,
  }
}

/** ProcessBounds is the parent-enforced budget a `test` policy child runs under. */
type ProcessBounds = {
  idleOutputMs?: number
  timeoutMs?: number
}

/**
 * resolveProcessBounds refuses a bound the policy does not enforce rather than dropping it: a spec
 * that asks for a timeout and silently gets none is how an unbounded child reached 12 GB.
 */
function resolveProcessBounds(command: string, policy: CommandProcessPolicy, spec: CommandSpec): ProcessBounds {
  const declared = (['idleOutputMs', 'timeoutMs'] as const).filter(key => spec[key] !== undefined)
  if (declared.length === 0) {
    return {}
  }
  if (policy !== 'test') {
    throwUnexpected(
      `Expected: ${declared.join(' and ')} only on a 'test' process policy, but '${command}' declared`
        + ` ${declared.join(' and ')} with the '${policy}' policy.`,
    )
  }
  for (const key of declared) {
    const value = spec[key]
    if (value === undefined || !Number.isFinite(value) || value <= 0) {
      throwUnexpected(`Expected: a positive ${key} for '${command}', but it was ${String(value)}.`)
    }
  }
  return { idleOutputMs: spec.idleOutputMs, timeoutMs: spec.timeoutMs }
}

/** formatBoundDuration spells a bound the way its reason line reads, seconds first. */
function formatBoundDuration(ms: number): string {
  return ms % 1_000 === 0 ? `${ms / 1_000}s` : `${ms}ms`
}

function isCommandStdioMode(stdio: CommandStdio | undefined): stdio is 'inherit' | 'pipe' | 'stream' {
  return stdio === 'inherit' || stdio === 'pipe' || stdio === 'stream'
}

function resolveCommandStdio(
  spec: Pick<CommandSpec, 'inheritStdin' | 'stdin' | 'stdio'>,
  options: { captureOutput: boolean; prefixedOutput: boolean },
): ResolvedCommandStdio {
  const stdioMode = isCommandStdioMode(spec.stdio) ? spec.stdio : undefined
  const customStdio = stdioMode ? undefined : spec.stdio as Platform.SpawnOptions['stdio'] | undefined
  const inheritStdin = spec.stdin === undefined && (stdioMode === 'inherit' || spec.inheritStdin === true)
  const inheritOutput = stdioMode === 'inherit' && !options.prefixedOutput
  const streamOutput = stdioMode === 'stream' && !options.prefixedOutput
  const pipeOutput = options.captureOutput || streamOutput || options.prefixedOutput || stdioMode === 'pipe'

  return {
    stdio: customStdio ?? (stdioMode || pipeOutput
      ? [
        inheritStdin ? 'inherit' : spec.stdin === undefined ? 'ignore' : 'pipe',
        inheritOutput ? 'inherit' : pipeOutput ? 'pipe' : 'ignore',
        inheritOutput ? 'inherit' : pipeOutput ? 'pipe' : 'ignore',
      ]
      : undefined),
    streamOutput,
  }
}

/** createPrefixedOutputBuffer returns a buffered writer for line-prefixed process output. */
function createPrefixedOutputBuffer(options: PrefixedOutputOptions): CommandOutputBuffer {
  const pending: Record<CommandOutputStream, string> = { stderr: '', stdout: '' }
  let logFileWrites = Promise.resolve()
  let closePromise: Promise<void> | undefined

  const writeLine = (stream: CommandOutputStream, line: string) => {
    if (options.terminal === false) {
      return
    }
    if (stream === 'stderr') {
      HCI.logProcessOutput(options.processName, line, { stderr: true })
    } else {
      HCI.logProcessOutput(options.processName, line)
    }
  }

  const closeOnce = async () => {
    for (const stream of ['stdout', 'stderr'] as const) {
      const pendingLine = pending[stream]
      if (pendingLine.length > 0) {
        pending[stream] = ''
        writeLine(stream, pendingLine)
      }
    }
    await logFileWrites
  }

  return {
    close() {
      closePromise ??= closeOnce()
      return closePromise
    },
    write(stream, chunk) {
      if (options.logFile) {
        logFileWrites = logFileWrites
          .then(() => options.logFile?.write(chunk))
          .then(() => undefined, () => undefined)
      }

      const text = `${pending[stream]}${chunk.toString('utf8')}`.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
      const lines = text.split('\n')
      pending[stream] = lines.pop() ?? ''
      for (const line of lines) {
        writeLine(stream, line)
      }
    },
  }
}

/** commandPath resolves an executable on PATH, or `undefined` when nothing answers to the name. */
export async function commandPath(command: string): Promise<string | undefined> {
  let result = await run('which', { args: [command], stdio: 'pipe' })
  if (result.error !== undefined) {
    // A host without `which` still has the shell builtin.
    result = await run('sh', { args: ['-c', 'command -v "$1"', 'sh', command], stdio: 'pipe' })
  }
  const path = result.stdout.trim()
  return result.error === undefined && result.exitCode === 0 && path !== '' ? path : undefined
}

/** commandExists reports whether an executable answers to `command` on PATH. */
export async function commandExists(command: string): Promise<boolean> {
  return await commandPath(command) !== undefined
}

/** mustRun runs a command and throws when it does not exit successfully. */
export async function mustRun(command: string, spec: CommandSpec = {}): Promise<CommandResult> {
  const result = await run(command, spec)

  if (result.error || result.exitCode !== 0) {
    throw new CommandExecutionError(result)
  }
  return result
}

/** mustRunSync runs a command synchronously and throws when it does not exit successfully. */
export function mustRunSync(command: string, spec: CommandSyncSpec = {}): CommandResult {
  const result = runSync(command, spec)

  if (result.error || result.exitCode !== 0) {
    throw new CommandExecutionError(result)
  }
  return result
}

function bufferToString(value: Buffer | string | null | undefined): string {
  return Buffer.isBuffer(value) ? value.toString('utf8') : value ?? ''
}
