import { CLI } from '@shared'
import { StudioTestOutput, type StudioTestRun, type StudioTestRunner, type StudioTestStatus } from '@studio'

type StudioTestProcessRunnerOptions = {
  args: readonly string[]
  command: string
  cwd: string
  env?: Readonly<Record<string, string>>
}

const retainedOutputBytes = 1_000_000

/** Owns one serialized Tao test subprocess for a Studio project. */
export class StudioTestProcessRunner implements StudioTestRunner {
  readonly #options: StudioTestProcessRunnerOptions
  #active: ReturnType<typeof CLI.start> | undefined
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
    this.#active?.kill('SIGTERM')
    await this.#running?.catch(() => undefined)
  }

  async #run(): Promise<StudioTestRun> {
    const id = crypto.randomUUID()
    const startedAt = Date.now()
    const output = new StudioTestProcessOutput(retainedOutputBytes)
    const command = CLI.start(this.#options.command, {
      args: this.#options.args,
      cwd: this.#options.cwd,
      env: this.#options.env,
      onOutput(_stream, chunk) {
        output.write(chunk)
      },
      stdio: 'pipe',
    })
    this.#active = command
    const completion = await command.waitForClose()
    await command.closeOutput()
    command.dispose()
    if (this.#active === command) {
      this.#active = undefined
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
      this.#tail = combined.subarray(combined.byteLength - this.#limit)
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
    this.#retainParseLine(this.#pending)
    return `${this.#parseLines.join('\n')}\n${this.text()}`
  }

  #retainParseLine(line: string): void {
    const retain = this.#retainNextLine || /Tao check failed:|^\s*Source:/.test(line)
    this.#retainNextLine = /^\s*Source:/.test(line)
    if (retain) {
      this.#parseLines.push(line)
      this.#parseLines.splice(500)
    }
  }
}
