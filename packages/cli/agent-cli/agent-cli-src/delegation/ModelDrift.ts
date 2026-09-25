import { CLI, FS, Json, Text } from '@shared'

type ModelDriftFacts = {
  cache?: { fetchedAt?: string; models?: readonly string[] }
  claudeVersion?: string
  codexDefault?: string
  configuredOpus?: string
  nowMs: number
}

const CACHE_MAX_AGE_MS = 72 * 60 * 60 * 1000

/** Missing, stale, or unattributed evidence produces no mismatch warning. */
export function modelDriftWarnings(facts: ModelDriftFacts): string[] {
  const warnings: string[] = []
  const fetchedAt = facts.cache?.fetchedAt === undefined ? Number.NaN : Date.parse(facts.cache.fetchedAt)
  if (
    facts.codexDefault !== undefined && Number.isFinite(fetchedAt)
    && fetchedAt <= facts.nowMs && facts.nowMs - fetchedAt <= CACHE_MAX_AGE_MS
    && facts.cache?.models !== undefined && !facts.cache.models.includes(facts.codexDefault)
  ) {
    warnings.push(
      `Codex default ${facts.codexDefault} is absent from the fresh local model catalog; check account availability and regenerate config if the tier changed.`,
    )
  }

  if (
    facts.configuredOpus === 'claude-opus-5-5' && facts.claudeVersion !== undefined
    && compareVersion(facts.claudeVersion, '2.1.280') < 0
  ) {
    warnings.push(
      `Claude Code ${facts.claudeVersion} predates Opus 5.5 support (2.1.280); update the installed CLI before relying on standard and deep Claude Code subagents.`,
    )
  }

  return warnings
}

function compareVersion(actual: string, required: string): number {
  const numbers = (value: string) => value.split('.').slice(0, 3).map(part => Number(part))
  const a = numbers(actual)
  const b = numbers(required)
  if (a.length !== 3 || a.some(part => !Number.isInteger(part))) {
    return 0
  }
  for (let index = 0; index < 3; index += 1) {
    if (a[index]! !== b[index]!) {
      return a[index]! - b[index]!
    }
  }
  return 0
}

/** Bounded local model metadata only; transcript observations stay in delegation-report. */
export async function readModelDriftWarnings(root: string): Promise<string[]> {
  const configPath = FS.resolvePath('.codex/config.toml', root)
  const permissionsPath = FS.resolvePath('.rulesync/permissions.jsonc', root)
  const cachePath = FS.resolvePath('.codex/models_cache.json', FS.homeDir())
  const config = await FS.isFile(configPath) ? await FS.readText(configPath) : ''
  const permissions = await FS.isFile(permissionsPath)
    ? JSON.parse(Text.stripJsonc(await FS.readText(permissionsPath))) as {
      claudecode?: { env?: Record<string, string> }
    }
    : undefined
  let cache: ModelDriftFacts['cache']
  if (await FS.isFile(cachePath)) {
    try {
      const data = await FS.readJson<unknown>(cachePath)
      if (Json.isRecord(data) && Array.isArray(data['models'])) {
        cache = {
          fetchedAt: typeof data['fetched_at'] === 'string' ? data['fetched_at'] : undefined,
          models: data['models'].flatMap(model =>
            Json.isRecord(model) && typeof model['slug'] === 'string'
              ? [model['slug']]
              : []
          ),
        }
      }
    } catch {
      // A partial catalog is not evidence that any model is unavailable.
    }
  }
  const version = await CLI.run('claude', { args: ['--version'], cwd: root }).catch(() => undefined)
  const claudeVersion = version?.exitCode === 0 ? version.stdout.match(/\d+\.\d+\.\d+/)?.[0] : undefined
  return modelDriftWarnings({
    cache,
    claudeVersion,
    codexDefault: config.match(/^default_subagent_model\s*=\s*"([^"]+)"/m)?.[1],
    configuredOpus: permissions?.claudecode?.env?.['ANTHROPIC_DEFAULT_OPUS_MODEL'],
    nowMs: Date.now(),
  })
}
