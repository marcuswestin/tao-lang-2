import type { Command } from '@commander-js/extra-typings'
import { FS, HCI, Platform, Repo } from '@shared'
import type { UsageProviderSummary } from '../ai-usage-normalizer'
import { DEFAULT_COLLECT_MAX_BYTES, DEFAULT_EFFORT, EFFORTS, REVIEWERS } from './constants'
import { launchReviewer, readRunMetas } from './launch'
import { REVIEW_LENSES } from './lenses'
import { parseManifest, parseManifestEntry } from './manifest'
import { formatReviewRunDir, resolveReviewRunDir, reviewRunRoot } from './paths'
import {
  formatReviewPlan,
  isReviewProfile,
  manifestFromReviewPlan,
  planReviewers,
  providersFromBudgetSummary,
  type ReviewProfile,
} from './planner'
import { buildReviewDigest, formatFanoutReport, formatMetaLine, isUsableReview } from './report'
import { runProviderSmokeChecks } from './smoke'
import { captureCodexBarUsage, type CodexBudgetSummary } from './usage'

type ReviewRunOptions = {
  run: string
  reviewer: string
  label: string
  lens?: string
  scopeFile?: string
  promptFile?: string
  model?: string
  effort?: string
  timeout?: string
}

type ReviewPlanOptions = {
  json?: boolean
  profile: string
  run: string
  scopeFile?: string
}

/** registerReviewCommand registers the review orchestration command group. */
export function registerReviewCommand(commands: Command): void {
  const review = commands
    .command('review')
    .description('Plan, launch, and collect adversarial read-only reviews.')

  review
    .command('new')
    .description('Create a review run directory and print its path.')
    .option('--slug <slug>', 'Short human-readable run name.')
    .option('--stringent', 'Create the run under the stringent review artifact root.')
    .action(async (options: { slug?: string; stringent?: boolean }) => {
      const kind = options.stringent === true ? 'stringent' : 'standard'
      const runDir = Repo.resolvePath(`${reviewRunRoot(kind)}/${formatReviewRunDir(options.slug, new Date())}`)
      await FS.mkdir(runDir)
      await captureUsageForRun(runDir, Repo.getRoot())
      HCI.writeLine(runDir)
    })

  review
    .command('lenses')
    .description('List the available review lenses.')
    .option('--json', 'Print the lenses as JSON.')
    .action((options: { json?: boolean }) => {
      if (options.json === true) {
        HCI.writeLine(JSON.stringify(REVIEW_LENSES, null, 2))
        return
      }
      for (const [key, lens] of Object.entries(REVIEW_LENSES)) {
        HCI.writeLine(`${key}: ${lens.title}`)
      }
    })

  review
    .command('plan')
    .description('Generate a budget-aware recommended fanout manifest for a review run.')
    .requiredOption('--run <dir>', 'Review run directory (from `./agent review new`).')
    .requiredOption('--profile <profile>', 'Review profile: light, standard, stringent, architecture.')
    .option('--scope-file <path>', 'Scope file to assign to every recommended reviewer.')
    .option('--json', 'Print the generated review plan as JSON.')
    .action(async (options: ReviewPlanOptions) => {
      Platform.runtimeProcess.setExitCode(await runPlanCommand(options))
    })

  review
    .command('run')
    .description('Launch one reviewer, capture its review, and print a summary.')
    .requiredOption('--run <dir>', 'Review run directory (from `./agent review new`).')
    .requiredOption('--reviewer <reviewer>', `Reviewer CLI: ${REVIEWERS.join(', ')}.`)
    .requiredOption('--label <label>', 'Short label used for the reviewer output files.')
    .option('--lens <key>', 'Assign a review lens (see `./agent review lenses`).')
    .option('--scope-file <path>', 'File describing the review scope; defaults to the working-tree diff.')
    .option('--prompt-file <path>', 'Use a fully-formed prompt file verbatim instead of assembling one.')
    .option('--model <id>', 'Reviewer model id.')
    .option('--effort <level>', `Reasoning effort: ${EFFORTS.join(', ')} (default ${DEFAULT_EFFORT}).`)
    .option('--timeout <seconds>', 'Reviewer hard timeout in seconds.')
    .action(async (options: ReviewRunOptions) => {
      Platform.runtimeProcess.setExitCode(await runReviewCommand(options))
    })

  review
    .command('fanout')
    .description('Launch many reviewers in parallel from a JSON manifest.')
    .requiredOption('--run <dir>', 'Review run directory (from `./agent review new`).')
    .requiredOption('--manifest <path>', 'JSON manifest: an array of reviewer specs or { reviewers: [...] }.')
    .option('--json', 'Print a machine-readable fanout report.')
    .action(async (options: { run: string; manifest: string; json?: boolean }) => {
      Platform.runtimeProcess.setExitCode(await runFanoutCommand(options))
    })

  review
    .command('usage')
    .description('Capture Codex Bar provider budget JSON for a review run.')
    .requiredOption('--run <dir>', 'Review run directory.')
    .option('--json', 'Print the normalized budget summary as JSON.')
    .action(async (options: { run: string; json?: boolean }) => {
      Platform.runtimeProcess.setExitCode(await runUsageCommand(options))
    })

  review
    .command('smoke-providers')
    .description('Run live smoke prompts against review provider CLIs and capture artifacts.')
    .option('--provider <list>', 'Comma-separated providers: codex,codex-spark,claude,cursor,gemini,agy,codexbar.')
    .option('--timeout <seconds>', 'Hard timeout in seconds for agent smoke prompts.')
    .action(async (options: { provider?: string; timeout?: string }) => {
      Platform.runtimeProcess.setExitCode(await runSmokeProvidersCommand(options))
    })

  review
    .command('collect')
    .description('Write and print a byte-capped digest of every reviewer output in a run.')
    .requiredOption('--run <dir>', 'Review run directory.')
    .option('--max-bytes <n>', `Per-reviewer byte cap for the digest (default ${DEFAULT_COLLECT_MAX_BYTES}).`)
    .option('--json', 'Print the digest index as JSON.')
    .action(async (options: { run: string; maxBytes?: string; json?: boolean }) => {
      Platform.runtimeProcess.setExitCode(await runCollectCommand(options))
    })
}

