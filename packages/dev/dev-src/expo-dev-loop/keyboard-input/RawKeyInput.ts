import { Platform } from '@shared'

/** RawKeyInput manages raw terminal key input for the dev loop. */
export class RawKeyInput {
  private handler?: (chunk: Buffer) => void
  private active = false

  constructor(private readonly onKey: (key: string) => void) {}

  /** start enables raw stdin key handling. */
  start(): boolean {
    this.active = Platform.setStdinRawMode(true)
    if (!this.active) {
      return false
    }
    this.attach()
    Platform.runtimeProcess.stdin.resume()
    return this.active
  }

  /** stop disables raw stdin key handling and releases stdin so the process can exit. */
  stop(): void {
    this.detach()
    if (this.active) {
      Platform.setStdinRawMode(false)
      this.active = false
    }
    // A resumed stdin keeps the event loop alive, so the CLI would hang after the loop returns —
    // in cooked mode by then, which is what echoes the keys typed after `q`.
    Platform.runtimeProcess.stdin.pause()
  }

  private attach(): void {
    if (this.handler) {
      return
    }
    this.handler = chunk => {
      for (const key of chunk.toString('utf8')) {
        this.onKey(key)
      }
    }
    Platform.runtimeProcess.stdin.on('data', this.handler)
  }

  private detach(): void {
    if (!this.handler) {
      return
    }
    Platform.runtimeProcess.stdin.off('data', this.handler)
    this.handler = undefined
  }
}
