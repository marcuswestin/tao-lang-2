import { CLI, FS } from '@shared'
import {
  findUsageProvider,
  findUsageWindow,
  normalizeCodexBarUsage,
  type UsageProviderSummary,
  type UsageWindowSummary,
} from '../ai-usage-normalizer'

export type { UsageProviderSummary, UsageWindowSummary } from '../ai-usage-normalizer'

export type CodexBudgetSummary = {
  command: string
  error?: string
  primary?: UsageWindowSummary
  providers?: UsageProviderSummary[]
  rawPath: string
  secondary?: UsageWindowSummary
  source?: string
  spark?: {
    fiveHour?: UsageWindowSummary
    weekly?: UsageWindowSummary
  }
  status: 'ok' | 'failed'
  stderrPath?: string
}

/** captureCodexBarUsage writes raw Codex Bar usage and a normalized budget summary for a review run. */
export async function captureCodexBarUsage(runDir: string, repoRoot: string): Promise<CodexBudgetSummary> {
  await FS.mkdir(runDir)
  const rawPath = FS.resolvePath('codexbar-usage.json', runDir)
  const stderrPath = FS.resolvePath('codexbar-usage.stderr.log', runDir)
  const args = ['usage', '--provider', 'all', '--source', 'oauth', '--format', 'json', '--pretty']
  const result = await CLI.run('codexbar', { args, cwd: repoRoot })
  await FS.writeText(rawPath, result.stdout)
  if (result.stderr.trim().length > 0) {
    await FS.writeText(stderrPath, result.stderr)
  }
  const stderrText = result.stderr.trim()
  const parsed = parseCodexBudgetSummary(result.stdout, {
    command: CLI.formatCommand('codexbar', { args }),
    rawPath,
    stderrPath: stderrText.length > 0 ? stderrPath : undefined,
  })
  const summary: CodexBudgetSummary = parsed.status === 'ok'
    ? parsed
    : {
      ...parsed,
      error: parsed.error ?? (stderrText.length > 0 ? stderrText : undefined)
        ?? `codexbar exited ${result.exitCode ?? 'unknown'}`,
      status: 'failed',
    }
  await FS.writeJson(FS.resolvePath('codexbar-budget.json', runDir), summary)
  return summary
}

/** parseCodexBudgetSummary normalizes Codex and Spark usage windows from Codex Bar JSON. */
export function parseCodexBudgetSummary(
  json: string,
  context: Pick<CodexBudgetSummary, 'command' | 'rawPath' | 'stderrPath'>,
): CodexBudgetSummary {
  const providers = normalizeCodexBarUsage(json)
  if (providers === undefined) {
    return { ...context, error: 'Codex Bar usage output was not a JSON array.', status: 'failed' }
  }
  const codex = findUsageProvider(providers, 'codex')
  if (codex === undefined) {
    return {
      ...context,
      error: 'Codex Bar usage output did not contain a codex provider entry.',
      providers,
      status: 'failed',
    }
  }
  if (!codex.ok) {
    return {
      ...context,
      error: codex.error ?? 'Codex Bar returned an error.',
      providers,
      status: 'failed',
    }
  }
  return {
    ...context,
    primary: findUsageWindow(codex, 'primary'),
    providers,
    secondary: findUsageWindow(codex, 'secondary'),
    source: codex.source,
    spark: {
      fiveHour: findUsageWindow(codex, 'codex-spark'),
      weekly: findUsageWindow(codex, 'codex-spark-weekly'),
    },
    status: 'ok',
  }
}
