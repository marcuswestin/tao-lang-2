import Compiler from '@compiler'
import Formatter from '@formatter'
import { Parser } from '@parser'
import { Errors, FS, HCI, Platform, Repo } from '@shared'
import Validator from '@validator'
import { OutputText } from '../cli/OutputText'

const fixtureRelativePath = 'Apps/WordFlower/1 - Current/WordFlower.tao'
const defaultIterations = 10

type Operation = () => Promise<unknown>
type OperationFactory = () => Operation | Promise<Operation>

export type PerformanceSampleSummary = {
  medianMs: number
  p95Ms: number
}

export type LanguagePerformanceResult = {
  stage: 'parse' | 'validate' | 'compile' | 'format'
  strategy: 'one-shot' | 'session'
  coldMs: number
  samplesMs: readonly number[]
  summary: PerformanceSampleSummary
}

export type LanguagePerformanceReport = {
  fixturePath: string
  fixtureBytes: number
  fixtureLines: number
  iterations: number
  wallMs: number
  measuredMs: number
  results: readonly LanguagePerformanceResult[]
}

/** summarizeSamples reports stable center and tail latency for a non-empty sample. */
export function summarizeSamples(samplesMs: readonly number[]): PerformanceSampleSummary {
  if (samplesMs.length === 0) {
    throw new Error('Performance samples must not be empty.')
  }

  const sorted = [...samplesMs].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const medianMs = sorted.length % 2 === 0
    ? (definedSample(sorted, middle - 1) + definedSample(sorted, middle)) / 2
    : definedSample(sorted, middle)
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1)

  return {
    medianMs,
    p95Ms: definedSample(sorted, p95Index),
  }
}

/** runLanguagePerformance measures first-call and steady-state language-service latency. */
export async function runLanguagePerformance(iterations = defaultIterations): Promise<LanguagePerformanceReport> {
  assertIterations(iterations)

  const fixturePath = Repo.resolvePath(fixtureRelativePath)
  const source = await FS.readText(fixturePath)
  const wallStartedAt = performance.now()
  const results: LanguagePerformanceResult[] = []

  results.push(
    await measureCase('parse', 'one-shot', iterations, async () => async () => {
      await Parser.parseCode(source, { validation: false })
    }),
  )
  results.push(
    await measureCase('parse', 'session', iterations, async () => {
      const context = Parser.createContext()
      return async () => await Parser.parseSource(context, source, { validation: false })
    }),
  )

  results.push(
    await measureCase('validate', 'one-shot', iterations, async () => async () => {
      await Validator.validateCode(source)
    }),
  )
  results.push(
    await measureCase('validate', 'session', iterations, async () => {
      const session = await Validator.createSession()
      return async () => await session.validateCode(source)
    }),
  )

  results.push(
    await measureCase('compile', 'one-shot', iterations, async () => async () => {
      await Compiler.compileCode(source, { appName: 'WordFlower' })
    }),
  )
  results.push(
    await measureCase('compile', 'session', iterations, async () => {
      const session = await Compiler.createSession()
      return async () => await session.compileCode(source, { appName: 'WordFlower' })
    }),
  )

  results.push(
    await measureCase('format', 'one-shot', iterations, async () => async () => {
      await Formatter.formatCode(source)
    }),
  )
  results.push(
    await measureCase('format', 'session', iterations, async () => {
      const session = Formatter.createSession()
      return async () => await session.formatCode(source)
    }),
  )

  const wallMs = performance.now() - wallStartedAt
  return {
    fixturePath,
    fixtureBytes: new TextEncoder().encode(source).byteLength,
    fixtureLines: lineCount(source),
    iterations,
    wallMs,
    measuredMs: results.reduce(
      (total, result) => total + result.coldMs + result.samplesMs.reduce((sum, sample) => sum + sample, 0),
      0,
    ),
    results,
  }
}

/** renderLanguagePerformance renders benchmark metadata plus cold, median, and p95 latency. */
export function renderLanguagePerformance(report: LanguagePerformanceReport): string {
  const lines = [
    'Language service performance',
    `fixture ${report.fixturePath} (${report.fixtureLines} lines, ${report.fixtureBytes} bytes)`,
    `steady-state iterations ${report.iterations}`,
    '',
    `${'stage'.padEnd(10)}${'strategy'.padEnd(12)}${'cold'.padStart(10)}${'median'.padStart(10)}${'p95'.padStart(10)}`,
  ]

  for (const result of report.results) {
    lines.push(
      `${result.stage.padEnd(10)}${result.strategy.padEnd(12)}`
        + `${formatElapsed(result.coldMs).padStart(10)}`
        + `${formatElapsed(result.summary.medianMs).padStart(10)}`
        + `${formatElapsed(result.summary.p95Ms).padStart(10)}`,
    )
  }

  lines.push(
    '',
    `wall ${formatElapsed(report.wallMs)}, measured sum ${formatElapsed(report.measuredMs)}`,
  )
  return `${lines.join('\n')}\n`
}

export function parseIterations(value: string | undefined): number {
  if (value === undefined) {
    return defaultIterations
  }
  const iterations = Number(value)
  assertIterations(iterations)
  return iterations
}

async function measureCase(
  stage: LanguagePerformanceResult['stage'],
  strategy: LanguagePerformanceResult['strategy'],
  iterations: number,
  createOperation: OperationFactory,
): Promise<LanguagePerformanceResult> {
  const coldStartedAt = performance.now()
  const operation = await createOperation()
  await operation()
  const coldMs = performance.now() - coldStartedAt
  const samplesMs: number[] = []

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const startedAt = performance.now()
    await operation()
    samplesMs.push(performance.now() - startedAt)
  }

  return {
    stage,
    strategy,
    coldMs,
    samplesMs,
    summary: summarizeSamples(samplesMs),
  }
}

function definedSample(samples: readonly number[], index: number): number {
  const sample = samples[index]
  if (sample === undefined) {
    throw new Error(`Performance sample ${index} does not exist.`)
  }
  return sample
}

function assertIterations(iterations: number): void {
  if (!Number.isSafeInteger(iterations) || iterations < 1) {
    throw new Error(`Performance iterations must be a positive integer; received ${iterations}.`)
  }
}

function lineCount(source: string): number {
  const newlineCount = source.split('\n').length - 1
  return newlineCount + (source.endsWith('\n') ? 0 : 1)
}

function formatElapsed(elapsedMs: number): string {
  if (elapsedMs < 10) {
    return `${elapsedMs.toFixed(2)}ms`
  }
  return OutputText.formatElapsed(Math.round(elapsedMs))
}

async function run(): Promise<void> {
  try {
    const iterations = parseIterations(Platform.runtimeProcess.argv[2])
    HCI.write(renderLanguagePerformance(await runLanguagePerformance(iterations)))
  } catch (error) {
    HCI.writeErrorLine(Errors.formatForUser(error))
    Platform.runtimeProcess.setExitCode(1)
  }
}

if (import.meta.main) {
  await run()
}
