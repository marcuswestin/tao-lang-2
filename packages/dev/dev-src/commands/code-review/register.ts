import type { Command } from '@commander-js/extra-typings'
import { FS, HCI, Platform, Repo } from '@shared'
import { DEFAULT_COLLECT_MAX_BYTES, DEFAULT_EFFORT, EFFORTS, REVIEWERS } from './constants'
import { launchReviewer, readRunMetas } from './launch'
import { REVIEW_LENSES } from './lenses'
import { parseManifest, parseManifestEntry } from './manifest'
import { formatReviewRunDir, resolveReviewRunDir, reviewRunRoot } from './paths'
import { buildReviewDigest, formatFanoutReport, formatMetaLine, isUsableReview } from './report'

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

/** registerReviewCommand registers the review orchestration command group. */
export function registerReviewCommand(commands: Command): void {
  const review = commands
    .command('review')
    .description('Launch and collect adversarial multi-agent reviews (see the subagents-review skill).')

  review
    .command('new')
    .description('Create a review run directory and print its path.')
    .option('--slug <slug>', 'Short human-readable run name.')
    .option('--stringent', 'Create the run under the stringent review artifact root.')
    .action(async (options: { slug?: string; stringent?: boolean }) => {
      const kind = options.stringent === true ? 'stringent' : 'standard'
      const runDir = FS.repoPath(`${reviewRunRoot(kind)}/${formatReviewRunDir(options.slug, new Date())}`)
      await FS.mkdir(runDir)
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
    .option('--timeout <seconds>', 'Reviewer timeout in seconds (agy only).')
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
  const meta = await launchReviewer(entry, { runDir: resolveReviewRunDir(options.run, repoRoot), repoRoot })
  HCI.writeLine(formatMetaLine(meta))
  return isUsableReview(meta) ? 0 : 1
}

async function runFanoutCommand(options: { run: string; manifest: string; json?: boolean }): Promise<number> {
  const repoRoot = Repo.getRoot()
  const runDir = resolveReviewRunDir(options.run, repoRoot)
  const entries = parseManifest(await FS.readJson(FS.resolvePath(options.manifest, { cwd: repoRoot })))
  const metas = await Promise.all(entries.map(entry => launchReviewer(entry, { runDir, repoRoot })))
  await FS.writeJson(FS.resolvePath('fanout.json', { cwd: runDir }), metas)
  HCI.write(options.json === true ? `${JSON.stringify(metas, null, 2)}\n` : formatFanoutReport(metas))
  return metas.some(meta => !isUsableReview(meta)) ? 1 : 0
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
  const digestPath = FS.resolvePath('digest.md', { cwd: runDir })
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
