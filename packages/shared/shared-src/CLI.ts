import { CommandExecutionError } from './core/Errors'
import type { FileHandle } from './FS'
import * as HCI from './HCI'
import * as Platform from './Platform'

/** CommandOutputStream names a command output stream. */
export type CommandOutputStream = 'stderr' | 'stdout'

/** PrefixedOutputOptions configures line-prefixed command output. */
export type PrefixedOutputOptions = {
  logFile?: FileHandle
  processName: string
}

/** CommandOutputBuffer buffers command output chunks until whole prefixed lines can be written. */
export type CommandOutputBuffer = {
  close: () => Promise<void>
  write: (stream: CommandOutputStream, chunk: Buffer) => void
}

/** CommandStdio configures child process stdio handling. */
export type CommandStdio = 'inherit' | 'pipe' | 'stream' | Platform.SpawnOptions['stdio']

/** CommandSpec describes process invocation options for shared CLI helpers. */
export type CommandSpec = {
  args?: readonly string[]
  cwd?: string
  detached?: boolean
  env?: Platform.ProcessEnv
  onOutput?: (stream: CommandOutputStream, chunk: Buffer) => void
  prefixedOutput?: PrefixedOutputOptions
  stdin?: string | Uint8Array
  stdio?: CommandStdio
  unref?: boolean
}

/** CommandSyncSpec describes a synchronous process invocation. */
export type CommandSyncSpec = Omit<CommandSpec, 'detached' | 'prefixedOutput' | 'unref'>

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

/** CommandCloseResult records process close status. */
export type CommandCloseResult = {
  exitCode: number | null
  signal: Platform.ProcessSignal | null
}

/** CommandCloseListener handles process close status. */
export type CommandCloseListener = (exitCode: number | null, signal: Platform.ProcessSignal | null) => void

/** StartedCommand exposes a started child process through the shared CLI wrapper. */
export type StartedCommand = {
  readonly args: string[]
  readonly command: string
  readonly cwd?: string
  readonly error?: Error
  readonly exitCode: number | null
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
  const child = Platform.spawn(command, {
    args,
    cwd: spec.cwd,
    detached: spec.detached,
    env: spec.env,
    stdio: stdio.stdio,
  })

  if (spec.unref) {
    child.unref()
  }

  child.stdout?.on('data', chunk => {
    const buffer = Buffer.from(chunk)
    if (options.captureOutput) {
      stdoutChunks.push(buffer)
    }
    spec.onOutput?.('stdout', buffer)
    if (stdio.streamOutput) {
      HCI.write(buffer)
    } else if (prefixedOutput) {
      prefixedOutput.write('stdout', buffer)
    }
  })
  child.stderr?.on('data', chunk => {
    const buffer = Buffer.from(chunk)
    if (options.captureOutput) {
      stderrChunks.push(buffer)
    }
    spec.onOutput?.('stderr', buffer)
    if (stdio.streamOutput) {
      HCI.writeError(buffer)
    } else if (prefixedOutput) {
      prefixedOutput.write('stderr', buffer)
    }
  })

  if (spec.stdin !== undefined) {
    child.stdin?.end(spec.stdin)
  }

  let spawnError: Error | undefined
  const closePromise = new Promise<CommandCloseResult>(resolve => {
    child.once('close', (exitCode, signal) => {
      resolve({ exitCode, signal })
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
    get signalCode() {
      return child.signalCode
    },
    kill: signal => child.kill(signal),
    onceClose: listener => {
      child.once('close', listener)
    },
    onceError: listener => {
      child.once('error', listener)
    },
    waitForClose: () => closePromise,
    writeStdin: chunk => child.stdin?.write(chunk) ?? false,
  }
}

/** runSync runs a command synchronously and returns its captured completion result. */
export function runSync(command: string, spec: CommandSyncSpec = {}): CommandResult {
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
    HCI.writeError(stderr)
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

function isCommandStdioMode(stdio: CommandStdio | undefined): stdio is 'inherit' | 'pipe' | 'stream' {
  return stdio === 'inherit' || stdio === 'pipe' || stdio === 'stream'
}

function resolveCommandStdio(
  spec: Pick<CommandSpec, 'stdin' | 'stdio'>,
  options: { captureOutput: boolean; prefixedOutput: boolean },
): ResolvedCommandStdio {
  const stdioMode = isCommandStdioMode(spec.stdio) ? spec.stdio : undefined
  const customStdio = stdioMode ? undefined : spec.stdio as Platform.SpawnOptions['stdio'] | undefined
  const inheritStdin = stdioMode === 'inherit' && spec.stdin === undefined
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
export function createPrefixedOutputBuffer(options: PrefixedOutputOptions): CommandOutputBuffer {
  const pending: Record<CommandOutputStream, string> = { stderr: '', stdout: '' }
  let logFileWrites = Promise.resolve()
  let closePromise: Promise<void> | undefined

  const writeLine = (stream: CommandOutputStream, line: string) => {
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

/** formatCommand formats a command for logs and error messages. */
export function formatCommand(command: string, spec: Pick<CommandSpec, 'args'> = {}): string {
  return [command, ...(spec.args ?? [])].map(formatCommandPart).join(' ')
}

function bufferToString(value: Buffer | string | null | undefined): string {
  return Buffer.isBuffer(value) ? value.toString('utf8') : value ?? ''
}

function formatCommandPart(value: string): string {
  return /^[\w./:=@+-]+$/.test(value) ? value : JSON.stringify(value)
}
