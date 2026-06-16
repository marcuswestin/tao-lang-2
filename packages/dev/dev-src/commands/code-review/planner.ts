import {
  findUsageProvider,
  findUsageWindow,
  type UsageProviderSummary,
  type UsageWindowSummary,
} from '../ai-usage-normalizer'
import {
  CODEX_SPARK_MODEL,
  DEFAULT_AGY_MODEL,
  DEFAULT_CURSOR_MODEL,
  DEFAULT_GEMINI_MODEL,
} from './constants'
import type { ReviewEffort, Reviewer, ReviewerManifestEntry } from './types'
import type { CodexBudgetSummary } from './usage'

export type ReviewProfile = 'architecture' | 'light' | 'standard' | 'stringent'

export type ReviewPlanProvider = 'agy' | 'claude' | 'codex' | 'codex-spark' | 'cursor' | 'gemini'

export type PlannedReviewer = ReviewerManifestEntry & {
  budgetStatus: ProviderBudgetStatus
  provider: ReviewPlanProvider
  reason: string
  remainingPercent?: number
}

export type SkippedReviewer = {
  budgetStatus: ProviderBudgetStatus
  provider: ReviewPlanProvider
  reason: string
  remainingPercent?: number
}

export type ReviewPlan = {
  budgetPath?: string
  generatedAt: string
  manifestPath?: string
  planPath?: string
  profile: ReviewProfile
  runDir?: string
  scopeFile?: string
  selected: PlannedReviewer[]
  skipped: SkippedReviewer[]
}

export type ProviderBudgetStatus = 'available' | 'exhausted' | 'failed' | 'unknown'

type ProviderAvailability = {
  remainingPercent?: number
  reason: string
  status: ProviderBudgetStatus
}

type PlanCandidate = ReviewPlanProvider | 'codex-best'

type PlanSlot = {
  candidates: readonly PlanCandidate[]
  effort: ReviewEffort
  lens: string
  reason: string
}

const PROFILE_SLOTS: Record<ReviewProfile, readonly PlanSlot[]> = {
  light: [
    {
      lens: 'correctness',
      effort: 'medium',
      candidates: ['codex-best', 'claude', 'cursor', 'gemini', 'agy'],
      reason: 'primary correctness pass for a lightweight review',
    },
    {
      lens: 'api-boundary',
      effort: 'low',
      candidates: ['cursor', 'gemini', 'claude', 'agy', 'codex-best'],
      reason: 'independent boundary/conformance pass',
    },
  ],
  standard: [
    {
      lens: 'correctness',
      effort: 'high',
      candidates: ['codex-best', 'claude', 'cursor', 'gemini'],
      reason: 'primary correctness and edge-case pass',
    },
    {
      lens: 'api-boundary',
      effort: 'medium',
      candidates: ['cursor', 'claude', 'gemini', 'agy'],
      reason: 'package boundary and caller conformance pass',
    },
    {
      lens: 'tests',
      effort: 'medium',
      candidates: ['claude', 'gemini', 'cursor', 'codex-best'],
      reason: 'test quality and missing-coverage pass',
    },
    {
      lens: 'stale',
      effort: 'low',
      candidates: ['agy', 'gemini', 'cursor', 'claude'],
      reason: 'stale code, docs, and instruction drift pass',
    },
  ],
  stringent: [
    {
      lens: 'correctness',
      effort: 'high',
      candidates: ['codex-best', 'claude', 'cursor', 'gemini'],
      reason: 'primary correctness and edge-case pass',
    },
    {
      lens: 'regressions',
      effort: 'high',
      candidates: ['claude', 'cursor', 'gemini', 'codex-best'],
      reason: 'caller and regression pass',
    },
    {
      lens: 'api-boundary',
      effort: 'medium',
      candidates: ['cursor', 'gemini', 'claude', 'agy'],
      reason: 'package boundary and export pass',
    },
    {
      lens: 'requirements',
      effort: 'medium',
      candidates: ['gemini', 'claude', 'cursor', 'agy'],
      reason: 'plan/spec mismatch pass',
    },
    {
      lens: 'stale',
      effort: 'low',
      candidates: ['agy', 'gemini', 'cursor', 'claude'],
      reason: 'stale drift and cleanup pass',
    },
    {
      lens: 'tests',
      effort: 'low',
      candidates: ['codex-spark', 'gemini', 'claude', 'cursor'],
      reason: 'focused test and validation pass',
    },
  ],
  architecture: [
    {
      lens: 'architecture',
      effort: 'high',
      candidates: ['codex-best', 'claude', 'cursor', 'gemini'],
      reason: 'architecture and language-design integrity pass',
    },
    {
      lens: 'api-boundary',
      effort: 'medium',
      candidates: ['cursor', 'claude', 'gemini', 'agy'],
      reason: 'repo boundary and conformance pass',
    },
    {
      lens: 'requirements',
      effort: 'medium',
      candidates: ['gemini', 'claude', 'cursor', 'codex-best'],
      reason: 'tradeoff and plan/spec alignment pass',
    },
  ],
}

