import {
  finalizeStudioProcessTree,
  startStudioProcessTree,
  stopStudioProcessTree,
  type StudioProcessTree,
  type WaitForStudioProcessTreeClose,
} from '@expo-host/dev-loop/StudioProcessTree'
import { RuntimeTesting } from '@expo-host/testing/runtime-testing'
import { Errors, FS, Text } from '@shared'
import { StudioTestOutput, type StudioTestRun, type StudioTestRunner, type StudioTestStatus } from '@studio'

type StudioTestProcessRunnerOptions = {
  args: readonly string[]
  command: string
  cwd: string
  env?: Readonly<Record<string, string>>
  stopTimeoutMs?: number
  /** Keep controlled subprocess tests out of the persistent machine discovery index. */
  resourceIndexRoot?: string
}

const retainedOutputBytes = 1_000_000

/** Owns one serialized Tao test subprocess for a Studio project. */
export class StudioTestProcessRunner implements StudioTestRunner {
  readonly #options: StudioTestProcessRunnerOptions
  #active: StudioProcessTree | undefined
  #activeClose: WaitForStudioProcessTreeClose | undefined
  #closed = false
  #lastRun: StudioTestRun | undefined
  #lastJourneyObservations: RuntimeTesting.JourneyObservationsArtifact | undefined
  #running: Promise<StudioTestRun> | undefined

  constructor(options: StudioTestProcessRunnerOptions) {
    this.#options = options
  }

  status(): StudioTestStatus {
    return { available: true, lastRun: this.#lastRun, running: this.#running !== undefined }
  }

  /** journeyObservations returns the last run's live renderer observations when its command supplied the artifact. */
  journeyObservations(): RuntimeTesting.JourneyObservationsArtifact | undefined {
    return this.#lastJourneyObservations
  }

  run(): Promise<StudioTestRun> {
    if (this.#closed) {
      return Promise.reject(new Errors.UnexpectedBehaviorError('The Studio test runner is closed.'))
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
    const journeyObservationsPath = FS.resolvePath(`tao-studio-journey-observations-${id}.json`, FS.tmpdir())
    this.#lastJourneyObservations = undefined
    const startedAt = Date.now()
    const output = new StudioTestProcessOutput(retainedOutputBytes)
    const command = await startStudioProcessTree(this.#options.command, {
      args: [...this.#options.args, '--journey-observations', journeyObservationsPath],
      cwd: this.#options.cwd,
      env: this.#options.env,
      resourceIndexRoot: this.#options.resourceIndexRoot,
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
    this.#lastJourneyObservations = await readJourneyObservations(journeyObservationsPath)
    await FS.remove(journeyObservationsPath)
    const run = StudioTestOutput.parse({
      durationMs: Date.now() - startedAt,
      exitCode: completion.exitCode,
      finishedAt: new Date().toISOString(),
      id,
      output: output.text(),
      parseOutput: output.parseText(),
      signal: completion.signal,
    })
    run.journeyObservations = this.#lastJourneyObservations
    this.#lastRun = run
    return run
  }
}

async function readJourneyObservations(path: string): Promise<RuntimeTesting.JourneyObservationsArtifact | undefined> {
  if (!await FS.isFile(path)) {
    return undefined
  }
  return RuntimeTesting.JourneyObservations.parseArtifact(await FS.readJson<unknown>(path))
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
