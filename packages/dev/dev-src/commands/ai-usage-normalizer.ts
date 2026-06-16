/** UsageWindowSummary normalizes one Codex Bar rate-limit window. */
export type UsageWindowSummary = {
  label: string
  remainingPercent?: number
  resetDescription?: string
  resetsAt?: string
  usedPercent?: number
  windowMinutes?: number
}

/** UsageProviderSummary summarizes one provider's budget or why it is unavailable. */
export type UsageProviderSummary = {
  error?: string
  ok: boolean
  provider: string
  source?: string
  windows: UsageWindowSummary[]
}

/** normalizeCodexBarUsage parses Codex Bar JSON into provider/window summaries. */
export function normalizeCodexBarUsage(json: string): UsageProviderSummary[] | undefined {
  const raw = parseJson(json)
  if (!Array.isArray(raw)) {
    return undefined
  }
  return raw.filter(isRecord).map(normalizeProviderEntry)
}

/** findUsageProvider returns a provider summary by provider name. */
export function findUsageProvider(
  providers: readonly UsageProviderSummary[],
  provider: string,
): UsageProviderSummary | undefined {
  return providers.find(entry => entry.provider === provider)
}

/** findUsageWindow returns a named window from a provider summary. */
export function findUsageWindow(
  provider: UsageProviderSummary | undefined,
  label: string,
): UsageWindowSummary | undefined {
  return provider?.windows.find(window => window.label === label)
}

function normalizeProviderEntry(entry: Record<string, unknown>): UsageProviderSummary {
  const provider = typeof entry['provider'] === 'string' ? entry['provider'] : 'unknown'
  const source = typeof entry['source'] === 'string' ? entry['source'] : undefined
  const error = isRecord(entry['error']) ? entry['error'] : undefined
  if (error !== undefined) {
    return {
      provider,
      source,
      ok: false,
      error: typeof error['message'] === 'string' ? error['message'] : 'provider error',
      windows: [],
    }
  }
  const usage = isRecord(entry['usage']) ? entry['usage'] : undefined
  if (usage === undefined) {
    return { provider, source, ok: false, error: 'no usage reported', windows: [] }
  }
  const windows: UsageWindowSummary[] = []
  pushWindow(windows, 'primary', usage['primary'])
  pushWindow(windows, 'secondary', usage['secondary'])
  const extra = Array.isArray(usage['extraRateWindows']) ? usage['extraRateWindows'] : []
  for (const extraEntry of extra) {
    if (isRecord(extraEntry) && typeof extraEntry['id'] === 'string') {
      pushWindow(windows, extraEntry['id'], extraEntry['window'])
    }
  }
  return { provider, source, ok: true, windows }
}

function pushWindow(into: UsageWindowSummary[], label: string, raw: unknown): void {
  if (!isRecord(raw)) {
    return
  }
  const usedPercent = typeof raw['usedPercent'] === 'number' ? raw['usedPercent'] : undefined
  into.push({
    label,
    usedPercent,
    remainingPercent: usedPercent === undefined ? undefined : Math.max(0, 100 - usedPercent),
    resetDescription: typeof raw['resetDescription'] === 'string' ? raw['resetDescription'] : undefined,
    resetsAt: typeof raw['resetsAt'] === 'string' ? raw['resetsAt'] : undefined,
    windowMinutes: typeof raw['windowMinutes'] === 'number' ? raw['windowMinutes'] : undefined,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJson(json: string): unknown {
  try {
    return JSON.parse(json) as unknown
  } catch {
    return undefined
  }
}
