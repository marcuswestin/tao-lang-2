import { FS, Repo, Text } from '@shared'
import { DevLoopOutput } from '../DevLoopOutput'
import {
  finalizeStudioProcessTree,
  startStudioProcessTree,
  stopStudioProcessTree,
  type StudioProcessTree,
  type WaitForStudioProcessTreeClose,
} from '../StudioProcessTree'
import type { ExpoSessionConfig } from './expo-config'
import type { ExpoServerOptions } from './ExpoRunner'

const EXPO_FAILURE_OUTPUT_CHARACTER_LIMIT = 32_000
const EXPO_FAILURE_OUTPUT_LINE_LIMIT = 40

/** ExpoServer owns the Expo CLI process and its log output. */
export class ExpoServer {
  private child?: StudioProcessTree
  private childClose?: WaitForStudioProcessTreeClose
  private closeOutputAndLogPromise?: Promise<void>
  private logFile?: FS.FileHandle
  private recentOutputChunks: string[] = []
  private recentOutputLength = 0
  private unexpectedExit?: (message: string) => void
  private stopping = false
  private startPromise?: Promise<void>
  private stopPromise?: Promise<void>

  constructor(
    private readonly runtimeRoot: string,
    private readonly config: ExpoSessionConfig,
    private readonly releasePortReservation: () => Promise<void>,
    private readonly options: ExpoServerOptions = {},
  ) {}

  onUnexpectedExit(listener: (message: string) => void): void {
    this.unexpectedExit = listener
  }

  start(): Promise<void> {
    if (this.stopping) {
      return Promise.resolve()
    }
    this.startPromise ??= this.startOnce()
    return this.startPromise
  }

  private async startOnce(): Promise<void> {
    await this.releasePortReservation()
    if (this.stopping) {
      return
    }
    const logPath = this.options.logRoot === undefined
      ? Repo.resolvePath(this.config.EXPO_LOG_PATH)
      : FS.resolvePath(FS.basename(this.config.EXPO_LOG_PATH), this.options.logRoot)
    await FS.mkdir(FS.dirname(logPath))
    if (this.stopping) {
      return
    }
    this.logFile = await FS.openAppend(logPath)
    if (this.stopping) {
      await this.closeLogFile()
      return
    }
    const launcher = this.options.command ?? { executable: 'bunx' }
    const startArgs = launcher.namesExpoScript === true && this.config.EXPO_START_ARGS[0] === 'expo'
      ? this.config.EXPO_START_ARGS.slice(1)
      : this.config.EXPO_START_ARGS
    this.child = await startStudioProcessTree(launcher.executable, {
      args: [...(launcher.argsPrefix ?? []), ...startArgs],
      cwd: this.runtimeRoot,
      env: {
        ...this.config.EXPO_START_ENV,
        ...this.options.env,
        TAO_RUNTIME_TOOLCHAIN_SOURCE_ROOT: this.options.runtimeToolchainSourceRoot
          ?? Repo.resolvePath(this.config.RUNTIME_TOOLCHAIN_PATH),
      },
      onOutput: (stream, chunk) => {
        this.appendRecentOutput(String(chunk))
        DevLoopOutput.writeDevLoopOutput('expo', stream, chunk)
        void this.logFile?.write(chunk)
      },
    })
    this.childClose = finalizeStudioProcessTree(this.child)
    this.child.onceClose((exitCode, signal) => {
      void this.closeOutputAndLog()
      if (!this.stopping) {
        const summary = `Expo exited with code=${exitCode} signal=${signal}. See ${logPath}.`
        DevLoopOutput.logDevLoop('dev', summary, 'warn')
        this.unexpectedExit?.(formatExpoExitFailure(this.recentOutput(), summary))
      }
    })
    this.child.onceError(error => {
      const message = `Failed to start Expo: ${error.message}`
      this.appendRecentOutput(`\n${message}`)
      DevLoopOutput.logDevLoop('dev', message, 'error')
    })
    DevLoopOutput.logDevLoop('dev', `Expo log: ${logPath}`)
  }

  stop(): Promise<void> {
    this.stopping = true
    this.stopPromise ??= this.stopOnce()
    return this.stopPromise
  }

  private async stopOnce(): Promise<void> {
    await this.startPromise?.catch(() => {})
    await this.releasePortReservation()
    const child = this.child
    if (!child) {
      await this.closeLogFile()
      return
    }
    this.stopping = true
    await stopStudioProcessTree(child, {
      timeoutMs: this.options.stopTimeoutMs ?? this.config.EXPO_STOP_TIMEOUT_MS,
      waitForClose: this.childClose,
    })
    await this.closeOutputAndLog()
  }

  private async closeOutputAndLog(): Promise<void> {
    this.closeOutputAndLogPromise ??= this.closeOutputAndLogOnce()
    return this.closeOutputAndLogPromise
  }

  private async closeOutputAndLogOnce(): Promise<void> {
    await this.child?.closeOutput()
    await this.closeLogFile()
  }

  private async closeLogFile(): Promise<void> {
    const logFile = this.logFile
    this.logFile = undefined
    await logFile?.close()
  }

  /** appendRecentOutput keeps a bounded failure tail without recopying the buffer per chunk. */
  private appendRecentOutput(chunk: string): void {
    this.recentOutputChunks.push(chunk)
    this.recentOutputLength += chunk.length
    while (
      this.recentOutputChunks.length > 1
      && this.recentOutputLength - this.recentOutputChunks[0]!.length >= EXPO_FAILURE_OUTPUT_CHARACTER_LIMIT
    ) {
      this.recentOutputLength -= this.recentOutputChunks.shift()!.length
    }
  }

  private recentOutput(): string {
    return this.recentOutputChunks.join('').slice(-EXPO_FAILURE_OUTPUT_CHARACTER_LIMIT)
  }
}

/** formatExpoExitFailure keeps the useful tail of Expo output when its dashboard disappears. */
export function formatExpoExitFailure(output: string, summary: string): string {
  const outputLines = Text.stripAnsi(output)
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => line.length > 0)
    .slice(-EXPO_FAILURE_OUTPUT_LINE_LIMIT)
  return outputLines.length === 0 ? summary : `${outputLines.join('\n')}\n${summary}`
}
