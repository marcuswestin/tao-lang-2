import { CLI, FS, Repo, Time } from '@shared'
import { DevLoopTUI } from '../DevLoopTUI'
import { ExpoConfig } from './expo-config'

/** ExpoServer owns the Expo CLI process and its log output. */
export class ExpoServer {
  private child?: CLI.StartedCommand
  private closeOutputAndLogPromise?: Promise<void>
  private logFile?: FS.FileHandle
  private unexpectedExit?: () => void
  private stopping = false

  constructor(private readonly runtimeRoot: string) {}

  onUnexpectedExit(listener: () => void): void {
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
        DevLoopTUI.writeDevLoopOutput('expo', stream, chunk)
        void this.logFile?.write(chunk)
      },
    })
    this.child.onceClose((exitCode, signal) => {
      void this.closeOutputAndLog()
      if (!this.stopping) {
        DevLoopTUI.logDevLoop('dev', `Expo exited with code=${exitCode} signal=${signal}. See ${logPath}.`, 'warn')
        this.unexpectedExit?.()
      }
    })
    this.child.onceError(error => {
      DevLoopTUI.logDevLoop('dev', `Failed to start Expo: ${error.message}`, 'error')
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
}