async function runReviewCommand(options: ReviewRunOptions): Promise<number> {
  const repoRoot = Repo.getRoot()
  const runDir = resolveReviewRunDir(options.run, repoRoot)
  const entry = parseManifestEntry({
    reviewer: options.reviewer,
    label: options.label,
    lens: options.lens,
    model: options.model,
    effort: options.effort,
    timeoutSeconds: options.timeout === undefined ? undefined : Number(options.timeout),
    promptFile: options.promptFile,
    scopeFile: options.scopeFile,
  }, 0)
  const meta = await launchReviewer(entry, { runDir, repoRoot })
  HCI.writeLine(formatMetaLine(meta))
  return isUsableReview(meta) ? 0 : 1
}

async function runFanoutCommand(options: { run: string; manifest: string; json?: boolean }): Promise<number> {
  const repoRoot = Repo.getRoot()
  const runDir = resolveReviewRunDir(options.run, repoRoot)
  const entries = parseManifest(await FS.readJson(FS.resolvePath(options.manifest, repoRoot)))
  const metas = await Promise.all(entries.map(entry => launchReviewer(entry, { runDir, repoRoot })))
  await FS.writeJson(FS.resolvePath('fanout.json', runDir), metas)
  HCI.write(options.json === true ? `${JSON.stringify(metas, null, 2)}\n` : formatFanoutReport(metas))
  return metas.some(meta => !isUsableReview(meta)) ? 1 : 0
}

async function runPlanCommand(options: ReviewPlanOptions): Promise<number> {
  if (!isReviewProfile(options.profile)) {
    throw new Error('--profile must be one of light, standard, stringent, architecture.')
  }
  const repoRoot = Repo.getRoot()
  const runDir = resolveReviewRunDir(options.run, repoRoot)
  const { budgetPath, providers } = await readBudgetProviders(runDir)
  const planPath = FS.resolvePath('review-plan.json', runDir)
  const manifestPath = FS.resolvePath('manifest.recommended.json', runDir)
  const plan = planReviewers({
    budgetPath,
    generatedAt: new Date(),
    profile: options.profile as ReviewProfile,
    providers,
    runDir,
    scopeFile: options.scopeFile,
  })
  const writtenPlan = { ...plan, manifestPath, planPath }
  await FS.writeJson(planPath, writtenPlan)
  await FS.writeJson(manifestPath, manifestFromReviewPlan(writtenPlan))
  if (options.json === true) {
    HCI.writeLine(JSON.stringify(writtenPlan, null, 2))
  } else {
    HCI.writeLine(`review plan -> ${planPath}`)
    HCI.writeLine(`manifest -> ${manifestPath}`)
    HCI.write(formatReviewPlan(writtenPlan))
  }
  return writtenPlan.selected.length > 0 ? 0 : 1
}

