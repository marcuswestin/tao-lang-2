import { Switch } from '@shared'
import {
  findUsageProvider,
  findUsageWindow,
  type UsageProviderSummary,
  type UsageWindowSummary,
} from '../ai-usage-normalizer'
import type { CodexBudgetSummary } from './usage'

export type ReviewPlanProvider = 'agy' | 'claude' | 'codex' | 'codex-spark' | 'cursor' | 'gemini'

export type ProviderBudgetStatus = 'available' | 'exhausted' | 'failed' | 'unknown'

type ProviderAvailability = {
  remainingPercent?: number
  reason: string
  status: ProviderBudgetStatus
}

const EXHAUSTED_THRESHOLD_PERCENT = 10
const SPARK_PREFERRED_THRESHOLD_PERCENT = 20

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

export function codexPreferenceOrder(providers: readonly UsageProviderSummary[]): ReviewPlanProvider[] {
  const codex = providerAvailability(providers, 'codex')
  const spark = providerAvailability(providers, 'codex-spark')
  const preferSpark = codex.status === 'exhausted'
    || (codex.remainingPercent !== undefined && codex.remainingPercent < SPARK_PREFERRED_THRESHOLD_PERCENT)
  return preferSpark && isSelectable(spark) ? ['codex-spark', 'codex'] : ['codex', 'codex-spark']
}

export function isSelectable(availability: ProviderAvailability): boolean {
  return availability.status === 'available' || availability.status === 'unknown'
}

export function providerAvailability(
  providers: readonly UsageProviderSummary[],
  provider: ReviewPlanProvider,
): ProviderAvailability {
  const usageProvider = findUsageProvider(providers, usageProviderName(provider))
  if (usageProvider === undefined) {
    return { status: 'unknown', reason: 'budget unknown; selected conservatively if needed' }
  }
  if (!usageProvider.ok) {
    return unavailableProviderAvailability(provider, usageProvider)
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
  return Switch<ReviewPlanProvider, number | undefined>(reviewerProvider, {
    agy: () => reportedProviderRemainingPercent(provider),
    claude: () => reportedProviderRemainingPercent(provider),
    codex: () => findUsageWindow(provider, 'primary')?.remainingPercent,
    'codex-spark': () => findUsageWindow(provider, 'codex-spark')?.remainingPercent,
    cursor: () => reportedProviderRemainingPercent(provider),
    gemini: () => reportedProviderRemainingPercent(provider),
  })
}

function unavailableProviderAvailability(
  provider: ReviewPlanProvider,
  usageProvider: UsageProviderSummary,
): ProviderAvailability {
  return Switch<ReviewPlanProvider, ProviderAvailability>(provider, {
    agy: () => unknownProviderAvailability(usageProvider),
    claude: () => unknownProviderAvailability(usageProvider),
    codex: () => failedProviderAvailability(usageProvider),
    'codex-spark': () => failedProviderAvailability(usageProvider),
    cursor: () => unknownProviderAvailability(usageProvider),
    gemini: () => unknownProviderAvailability(usageProvider),
  })
}

function unknownProviderAvailability(usageProvider: UsageProviderSummary): ProviderAvailability {
  return {
    status: 'unknown',
    reason: usageProvider.error === undefined
      ? 'provider budget unavailable; selected conservatively if needed'
      : `provider budget unavailable (${usageProvider.error}); selected conservatively if needed`,
  }
}

function failedProviderAvailability(usageProvider: UsageProviderSummary): ProviderAvailability {
  return {
    status: 'failed',
    reason: usageProvider.error === undefined
      ? 'provider budget unavailable'
      : `provider budget unavailable: ${usageProvider.error}`,
  }
}

function reportedProviderRemainingPercent(provider: UsageProviderSummary): number | undefined {
  const primary = findUsageWindow(provider, 'primary')?.remainingPercent
  if (primary !== undefined) {
    return primary
  }
  const reported = provider.windows
    .map(window => window.remainingPercent)
    .filter((value): value is number => value !== undefined && Number.isFinite(value))
  return reported.length === 0 ? undefined : Math.max(...reported)
}

function usageProviderName(provider: ReviewPlanProvider): string {
  return Switch<ReviewPlanProvider, string>(provider, {
    agy: () => 'agy',
    claude: () => 'claude',
    codex: () => 'codex',
    'codex-spark': () => 'codex',
    cursor: () => 'cursor',
    gemini: () => 'gemini',
  })
}
