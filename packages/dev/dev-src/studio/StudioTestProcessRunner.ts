import { Text } from '@shared'
import { StudioTestOutput, type StudioTestRun, type StudioTestRunner, type StudioTestStatus } from '@studio'
import {
  finalizeStudioProcessTree,
  startStudioProcessTree,
  stopStudioProcessTree,
  type StudioProcessTree,
  type WaitForStudioProcessTreeClose,
} from './StudioProcessTree'

type StudioTestProcessRunnerOptions = {
  args: readonly string[]
  command: string
  cwd: string
  env?: Readonly<Record<string, string>>
  stopTimeoutMs?: number
}

const retainedOutputBytes = 1_000_000

/** Owns one serialized Tao test subprocess for a Studio project. */
export class StudioTestProcessRunner implements StudioTestRunner {
  readonly #options: StudioTestProcessRunnerOptions
  #active: StudioProcessTree | undefined
  #activeClose: WaitForStudioProcessTreeClose | undefined
  #closed = false
  #lastRun: StudioTestRun | undefined
  #running: Promise<StudioTestRun> | undefined

  constructor(options: StudioTestProcessRunnerOptions) {
    this.#options = options
  }

  status(): StudioTestStatus {
    return { available: true, lastRun: this.#lastRun, running: this.#running !== undefined }
  }

  run(): Promise<StudioTestRun> {
    if (this.#closed) {
      return Promise.reject(new Error('The Studio test runner is closed.'))
    }
    return this.#running ??= this.#run().finally(() => {
      this.#running = undefined
    })
  }

  async close(): Promise<void> {
    this.#closed = true
    const active = this.#active
    const activeClose = this.#activeClose
    if (active !== undefined && activeClose !== undefined) {
      await stopStudioProcessTree(active, {
        timeoutMs: this.#options.stopTimeoutMs,
        waitForClose: activeClose,
      })
    }
    await this.#running?.catch(() => undefined)
  }

  async #run(): Promise<StudioTestRun> {
    const id = crypto.randomUUID()
    const startedAt = Date.now()
    const output = new StudioTestProcessOutput(retainedOutputBytes)
    const command = startStudioProcessTree(this.#options.command, {
      args: this.#options.args,
      cwd: this.#options.cwd,
      env: this.#options.env,
      onOutput(_stream, chunk) {
        output.write(chunk)
      },
    })
    const waitForClose = finalizeStudioProcessTree(command)
    this.#active = command
    this.#activeClose = waitForClose
    const completion = await waitForClose()
    if (this.#active === command) {
      this.#active = undefined
      this.#activeClose = undefined
    }
    const run = StudioTestOutput.parse({
      durationMs: Date.now() - startedAt,
      exitCode: completion.exitCode,
      finishedAt: new Date().toISOString(),
      id,
      output: output.text(),
      parseOutput: output.parseText(),
      signal: completion.signal,
    })
    this.#lastRun = run
    return run
  }
}

export class StudioTestProcessOutput {
  readonly #limit: number
  #parseLines: string[] = []
  #pending = ''
  #retainNextLine = false
  #tail = Buffer.alloc(0)
  #truncated = false

  constructor(limit: number) {
    this.#limit = limit
  }

  write(chunk: Buffer): void {
    const combined = Buffer.concat([this.#tail, chunk])
    if (combined.byteLength > this.#limit) {
      this.#truncated = true
      let start = combined.byteLength - this.#limit
      while (start < combined.byteLength && (combined[start]! & 0xc0) === 0x80) {
        start += 1
      }
      this.#tail = combined.subarray(start)
    } else {
      this.#tail = combined
    }
    const lines = `${this.#pending}${chunk.toString('utf8')}`.split(/\r?\n/)
    this.#pending = lines.pop() ?? ''
    for (const line of lines) {
      this.#retainParseLine(line)
    }
  }

  text(): string {
    const tail = this.#tail.toString('utf8')
    return this.#truncated
      ? `[Earlier test output truncated; retaining the latest ${this.#limit} bytes.]\n${tail}`
      : tail
  }

  parseText(): string {
    const parseLines = [...this.#parseLines]
    this.#retainParseLine(this.#pending, parseLines, this.#retainNextLine, false)
    return `${parseLines.join('\n')}\n${this.text()}`
  }

  #retainParseLine(
    line: string,
    lines = this.#parseLines,
    retainNextLine = this.#retainNextLine,
    updateState = true,
  ): void {
    const sanitized = Text.stripAnsi(line)
    const retain = retainNextLine || /Tao check failed:|^\s*Source:/.test(sanitized)
    if (updateState) {
      this.#retainNextLine = /^\s*Source:/.test(sanitized)
    }
    if (retain) {
      lines.push(sanitized)
      if (lines.length > 500) {
        lines.splice(0, lines.length - 500)
      }
    }
  }
}
