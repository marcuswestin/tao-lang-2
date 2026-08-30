import { CLI, FS, Repo, Time } from '@shared'
import { OutputText } from '../../cli/OutputText'
import { DevLoopTUI } from '../DevLoopTUI'
import { ExpoConfig } from './expo-config'

const EXPO_FAILURE_OUTPUT_CHARACTER_LIMIT = 32_000
const EXPO_FAILURE_OUTPUT_LINE_LIMIT = 40

/** ExpoServer owns the Expo CLI process and its log output. */
export class ExpoServer {
  private child?: CLI.StartedCommand
  private closeOutputAndLogPromise?: Promise<void>
  private logFile?: FS.FileHandle
  private recentOutputChunks: string[] = []
  private recentOutputLength = 0
  private unexpectedExit?: (message: string) => void
  private stopping = false

  constructor(private readonly runtimeRoot: string) {}

  onUnexpectedExit(listener: (message: string) => void): void {
    this.unexpectedExit = listener
  }

  async start(): Promise<void> {
    const logPath = Repo.resolvePath('.artifacts/dev/expo.log')
    await FS.mkdir(FS.dirname(logPath))
    this.logFile = await FS.openAppend(logPath)
    this.child = CLI.start('bunx', {
      args: ExpoConfig.EXPO_START_ARGS,
      cwd: this.runtimeRoot,
      env: ExpoConfig.EXPO_START_ENV,
      onOutput: (stream, chunk) => {
        this.appendRecentOutput(String(chunk))
        DevLoopTUI.writeDevLoopOutput('expo', stream, chunk)
        void this.logFile?.write(chunk)
      },
    })
    this.child.onceClose((exitCode, signal) => {
      void this.closeOutputAndLog()
      if (!this.stopping) {
        const summary = `Expo exited with code=${exitCode} signal=${signal}. See ${logPath}.`
        DevLoopTUI.logDevLoop('dev', summary, 'warn')
        this.unexpectedExit?.(formatExpoExitFailure(this.recentOutput(), summary))
      }
    })
    this.child.onceError(error => {
      const message = `Failed to start Expo: ${error.message}`
      this.appendRecentOutput(`\n${message}`)
      DevLoopTUI.logDevLoop('dev', message, 'error')
    })
    DevLoopTUI.logDevLoop('dev', `Expo log: ${logPath}`)
  }

  async stop(): Promise<void> {
    const child = this.child
    if (!child) {
      await this.closeLogFile()
      return
    }
    this.stopping = true
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      await Promise.race([child.waitForClose(), Time.sleep(ExpoConfig.EXPO_STOP_TIMEOUT_MS)])
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
        await child.waitForClose()
      }
    }
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
  const outputLines = OutputText.stripAnsi(output)
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => line.length > 0)
    .slice(-EXPO_FAILURE_OUTPUT_LINE_LIMIT)
  return outputLines.length === 0 ? summary : `${outputLines.join('\n')}\n${summary}`
}