async function runUsageCommand(options: { run: string; json?: boolean }): Promise<number> {
  const repoRoot = Repo.getRoot()
  const summary = await captureCodexBarUsage(resolveReviewRunDir(options.run, repoRoot), repoRoot)
  if (options.json === true) {
    HCI.writeLine(JSON.stringify(summary, null, 2))
  } else {
    HCI.writeLine(`codexbar usage -> ${summary.rawPath}`)
    HCI.writeLine(`providers captured: ${summary.providers?.length ?? 0}`)
    HCI.writeLine(`spark 5h remaining: ${formatPercent(summary.spark?.fiveHour?.remainingPercent)}`)
    HCI.writeLine(`spark weekly remaining: ${formatPercent(summary.spark?.weekly?.remainingPercent)}`)
  }
  return summary.status === 'ok' ? 0 : 1
}

async function runSmokeProvidersCommand(options: { provider?: string; timeout?: string }): Promise<number> {
  const timeoutSeconds = options.timeout === undefined ? undefined : Number(options.timeout)
  if (timeoutSeconds !== undefined && (!Number.isInteger(timeoutSeconds) || timeoutSeconds <= 0)) {
    throw new Error('--timeout must be a positive integer number of seconds.')
  }
  const { results, runDir } = await runProviderSmokeChecks({
    provider: options.provider,
    repoRoot: Repo.getRoot(),
    timeoutSeconds,
  })
  HCI.writeLine(`smoke artifacts -> ${runDir}`)
  for (const result of results) {
    const status = result.ok
      ? result.verbose === true ? 'ok (verbose)' : 'ok'
      : `failed (${result.error ?? 'unknown error'})`
    HCI.writeLine(`- ${result.provider}: ${status}`)
  }
  return results.every(result => result.ok) ? 0 : 1
}

async function runCollectCommand(options: { run: string; maxBytes?: string; json?: boolean }): Promise<number> {
  const repoRoot = Repo.getRoot()
  const runDir = resolveReviewRunDir(options.run, repoRoot)
  const maxBytes = options.maxBytes === undefined ? DEFAULT_COLLECT_MAX_BYTES : Number(options.maxBytes)
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('--max-bytes must be a positive integer.')
  }
  const metas = await readRunMetas(runDir)
  if (metas.length === 0) {
    HCI.writeLine(`no reviewer metadata found in ${runDir}`)
    return 1
  }
  const digest = await buildReviewDigest(metas, maxBytes)
  const digestPath = FS.resolvePath('digest.md', runDir)
  await FS.writeText(digestPath, digest.markdown)
  if (options.json === true) {
    HCI.writeLine(JSON.stringify({ digestPath, index: digest.index }, null, 2))
  } else {
    HCI.writeLine(`digest -> ${digestPath}`)
    for (const item of digest.index) {
      HCI.writeLine(`- ${item}`)
    }
  }
  return 0
}

async function captureUsageForRun(runDir: string, repoRoot: string): Promise<void> {
  const existing = FS.resolvePath('codexbar-budget.json', runDir)
  if (await FS.exists(existing)) {
    return
  }
  const summary = await captureCodexBarUsage(runDir, repoRoot)
  if (summary.status !== 'ok') {
    HCI.logProcessWarn('review', `codexbar usage unavailable: ${summary.error ?? 'unknown error'}`)
  }
}

async function readBudgetProviders(
  runDir: string,
): Promise<{ budgetPath?: string; providers?: UsageProviderSummary[] }> {
  const budgetPath = FS.resolvePath('codexbar-budget.json', runDir)
  if (!await FS.exists(budgetPath)) {
    return {}
  }
  let summary: CodexBudgetSummary
  try {
    summary = await FS.readJson<CodexBudgetSummary>(budgetPath)
  } catch (error) {
    HCI.logProcessWarn(
      'review',
      `ignoring malformed codexbar budget at ${budgetPath}: ${error instanceof Error ? error.message : String(error)}`,
    )
    return { budgetPath }
  }
  const providers = providersFromBudgetSummary(summary)
  return providers === undefined ? { budgetPath } : { budgetPath, providers }
}

function formatPercent(value: number | undefined): string {
  return value === undefined ? 'unknown' : `${value.toFixed(0)}%`
}