const PROVIDERS: readonly ReviewPlanProvider[] = ['codex', 'codex-spark', 'claude', 'cursor', 'gemini', 'agy']
const EXHAUSTED_THRESHOLD_PERCENT = 10
const SPARK_PREFERRED_THRESHOLD_PERCENT = 20

/** isReviewProfile checks whether a string names a supported review planning profile. */
export function isReviewProfile(value: string): value is ReviewProfile {
  return Object.hasOwn(PROFILE_SLOTS, value)
}

/** providersFromBudgetSummary extracts provider summaries from a review budget snapshot. */
export function providersFromBudgetSummary(
  summary: CodexBudgetSummary | undefined,
): UsageProviderSummary[] | undefined {
  if (summary?.providers !== undefined) {
    return summary.providers
  }
  if (summary === undefined) {
    return undefined
  }
  const windows: UsageWindowSummary[] = []
  if (summary.primary !== undefined) {
    windows.push({ ...summary.primary, label: summary.primary.label ?? 'primary' })
  }
  if (summary.secondary !== undefined) {
    windows.push({ ...summary.secondary, label: summary.secondary.label ?? 'secondary' })
  }
  if (summary.spark?.fiveHour !== undefined) {
    windows.push({ ...summary.spark.fiveHour, label: summary.spark.fiveHour.label ?? 'codex-spark' })
  }
  if (summary.spark?.weekly !== undefined) {
    windows.push({ ...summary.spark.weekly, label: summary.spark.weekly.label ?? 'codex-spark-weekly' })
  }
  return [{
    provider: 'codex',
    source: summary.source,
    ok: summary.status === 'ok',
    error: summary.error,
    windows,
  }]
}

/** planReviewers selects reviewers, lenses, models, and timeouts for a review profile. */
export function planReviewers(options: {
  budgetPath?: string
  generatedAt?: Date
  profile: ReviewProfile
  providers?: readonly UsageProviderSummary[]
  runDir?: string
  scopeFile?: string
}): ReviewPlan {
  const selected: PlannedReviewer[] = []
  const usedProviders = new Set<ReviewPlanProvider>()
  const usedLabels = new Set<string>()
  const providers = options.providers ?? []
  for (const slot of PROFILE_SLOTS[options.profile]) {
    const provider = pickProvider(slot, providers, usedProviders)
    if (provider === undefined) {
      continue
    }
    const availability = providerAvailability(providers, provider)
    const label = uniqueLabel(`${provider}-${slot.lens}`, usedLabels)
    usedProviders.add(provider)
    selected.push({
      ...manifestEntryForProvider(provider, slot, label, options.scopeFile),
      budgetStatus: availability.status,
      provider,
      reason: `${slot.reason}; ${availability.reason}`,
      remainingPercent: availability.remainingPercent,
    })
  }

  return {
    budgetPath: options.budgetPath,
    generatedAt: (options.generatedAt ?? new Date()).toISOString(),
    profile: options.profile,
    runDir: options.runDir,
    scopeFile: options.scopeFile,
    selected,
    skipped: PROVIDERS.filter(provider => !usedProviders.has(provider)).map(provider =>
      skippedProvider(providers, provider)
    ),
  }
}

