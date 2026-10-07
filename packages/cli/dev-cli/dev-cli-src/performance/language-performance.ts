import { OutputText } from '@cli-kit'
import Workspace from '@compiler/workspace'
import Formatter from '@formatter'
import { Assert, Errors, FS, HCI, Platform, Repo } from '@shared'

const fixtureRelativePath = 'Apps/WordFlower/1 - Current/WordFlower.tao'
const defaultIterations = 10

type Stage = 'parse' | 'validate' | 'check' | 'compile' | 'format'
type Strategy = 'one-shot' | 'session'
type Operation = () => Promise<unknown>
type OperationFactory = () => Operation | Promise<Operation>

/**
 * BUDGETS_MS is the ceiling on each case's steady-state median; the bench fails when one is passed.
 *
 * They are deliberately loose. Each is about two and a half times the slowest median seen across two
 * runs on the busiest machine this was measured on — load 40 on 18 cores — so a loaded machine does
 * not trip them, and a bench that cries wolf is one nobody runs. The defects they exist for were not
 * subtle: a session parse of this fixture took 1,600ms before the scope provider remembered what a
 * `use` statement resolves to, and about 20s before the physical-path guard stopped asking the file
 * system per reference. What a budget this loose cannot see is a regression of two times, and the
 * tests that count work rather than time are what hold those: documents read once per batch
 * (`workspace-batch.test.ts`), one physical-path lookup per imported file (`packages.test.ts`).
 */
const BUDGETS_MS: Readonly<Record<`${Stage} ${Strategy}`, number>> = {
  'parse one-shot': 1_300,
  'parse session': 400,
  'validate one-shot': 1_100,
  'validate session': 450,
  'check one-shot': 1_700,
  'check session': 1_300,
  'compile one-shot': 2_300,
  'compile session': 1_300,
  'format one-shot': 100,
  'format session': 100,
}

/** BudgetBreach is one case whose steady-state median passed its budget. */
export type BudgetBreach = {
  budgetMs: number
  medianMs: number
  stage: Stage
  strategy: Strategy
}

export type PerformanceSampleSummary = {
  medianMs: number
  p95Ms: number
}

