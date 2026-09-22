import type { RuntimeTesting } from '@expo-host/testing/runtime-testing'
import { Text } from '@shared'

export type StudioTestFailure = {
  column?: number
  filePath: string
  line?: number
  message: string
  name: string
}

export type StudioTestRun = {
  durationMs: number
  failed: number
  failures: readonly StudioTestFailure[]
  finishedAt: string
  id: string
  journeyObservations?: RuntimeTesting.JourneyObservationsArtifact
  output: string
  passed: number
  status: 'cancelled' | 'failed' | 'no-tests' | 'passed'
  testFiles: readonly string[]
}

export type StudioTestStatus = {
  available: boolean
  lastRun?: StudioTestRun
  reason?: string
  running: boolean
}

export type StudioTestRunner = {
  close(): Promise<void>
  run(): Promise<StudioTestRun>
  status(): StudioTestStatus
}

export const StudioTestOutput = {
  parse(input: {
    durationMs: number
    exitCode: number | null
    finishedAt: string
    id: string
    output: string
    parseOutput?: string
    signal: string | null
  }): StudioTestRun {
    // ANSI CSI sequences are presentation-only and must never enter the Studio DOM.
    const output = Text.stripAnsi(input.output).trim()
    const parseOutput = Text.stripAnsi(input.parseOutput ?? input.output)
    const failures = parseFailures(parseOutput)
    const passed = summaryCount(parseOutput, 'Tests', 'passed')
    const failed = summaryCount(parseOutput, 'Tests', 'failed')
    const testFiles = [
      ...new Set([
        // A `PASS`/`FAIL` line heads a Jest entrypoint. `tao test` generates one of those per worker
        // it may use, so those paths name the runner's own scaffolding rather than anything a Tao
        // author wrote; the per-journey tree under each of them names the `.test.tao` files it
        // covered, which is what the panel lists.
        ...matches(output, /(?:PASS|FAIL)\s+([^\n]+)/g).filter(path => path.endsWith('.test.tao')),
        ...matches(output, /[✓✕]\s+([^\n]+\.test\.tao)(?:\s|$)/g),
        // The runner gives each Tao journey its own case, so a `.test.tao` file names the group
        // those cases sit in rather than a case of its own: an indented line that is only the name.
        // The lookahead keeps a failure's own `Source: …/X.test.tao` line out of the file list.
        ...matches(output, /^[ \t]+(?!Source:)([^\s][^\n]*\.test\.tao)$/gm),
      ]),
    ]
    const noTests = /No Tao tests found\b/.test(output)
    return {
      durationMs: input.durationMs,
      failed,
      failures,
      finishedAt: input.finishedAt,
      id: input.id,
      output,
      passed,
      status: input.signal !== null
        ? 'cancelled'
        : noTests
        ? 'no-tests'
        : input.exitCode === 0
        ? 'passed'
        : 'failed',
      testFiles,
    }
  },
} as const

function parseFailures(output: string): readonly StudioTestFailure[] {
  const lines = output.split('\n')
  const failures: StudioTestFailure[] = []
  let name = 'Tao test failure'
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    const named = line.match(/Tao check failed:\s*(.+)$/)
    if (named !== null) {
      name = named[1]!.trim()
    }
    const located = line.match(/^\s*Source:\s+(.+):(\d+):(\d+)\s*$/)
    const unlocated = located === null ? line.match(/^\s*Source:\s+(.+?)\s*$/) : null
    const source = located ?? unlocated
    if (source === null) {
      continue
    }
    const next = lines.slice(index + 1).find(candidate =>
      candidate.trim() !== '' && !candidate.trim().startsWith('Source:')
    )
    const failure: StudioTestFailure = {
      filePath: source[1]!,
      message: next?.trim() ?? name,
      name,
      ...(source[2] === undefined ? {} : { line: Number(source[2]) }),
      ...(source[3] === undefined ? {} : { column: Number(source[3]) }),
    }
    const key = `${failure.filePath}:${failure.line ?? ''}:${failure.column ?? ''}:${failure.name}`
    if (
      !failures.some(candidate =>
        `${candidate.filePath}:${candidate.line ?? ''}:${candidate.column ?? ''}:${candidate.name}` === key
      )
    ) {
      failures.push(failure)
    }
  }
  return failures
}

function summaryCount(output: string, category: string, status: string): number {
  const match = output.match(new RegExp(`^${category}:\\s+.*?(\\d+) ${status}\\b`, 'm'))
  return match === null ? 0 : Number(match[1])
}

function matches(value: string, pattern: RegExp): string[] {
  return [...value.matchAll(pattern)].map(match => match[1]!.trim())
}
