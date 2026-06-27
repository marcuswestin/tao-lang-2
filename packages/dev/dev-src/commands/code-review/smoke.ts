import { FS } from '@shared'
import { CODEX_SPARK_MODEL, STANDARD_RUN_ROOT } from './constants'
import { launchReviewer } from './launch'
import { formatReviewRunDir } from './paths'
import type { ReviewerManifestEntry, ReviewMeta } from './types'
import { captureCodexBarUsage, type CodexBudgetSummary } from './usage'

export type SmokeProvider = 'agy' | 'claude' | 'codex' | 'codex-spark' | 'codexbar' | 'cursor' | 'gemini'

export type SmokeResult = {
  artifactDir?: string
  error?: string
  label: SmokeProvider
  meta?: ReviewMeta
  ok: boolean
  provider: SmokeProvider
  usage?: CodexBudgetSummary
  verbose?: boolean
}

const SMOKE_PROVIDERS: readonly SmokeProvider[] = [
  'codex',
  'codex-spark',
  'claude',
  'cursor',
  'gemini',
  'agy',
  'codexbar',
]

/** parseSmokeProviders parses a comma-separated provider list for live smoke checks. */
export function parseSmokeProviders(raw: string | undefined): SmokeProvider[] {
  if (raw === undefined || raw.trim() === '') {
    return ['codexbar']
  }
  if (raw.trim() === 'all') {
    return [...SMOKE_PROVIDERS]
  }
  const providers = raw.split(',').map(provider => provider.trim()).filter(provider => provider.length > 0)
  for (const provider of providers) {
    if (!(SMOKE_PROVIDERS as readonly string[]).includes(provider)) {
      throw new Error(`Unknown smoke provider "${provider}". Expected ${SMOKE_PROVIDERS.join(', ')}.`)
    }
  }
  return providers as SmokeProvider[]
}

/** runProviderSmokeChecks runs live smoke prompts through selected provider CLIs. */
export async function runProviderSmokeChecks(options: {
  provider?: string
  repoRoot: string
  timeoutSeconds?: number
}): Promise<{ results: SmokeResult[]; runDir: string }> {
  const providers = parseSmokeProviders(options.provider)
  const runDir = FS.resolvePath(
    `${STANDARD_RUN_ROOT}/smoke/${formatReviewRunDir('providers', new Date())}`,
    options.repoRoot,
  )
  await FS.mkdir(runDir)
  const results: SmokeResult[] = []
  for (const provider of providers) {
    try {
      results.push(
        await runOneSmokeProvider(provider, {
          repoRoot: options.repoRoot,
          runDir,
          timeoutSeconds: options.timeoutSeconds,
        }),
      )
    } catch (error) {
      results.push({
        error: error instanceof Error ? error.message : String(error),
        label: provider,
        ok: false,
        provider,
      })
    }
  }
  await FS.writeJson(FS.resolvePath('smoke-results.json', runDir), results)
  return { results, runDir }
}

async function runOneSmokeProvider(
  provider: SmokeProvider,
  ctx: { repoRoot: string; runDir: string; timeoutSeconds?: number },
): Promise<SmokeResult> {
  if (provider === 'codexbar') {
    return runCodexBarSmoke(ctx)
  }
  const prompt = `Return exactly this text and nothing else: ${markerFor(provider)}`
  const promptPath = FS.resolvePath(`prompt-${provider}.md`, ctx.runDir)
  await FS.writeText(promptPath, prompt)
  const entry = smokeManifestEntry(provider, promptPath, ctx.timeoutSeconds)
  const meta = await launchReviewer(entry, { kind: 'smoke', repoRoot: ctx.repoRoot, runDir: ctx.runDir })
  const reviewText = await FS.readText(meta.reviewPath)
  const match = smokeMarkerMatch(reviewText, markerFor(provider))
  const ok = meta.status === 'ok' && match.ok
  return {
    artifactDir: meta.artifactDir,
    error: ok ? undefined : `Expected ${markerFor(provider)}, got ${reviewText.trim() || meta.status}.`,
    label: provider,
    meta,
    ok,
    provider,
    verbose: ok ? match.verbose : undefined,
  }
}

async function runCodexBarSmoke(ctx: { repoRoot: string; runDir: string }): Promise<SmokeResult> {
  const usage = await captureCodexBarUsage(ctx.runDir, ctx.repoRoot)
  const ok = usage.status === 'ok' && usage.spark?.fiveHour !== undefined && usage.spark.weekly !== undefined
  return {
    artifactDir: ctx.runDir,
    error: ok ? undefined : usage.error ?? 'Codex Bar output did not include Spark usage windows.',
    label: 'codexbar',
    ok,
    provider: 'codexbar',
    usage,
  }
}

function smokeManifestEntry(
  provider: Exclude<SmokeProvider, 'codexbar'>,
  promptPath: string,
  timeoutSeconds: number | undefined,
): ReviewerManifestEntry {
  if (provider === 'codex-spark') {
    return {
      reviewer: 'codex',
      label: provider,
      model: CODEX_SPARK_MODEL,
      effort: 'low',
      promptFile: promptPath,
      timeoutSeconds,
    }
  }
  return {
    reviewer: provider,
    label: provider,
    effort: 'low',
    promptFile: promptPath,
    timeoutSeconds,
  }
}

function markerFor(provider: SmokeProvider): string {
  return `${provider.toUpperCase().replaceAll('-', '_')}_AGENT_OK`
}

/** smokeMarkerMatch classifies exact and verbose smoke outputs. */
export function smokeMarkerMatch(text: string, marker: string): { ok: boolean; verbose: boolean } {
  const normalized = normalizeSmokeText(text)
  if (normalized === marker) {
    return { ok: true, verbose: false }
  }
  return { ok: normalized.includes(marker), verbose: normalized.includes(marker) }
}

function normalizeSmokeText(text: string): string {
  return text
    .trim()
    .replace(/^```[a-zA-Z0-9_-]*\n?/, '')
    .replace(/\n?```$/, '')
    .replace(/^Result:\s*/i, '')
    .trim()
}
