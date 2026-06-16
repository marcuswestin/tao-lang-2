import type { Command } from '@commander-js/extra-typings'
import { CLI, HCI, Platform, Repo } from '@shared'
import { normalizeCodexBarUsage, type UsageProviderSummary, type UsageWindowSummary } from './ai-usage-normalizer'

type AiUsageOptions = {
  provider?: string
  source?: string
  json?: boolean
}

/** AiUsageWindow normalizes one provider rate-limit window. */
export type AiUsageWindow = UsageWindowSummary

/** AiUsageProvider summarizes one provider's budget or the reason it is unavailable. */
export type AiUsageProvider = UsageProviderSummary

const DEFAULT_PROVIDER = 'codex'
const DEFAULT_SOURCE = 'oauth'

/** registerAiUsageCommand registers `./agent ai-usage`. */
export function registerAiUsageCommand(commands: Command): void {
  commands
    .command('ai-usage')
    .description('Summarize AI provider budget via the codexbar CLI.')
    .option(
      '--provider <name>',
      `Provider or group passed to codexbar, e.g. "codex" or "all" (default ${DEFAULT_PROVIDER}).`,
    )
    .option('--source <source>', `Codex Bar fetch source (default ${DEFAULT_SOURCE}).`)
    .option('--json', 'Print the normalized usage summary as JSON.')
    .action(async (options: AiUsageOptions = {}) => {
      Platform.runtimeProcess.setExitCode(await runAiUsage(options))
    })
}

/** runAiUsage fetches codexbar usage and prints a normalized AI provider budget summary. */
export async function runAiUsage(options: AiUsageOptions = {}): Promise<number> {
  const provider = options.provider ?? DEFAULT_PROVIDER
  const source = options.source ?? DEFAULT_SOURCE
  const args = ['usage', '--provider', provider, '--source', source, '--format', 'json']
  const result = await CLI.run('codexbar', { args, cwd: Repo.getRoot() })
  if (result.error !== undefined) {
    HCI.writeError(`ai-usage: failed to run ${CLI.formatCommand('codexbar', { args })}: ${result.error.message}\n`)
    return 1
  }
  const providers = summarizeAiUsage(result.stdout)
  if (providers === undefined) {
    const detail = result.stderr.trim().length > 0 ? `: ${result.stderr.trim()}` : ''
    HCI.writeError(`ai-usage: could not parse codexbar output${detail}\n`)
    return 1
  }
  if (options.json === true) {
    HCI.writeLine(JSON.stringify(providers, null, 2))
  } else {
    HCI.write(formatAiUsageReport(providers))
  }
  return providers.some(entry => entry.ok) ? 0 : 1
}

/** summarizeAiUsage normalizes codexbar usage JSON into per-provider budget windows. */
export function summarizeAiUsage(json: string): AiUsageProvider[] | undefined {
  return normalizeCodexBarUsage(json)
}

/** formatAiUsageReport renders a concise, human-readable AI usage report. */
export function formatAiUsageReport(providers: readonly AiUsageProvider[]): string {
  const available = providers.filter(entry => entry.ok)
  const unavailable = providers.filter(entry => !entry.ok)
  const lines: string[] = []
  if (available.length === 0) {
    lines.push('ai usage: no providers with available budget.')
  }
  for (const entry of available) {
    const source = entry.source === undefined ? '' : ` [${entry.source}]`
    const windows = entry.windows.length === 0 ? 'no windows reported' : entry.windows.map(formatWindow).join(', ')
    lines.push(`- ${entry.provider}${source}: ${windows}`)
  }
  if (unavailable.length > 0) {
    lines.push(`unavailable: ${unavailable.map(entry => entry.provider).join(', ')}`)
  }
  return `${lines.join('\n')}\n`
}

function formatWindow(window: AiUsageWindow): string {
  const remaining = window.remainingPercent === undefined ? 'n/a' : `${window.remainingPercent.toFixed(0)}% left`
  const reset = window.resetDescription === undefined ? '' : ` (resets ${window.resetDescription})`
  return `${window.label} ${remaining}${reset}`
}