/** manifestFromReviewPlan returns the fanout manifest for a generated review plan. */
export function manifestFromReviewPlan(plan: ReviewPlan): { reviewers: ReviewerManifestEntry[] } {
  return {
    reviewers: plan.selected.map(entry => ({
      reviewer: entry.reviewer,
      label: entry.label,
      model: entry.model,
      effort: entry.effort,
      timeoutSeconds: entry.timeoutSeconds,
      lens: entry.lens,
      promptFile: entry.promptFile,
      scopeFile: entry.scopeFile,
      scope: entry.scope,
    })),
  }
}

/** formatReviewPlan renders a concise human-readable plan summary. */
export function formatReviewPlan(plan: ReviewPlan): string {
  const lines = [
    `review plan (${plan.profile}): selected ${plan.selected.length} reviewer(s)`,
    plan.budgetPath === undefined ? 'budget: unknown (no codexbar-budget.json found)' : `budget: ${plan.budgetPath}`,
  ]
  for (const entry of plan.selected) {
    const model = entry.model === undefined ? '' : `/${entry.model}`
    const lens = entry.lens === undefined ? '' : ` [${entry.lens}]`
    const remaining = entry.remainingPercent === undefined ? '' : `, ${entry.remainingPercent.toFixed(0)}% remaining`
    lines.push(
      `- ${entry.label}: ${entry.reviewer}${model}${lens}, ${entry.effort}, ${entry.timeoutSeconds}s (${entry.budgetStatus}${remaining})`,
    )
  }
  if (plan.skipped.length > 0) {
    lines.push('skipped:')
    for (const skipped of plan.skipped) {
      const remaining = skipped.remainingPercent === undefined
        ? ''
        : `, ${skipped.remainingPercent.toFixed(0)}% remaining`
      lines.push(`- ${skipped.provider}: ${skipped.budgetStatus}${remaining}; ${skipped.reason}`)
    }
  }
  return `${lines.join('\n')}\n`
}

function pickProvider(
  slot: PlanSlot,
  providers: readonly UsageProviderSummary[],
  usedProviders: ReadonlySet<ReviewPlanProvider>,
): ReviewPlanProvider | undefined {
  for (const candidate of expandCandidates(slot.candidates, providers)) {
    if (usedProviders.has(candidate)) {
      continue
    }
    if (isSelectable(providerAvailability(providers, candidate))) {
      return candidate
    }
  }
  return undefined
}

function expandCandidates(
  candidates: readonly PlanCandidate[],
  providers: readonly UsageProviderSummary[],
): ReviewPlanProvider[] {
  return candidates.flatMap(candidate => candidate === 'codex-best' ? codexPreferenceOrder(providers) : [candidate])
}

function codexPreferenceOrder(providers: readonly UsageProviderSummary[]): ReviewPlanProvider[] {
  const codex = providerAvailability(providers, 'codex')
  const spark = providerAvailability(providers, 'codex-spark')
  const preferSpark = codex.status === 'exhausted'
    || (codex.remainingPercent !== undefined && codex.remainingPercent < SPARK_PREFERRED_THRESHOLD_PERCENT)
  return preferSpark && isSelectable(spark) ? ['codex-spark', 'codex'] : ['codex', 'codex-spark']
}

function isSelectable(availability: ProviderAvailability): boolean {
  return availability.status === 'available' || availability.status === 'unknown'
}

