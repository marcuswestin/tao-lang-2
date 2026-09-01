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
        ...matches(output, /(?:PASS|FAIL)\s+([^\n]+)/g),
        ...matches(output, /[✓✕]\s+([^\n]+\.test\.tao)(?:\s|$)/g),
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