export type LanguagePerformanceResult = {
  stage: Stage
  strategy: Strategy
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
  Assert.input(samplesMs.length > 0, 'Performance samples must not be empty.')

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
  const fixtureDirectory = FS.dirname(fixturePath)
  const source = await FS.readText(fixturePath)
  const wallStartedAt = performance.now()
  const results: LanguagePerformanceResult[] = []

  results.push(
    await measureCase('parse', 'one-shot', iterations, async () => async () => {
      await Workspace.parse(fixturePath)
    }),
  )
  results.push(
    await measureCase('parse', 'session', iterations, async () => {
      const workspace = await Workspace.open(fixtureDirectory)
      return async () => await workspace.parse(fixturePath)
    }),
  )

  results.push(
    await measureCase('validate', 'one-shot', iterations, async () => async () => {
      await Workspace.validate(fixturePath)
    }),
  )
  results.push(
    await measureCase('validate', 'session', iterations, async () => {
      const workspace = await Workspace.open(fixtureDirectory)
      return async () => await workspace.validate(fixturePath)
    }),
  )

  // What `tao check` does with a whole app: every file an entry of its own, built once.
  const entryFiles = (await Repo.filesUnder(fixtureDirectory)).filter(path => FS.extname(path) === '.tao')
  results.push(
    await measureCase('check', 'one-shot', iterations, async () => async () => {
      await (await Workspace.open(fixtureDirectory)).validateFiles(entryFiles)
    }),
  )
  results.push(
    await measureCase('check', 'session', iterations, async () => {
      const workspace = await Workspace.open(fixtureDirectory)
      return async () => await workspace.validateFiles(entryFiles)
    }),
  )

  results.push(
    await measureCase('compile', 'one-shot', iterations, async () => async () => {
      await Workspace.compile(fixturePath, { appName: 'WordFlower' })
    }),
  )
  results.push(
    await measureCase('compile', 'session', iterations, async () => {
      const workspace = await Workspace.open(fixtureDirectory)
      return async () => await workspace.compile(fixturePath, { appName: 'WordFlower' })
    }),
  )

  results.push(
    await measureCase('format', 'one-shot', iterations, async () => async () => {
      await Formatter.formatFile(fixturePath)
    }),
  )
  results.push(
    await measureCase('format', 'session', iterations, async () => {
      const session = Formatter.createSession()
      return async () => await session.formatFile(fixturePath)
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

/** budgetFor returns the ceiling on one case's steady-state median. */
export function budgetFor(stage: Stage, strategy: Strategy): number {
  return BUDGETS_MS[`${stage} ${strategy}`]
}

/** budgetBreaches lists the cases whose steady-state median passed its budget, in report order. */
export function budgetBreaches(report: Pick<LanguagePerformanceReport, 'results'>): BudgetBreach[] {
  return report.results.flatMap(result => {
    const budgetMs = budgetFor(result.stage, result.strategy)
    return result.summary.medianMs > budgetMs
      ? [{ budgetMs, medianMs: result.summary.medianMs, stage: result.stage, strategy: result.strategy }]
      : []
  })
}

/** renderLanguagePerformance renders benchmark metadata plus cold, median, and p95 latency against each budget. */
export function renderLanguagePerformance(report: LanguagePerformanceReport): string {
  const lines = [
    'Language service performance',
    `fixture ${report.fixturePath} (${report.fixtureLines} lines, ${report.fixtureBytes} bytes)`,
    `steady-state iterations ${report.iterations}`,
    '',
    `${'stage'.padEnd(10)}${'strategy'.padEnd(12)}${'cold'.padStart(10)}${'median'.padStart(10)}${'p95'.padStart(10)}${
      'budget'.padStart(10)
    }`,
  ]

  for (const result of report.results) {
    lines.push(
      `${result.stage.padEnd(10)}${result.strategy.padEnd(12)}`
        + `${formatElapsed(result.coldMs).padStart(10)}`
        + `${formatElapsed(result.summary.medianMs).padStart(10)}`
        + `${formatElapsed(result.summary.p95Ms).padStart(10)}`
        + `${formatElapsed(budgetFor(result.stage, result.strategy)).padStart(10)}`,
    )
  }

  const breaches = budgetBreaches(report)
  lines.push(
    '',
    breaches.length === 0
      ? 'every steady-state median is within its budget'
      : `over budget: ${
        breaches.map(breach =>
          `${breach.stage} ${breach.strategy} median ${breach.medianMs}ms against ${breach.budgetMs}ms`
        ).join('; ')
      }`,
  )

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
    Errors.throwUnexpected(`Performance sample ${index} does not exist.`)
  }
  return sample
}

function assertIterations(iterations: number): void {
  Assert.input(
    Number.isSafeInteger(iterations) && iterations >= 1,
    `Performance iterations must be a positive integer; received ${iterations}.`,
  )
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
    const report = await runLanguagePerformance(iterations)
    const artifactRoot = Platform.runtimeProcess.env['TAO_STUDIO_PREVIEW_PERFORMANCE_ARTIFACT_ROOT']
    if (artifactRoot) {
      await FS.mkdir(artifactRoot)
      await FS.writeJson(FS.resolvePath('language.json', artifactRoot), report)
    }
    HCI.write(renderLanguagePerformance(report))
    if (budgetBreaches(report).length > 0) {
      Platform.runtimeProcess.setExitCode(1)
    }
  } catch (error) {
    HCI.writeErrorLine(Errors.formatForUser(error))
    Platform.runtimeProcess.setExitCode(1)
  }
}

if (import.meta.main) {
  await run()
}