function providerAvailability(
  providers: readonly UsageProviderSummary[],
  provider: ReviewPlanProvider,
): ProviderAvailability {
  const usageProvider = findUsageProvider(providers, provider === 'codex-spark' ? 'codex' : provider)
  if (usageProvider === undefined) {
    return { status: 'unknown', reason: 'budget unknown; selected conservatively if needed' }
  }
  if (!usageProvider.ok) {
    if (provider !== 'codex' && provider !== 'codex-spark') {
      return {
        status: 'unknown',
        reason: usageProvider.error === undefined
          ? 'provider budget unavailable; selected conservatively if needed'
          : `provider budget unavailable (${usageProvider.error}); selected conservatively if needed`,
      }
    }
    return {
      status: 'failed',
      reason: usageProvider.error === undefined
        ? 'provider budget unavailable'
        : `provider budget unavailable: ${usageProvider.error}`,
    }
  }
  const remainingPercent = providerRemainingPercent(usageProvider, provider)
  if (remainingPercent === undefined) {
    return { status: 'unknown', reason: 'provider reported no usable budget window; selected conservatively if needed' }
  }
  if (remainingPercent < EXHAUSTED_THRESHOLD_PERCENT) {
    return {
      status: 'exhausted',
      remainingPercent,
      reason: `only ${remainingPercent.toFixed(0)}% remaining, below ${EXHAUSTED_THRESHOLD_PERCENT}% threshold`,
    }
  }
  return {
    status: 'available',
    remainingPercent,
    reason: `${remainingPercent.toFixed(0)}% remaining`,
  }
}

function providerRemainingPercent(
  provider: UsageProviderSummary,
  reviewerProvider: ReviewPlanProvider,
): number | undefined {
  if (reviewerProvider === 'codex') {
    return findUsageWindow(provider, 'primary')?.remainingPercent
  }
  if (reviewerProvider === 'codex-spark') {
    return findUsageWindow(provider, 'codex-spark')?.remainingPercent
  }
  const primary = findUsageWindow(provider, 'primary')?.remainingPercent
  if (primary !== undefined) {
    return primary
  }
  const reported = provider.windows
    .map(window => window.remainingPercent)
    .filter((value): value is number => value !== undefined && Number.isFinite(value))
  return reported.length === 0 ? undefined : Math.max(...reported)
}

function manifestEntryForProvider(
  provider: ReviewPlanProvider,
  slot: PlanSlot,
  label: string,
  scopeFile: string | undefined,
): ReviewerManifestEntry {
  return {
    reviewer: reviewerForProvider(provider),
    label,
    model: modelForProvider(provider),
    effort: slot.effort,
    timeoutSeconds: timeoutForProvider(provider),
    lens: slot.lens,
    scopeFile,
  }
}

function reviewerForProvider(provider: ReviewPlanProvider): Reviewer {
  return provider === 'codex-spark' ? 'codex' : provider
}

function modelForProvider(provider: ReviewPlanProvider): string | undefined {
  switch (provider) {
    case 'agy':
      return DEFAULT_AGY_MODEL
    case 'codex-spark':
      return CODEX_SPARK_MODEL
    case 'cursor':
      return DEFAULT_CURSOR_MODEL
    case 'gemini':
      return DEFAULT_GEMINI_MODEL
    case 'claude':
    case 'codex':
      return undefined
  }
}

function timeoutForProvider(provider: ReviewPlanProvider): number {
  return provider === 'agy' ? 480 : 900
}

function skippedProvider(
  providers: readonly UsageProviderSummary[],
  provider: ReviewPlanProvider,
): SkippedReviewer {
  const availability = providerAvailability(providers, provider)
  return {
    provider,
    budgetStatus: availability.status,
    remainingPercent: availability.remainingPercent,
    reason: isSelectable(availability)
      ? 'not needed for the selected profile after higher-ranked reviewers were chosen'
      : availability.reason,
  }
}

function uniqueLabel(base: string, used: Set<string>): string {
  let candidate = base
  let index = 2
  while (used.has(candidate)) {
    candidate = `${base}-${index}`
    index += 1
  }
  used.add(candidate)
  return candidate
}
