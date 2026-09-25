import { FS, Json, Text } from '@shared'
import { DELEGATION_SKILL_PATH, tierModels } from './DelegationProfiles'

/**
 * auditModelRouting reports where the delegation routing table has fallen behind the models this
 * machine's harnesses run: a Codex slug the installed catalog superseded, a full Claude id in the
 * `claude` or `cursor` column behind a newer model of its family, and a Claude Code install whose
 * latest request in a family the table names by alias ran an older model than another install ran.
 * A Codex slug missing from the catalog is only a note, since every Codex install on the machine
 * rewrites that one file with what its own version is offered. Transcripts are read machine-wide,
 * because an alias resolves per install rather than per checkout. The full report also measures the
 * context this checkout's sessions carried and how they compacted, the baseline the
 * compaction-threshold experiment is judged against. It is evidence for the Developer, never a gate.
 */

/** How far back `--brief` looks, whatever `--days` says: it runs at every session start. */
const BRIEF_WINDOW_DAYS = 1
/**
 * How much of a transcript `--brief` reads, from the end. Recent requests sit at the tail of an
 * append-only log, and a session start cannot afford to read transcripts tens of megabytes long.
 */
const BRIEF_TAIL_BYTES = 256 * 1024
/** A Codex catalog fetched longer ago than this cannot say that a model is gone. */
const CATALOG_MAX_AGE_MS = 72 * 60 * 60 * 1000
const MS_PER_DAY = 24 * 60 * 60 * 1000

export type ClaudeModelId = { family: string; id: string; version: readonly number[] }

/**
 * parseClaudeModelId reads `claude-<family>-<n>[-<n>][-<8-digit date>]` — `claude-opus-5`,
 * `claude-opus-5-5`, `claude-haiku-4-5-20251001`. Undefined for anything else, including the
 * `<synthetic>` model a harness can log and a bare alias such as `opus`.
 */
export function parseClaudeModelId(id: string): ClaudeModelId | undefined {
  const parts = id.split('-')
  if (parts[0] !== 'claude' || parts.length < 3) {
    return undefined
  }
  const family = parts[1]
  if (family === undefined || !/^[a-z]+$/.test(family)) {
    return undefined
  }
  let numberParts = parts.slice(2)
  const last = numberParts[numberParts.length - 1]
  if (numberParts.length > 1 && last !== undefined && /^\d{8}$/.test(last)) {
    numberParts = numberParts.slice(0, -1)
  }
  if (numberParts.length === 0 || !numberParts.every(part => /^\d+$/.test(part))) {
    return undefined
  }
  return { family, id, version: numberParts.map(Number) }
}

/** compareVersions orders version tuples the way a missing trailing component reads: `[5]` is `5.0`. */
export function compareVersions(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) {
      return diff
    }
  }
  return 0
}

/**
 * parseVersion reads the leading dotted numbers of a version, such as a Claude Code `2.1.281`.
 * Undefined when there are none.
 */
function parseVersion(text: string): number[] | undefined {
  return /^\d+(\.\d+)*/.exec(text)?.[0].split('.').map(Number)
}

export type CodexModelId = { id: string; name: string; prefix: string; version: readonly number[] }

/**
 * parseCodexModelId reads `<prefix>-<version>-<name>` (`gpt-5.6-sol` is gpt, 5.6, sol), the version as
 * a tuple so that 5.10 follows 5.9. Undefined for a slug without that shape, such as `gpt-reserve`
 * or `gpt-5.5`, which the audit can still find missing from a catalog but never superseded.
 */
export function parseCodexModelId(id: string): CodexModelId | undefined {
  const [prefix, versionText, ...nameParts] = id.split('-')
  if (
    prefix === undefined || versionText === undefined || nameParts.length === 0 || !/^\d+(\.\d+)*$/.test(versionText)
  ) {
    return undefined
  }
  return { id, name: nameParts.join('-'), prefix, version: versionText.split('.').map(Number) }
}

type TranscriptKind = 'main' | 'subagent'

type ClaudeRequest = {
  ccVersion: string
  /** Uncached input, cache writes, and cache reads: everything the request sent. */
  contextTokens: number
  cwd: string
  entrypoint: string
  kind: TranscriptKind
  model: string
  timeMs: number
}

type Compaction = { cwd: string; preTokens: number; timeMs: number; trigger: string }

type ClaudeActivity = { compactions: Compaction[]; requests: ClaudeRequest[] }

/**
 * findClaudeTranscripts lists every transcript this machine's Claude Code has written, in every
 * project: a main session is `projects/<project>/<session>.jsonl`, and a subagent is any transcript
 * beneath `projects/<project>/<session>/subagents/`, a workflow's included under `workflows/<id>/`.
 */
async function findClaudeTranscripts(claudeDir: string): Promise<Array<{ kind: TranscriptKind; path: string }>> {
  const projectsDir = FS.resolvePath('projects', claudeDir)
  const transcripts: Array<{ kind: TranscriptKind; path: string }> = []
  if (!(await FS.isDirectory(projectsDir))) {
    return transcripts
  }
  for (const project of await FS.listDir(projectsDir)) {
    const projectPath = FS.resolvePath(project, projectsDir)
    if (!(await FS.isDirectory(projectPath))) {
      continue
    }
    for (const entry of await FS.listDir(projectPath)) {
      const entryPath = FS.resolvePath(entry, projectPath)
      if (entry.endsWith('.jsonl')) {
        transcripts.push({ kind: 'main', path: entryPath })
        continue
      }
      const subagentsDir = FS.resolvePath('subagents', entryPath)
      if (!(await FS.isDirectory(subagentsDir))) {
        continue
      }
      for await (const subagent of FS.walk(subagentsDir, { extensions: ['.jsonl'] })) {
        transcripts.push({ kind: 'subagent', path: subagent })
      }
    }
  }
  return transcripts
}

/**
 * transcriptText reads a transcript whole, or under `--brief` only its tail. A tail can start
 * mid-line, so that partial line is dropped rather than risk a truncated record that still parses.
 */
async function transcriptText(path: string, brief: boolean): Promise<string> {
  if (!brief || await FS.byteSize(path) <= BRIEF_TAIL_BYTES) {
    return FS.readText(path)
  }
  const tail = await FS.readTextSuffix(path, BRIEF_TAIL_BYTES)
  const newline = tail.indexOf('\n')
  return newline === -1 ? '' : tail.slice(newline + 1)
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  return typeof value === 'number' ? value : 0
}

function stringField(record: Record<string, unknown>, key: string, fallback: string): string {
  const value = record[key]
  return typeof value === 'string' ? value : fallback
}

function timeOf(record: Record<string, unknown>): number {
  const timestamp = record['timestamp']
  return typeof timestamp === 'string' ? Date.parse(timestamp) : Number.NaN
}

/**
 * parseRequest reads an assistant response: the model that answered and the context the request
 * sent. It tests for a substring before parsing, since most lines are something else and a full
 * report reads hundreds of megabytes.
 */
function parseRequest(line: string, kind: TranscriptKind): { key: string; request: ClaudeRequest } | undefined {
  if (!line.includes('"type":"assistant"')) {
    return undefined
  }
  const entry = Json.tryParse(line)
  if (!Json.isRecord(entry) || entry['type'] !== 'assistant' || !Json.isRecord(entry['message'])) {
    return undefined
  }
  const message = entry['message']
  const model = message['model']
  const id = message['id']
  const requestId = entry['requestId']
  const timeMs = timeOf(entry)
  if (
    typeof model !== 'string' || !model.startsWith('claude-') || typeof id !== 'string'
    || typeof requestId !== 'string' || Number.isNaN(timeMs)
  ) {
    return undefined
  }
  const usage = Json.isRecord(message['usage']) ? message['usage'] : {}
  return {
    key: `${id}::${requestId}`,
    request: {
      ccVersion: stringField(entry, 'version', 'unknown'),
      contextTokens: numberField(usage, 'input_tokens') + numberField(usage, 'cache_creation_input_tokens')
        + numberField(usage, 'cache_read_input_tokens'),
      cwd: stringField(entry, 'cwd', ''),
      entrypoint: stringField(entry, 'entrypoint', 'unknown'),
      kind,
      model,
      timeMs,
    },
  }
}

/** parseCompaction reads a compaction boundary: what triggered it and the context it began from. */
function parseCompaction(line: string): { compaction: Compaction; key: string } | undefined {
  if (!line.includes('"compact_boundary"')) {
    return undefined
  }
  const entry = Json.tryParse(line)
  if (!Json.isRecord(entry) || entry['subtype'] !== 'compact_boundary' || !Json.isRecord(entry['compactMetadata'])) {
    return undefined
  }
  const metadata = entry['compactMetadata']
  const uuid = entry['uuid']
  const timeMs = timeOf(entry)
  if (typeof uuid !== 'string' || Number.isNaN(timeMs)) {
    return undefined
  }
  return {
    compaction: {
      cwd: stringField(entry, 'cwd', ''),
      preTokens: numberField(metadata, 'preTokens'),
      timeMs,
      trigger: stringField(metadata, 'trigger', 'unknown'),
    },
    key: uuid,
  }
}

/**
 * collectClaudeActivity bounds the scan by each file's modified time first, since a transcript
 * untouched since the window opened cannot hold a record inside it, and then by each record's own
 * timestamp. One response is written across several lines and a resumed session copies history into
 * a new file, so a record counts once per message and request id, or once per boundary id.
 */
async function collectClaudeActivity(
  claudeDir: string,
  sinceMs: number,
  untilMs: number,
  brief: boolean,
): Promise<ClaudeActivity> {
  const activity: ClaudeActivity = { compactions: [], requests: [] }
  const seen = new Set<string>()
  const counts = (key: string, timeMs: number): boolean => {
    if (timeMs < sinceMs || timeMs > untilMs || seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  }
  for (const transcript of await findClaudeTranscripts(claudeDir)) {
    if (!(await FS.isFile(transcript.path)) || await FS.modifiedTimeMs(transcript.path) < sinceMs) {
      continue
    }
    for (const line of (await transcriptText(transcript.path, brief)).split('\n')) {
      const request = parseRequest(line, transcript.kind)
      if (request !== undefined) {
        if (counts(request.key, request.request.timeMs)) {
          activity.requests.push(request.request)
        }
        continue
      }
      const compaction = parseCompaction(line)
      if (compaction !== undefined && counts(compaction.key, compaction.compaction.timeMs)) {
        activity.compactions.push(compaction.compaction)
      }
    }
  }
  return activity
}

/** tiersByModel groups a column's tiers by the model they name, so tiers sharing one report once. */
function tiersByModel(table: ReadonlyMap<string, string>): Map<string, string[]> {
  const grouped = new Map<string, string[]>()
  for (const [tier, model] of table) {
    grouped.set(model, [...(grouped.get(model) ?? []), tier])
  }
  return grouped
}

/** tierPhrase reads "codex tier frontier names" or "codex tiers standard, deep name". */
function tierPhrase(column: string, tiers: readonly string[]): string {
  return tiers.length === 1 ? `${column} tier ${tiers[0]} names` : `${column} tiers ${tiers.join(', ')} name`
}

function newestByFamily(requests: readonly ClaudeRequest[]): Map<string, ClaudeModelId> {
  const newest = new Map<string, ClaudeModelId>()
  for (const request of requests) {
    const parsed = parseClaudeModelId(request.model)
    const current = parsed === undefined ? undefined : newest.get(parsed.family)
    if (parsed !== undefined && (current === undefined || compareVersions(parsed.version, current.version) > 0)) {
      newest.set(parsed.family, parsed)
    }
  }
  return newest
}

/**
 * aliasLagFindings covers each bare family the `claude` column names, such as `opus`. An install
 * resolves an alias to the newest model of the family it knows, so an entrypoint whose latest request
 * in the family ran an older model than another install ran in the window is an install behind the
 * machine. An entrypoint that has since updated and run the newer model reports nothing, and neither
 * does one whose Claude Code version is at or past a version that ran the newer model: that install
 * knows the newer model, so its session chose the older one by name.
 */
function aliasLagFindings(claudeTable: ReadonlyMap<string, string>, requests: readonly ClaudeRequest[]): string[] {
  const newest = newestByFamily(requests)
  const findings: string[] = []
  for (const [alias, tiers] of tiersByModel(claudeTable)) {
    const newestModel = newest.get(alias)
    if (newestModel === undefined) {
      continue
    }
    const latestByEntrypoint = new Map<string, { parsed: ClaudeModelId; request: ClaudeRequest }>()
    let knownFrom: number[] | undefined
    for (const request of requests) {
      const parsed = parseClaudeModelId(request.model)
      if (parsed?.family !== alias) {
        continue
      }
      const latest = latestByEntrypoint.get(request.entrypoint)
      if (latest === undefined || request.timeMs > latest.request.timeMs) {
        latestByEntrypoint.set(request.entrypoint, { parsed, request })
      }
      const version = parseVersion(request.ccVersion)
      if (
        version !== undefined && compareVersions(parsed.version, newestModel.version) === 0
        && (knownFrom === undefined || compareVersions(version, knownFrom) < 0)
      ) {
        knownFrom = version
      }
    }
    const knowsNewest = (request: ClaudeRequest): boolean => {
      const version = parseVersion(request.ccVersion)
      return version !== undefined && knownFrom !== undefined && compareVersions(version, knownFrom) >= 0
    }
    const lagging = [...latestByEntrypoint.values()]
      .filter(({ parsed, request }) =>
        compareVersions(parsed.version, newestModel.version) < 0 && !knowsNewest(request)
      )
      .sort((left, right) => left.request.entrypoint.localeCompare(right.request.entrypoint))
    for (const { request } of lagging) {
      findings.push(
        `${tierPhrase('claude', tiers)} '${alias}', but Claude Code ${request.ccVersion} (${request.entrypoint}) `
          + `last ran '${request.model}', behind '${newestModel.id}'`,
      )
    }
  }
  return findings
}

/**
 * explicitIdFindings covers a `claude` or `cursor` cell that spells a full Claude id, as every
 * Claude cell of the `cursor` column does, against the newest model of its family the window saw.
 */
function explicitIdFindings(
  column: 'claude' | 'cursor',
  table: ReadonlyMap<string, string>,
  requests: readonly ClaudeRequest[],
): string[] {
  const newest = newestByFamily(requests)
  const findings: string[] = []
  for (const [id, tiers] of tiersByModel(table)) {
    const parsed = parseClaudeModelId(id)
    const newestModel = parsed === undefined ? undefined : newest.get(parsed.family)
    if (parsed !== undefined && newestModel !== undefined && compareVersions(parsed.version, newestModel.version) < 0) {
      findings.push(`${tierPhrase(column, tiers)} '${id}', behind '${newestModel.id}', which this machine ran`)
    }
  }
  return findings
}

type CodexCatalog = {
  /** The Codex version that fetched the catalog, whose offer it lists. */
  clientVersion?: string
  fetchedAtMs?: number
  /** Slugs the picker shows; a hidden one is offered but never a newer choice. */
  listed: string[]
  path: string
  slugs: string[]
}

/**
 * codexFindings reports each Codex id a listed slug with the same prefix and name at a higher version
 * supersedes, however old the catalog is: whichever install fetched it, that model exists.
 */
function codexFindings(codexTable: ReadonlyMap<string, string>, catalog: CodexCatalog): string[] {
  const parsedCatalog = catalog.listed.flatMap(slug => parseCodexModelId(slug) ?? [])
  const findings: string[] = []
  for (const [id, tiers] of tiersByModel(codexTable)) {
    const parsed = parseCodexModelId(id)
    // Matched by prefix and name rather than exact id, so a replacement that renumbered the
    // version — `gpt-6-astra` to `gpt-7-astra` — is named instead of reported as missing.
    const newer = parsed === undefined ? undefined : parsedCatalog
      .filter(model =>
        model.prefix === parsed.prefix && model.name === parsed.name
        && compareVersions(model.version, parsed.version) > 0
      )
      .sort((left, right) => compareVersions(right.version, left.version))[0]
    if (newer !== undefined) {
      findings.push(`${tierPhrase('codex', tiers)} '${id}', superseded by '${newer.id}' in the installed catalog`)
    }
  }
  return findings
}

/**
 * codexMissingNotes names each Codex id a fresh catalog does not offer. It is a note rather than a
 * finding: every Codex install on the machine rewrites the one catalog with what its own version is
 * offered, so an id missing from it may be one an older install was never offered.
 */
function codexMissingNotes(codexTable: ReadonlyMap<string, string>, catalog: CodexCatalog): string[] {
  const offered = new Set(catalog.slugs)
  const fetcher = catalog.clientVersion === undefined ? 'Codex' : `Codex ${catalog.clientVersion}`
  return [...tiersByModel(codexTable)]
    .filter(([id]) => !offered.has(id))
    .map(([id, tiers]) =>
      `${tierPhrase('codex', tiers)} '${id}', missing from the catalog ${fetcher} last fetched, which every `
      + 'Codex install on this machine rewrites with its own offer'
    )
}

/** readCodexCatalog makes a missing or unreadable catalog a note: Codex writes it, not the table. */
async function readCodexCatalog(codexHome: string): Promise<{ catalog?: CodexCatalog; note?: string }> {
  const path = FS.resolvePath('models_cache.json', codexHome)
  if (!(await FS.isFile(path))) {
    return { note: `no Codex model catalog at ${path}, so the codex column was not checked` }
  }
  const parsed = Json.tryParse(await FS.readText(path))
  if (!Json.isRecord(parsed) || !Array.isArray(parsed['models'])) {
    return { note: `${path} is not a model catalog, so the codex column was not checked` }
  }
  const fetchedAtMs = typeof parsed['fetched_at'] === 'string' ? Date.parse(parsed['fetched_at']) : Number.NaN
  const models = parsed['models'].flatMap(model =>
    Json.isRecord(model) && typeof model['slug'] === 'string'
      ? [{ hidden: model['visibility'] === 'hide', slug: model['slug'] }]
      : []
  )
  return {
    catalog: {
      clientVersion: typeof parsed['client_version'] === 'string' ? parsed['client_version'] : undefined,
      fetchedAtMs: Number.isNaN(fetchedAtMs) ? undefined : fetchedAtMs,
      listed: models.filter(model => !model.hidden).map(model => model.slug),
      path,
      slugs: models.map(model => model.slug),
    },
  }
}

type TokenStats = { count: number; max: number; p50: number; p90: number }

/** tokenStats takes nearest-rank percentiles: the smallest value at or above the fraction. */
function tokenStats(values: readonly number[]): TokenStats {
  const sorted = [...values].sort((left, right) => left - right)
  const percentile = (fraction: number) => sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)] ?? 0
  return { count: sorted.length, max: sorted[sorted.length - 1] ?? 0, p50: percentile(0.5), p90: percentile(0.9) }
}

/** readAutoCompactWindow reads the budget from the canonical file the generated settings come from. */
async function readAutoCompactWindow(repoRoot: string): Promise<number | undefined> {
  const path = FS.resolvePath('.rulesync/permissions.jsonc', repoRoot)
  const parsed = await FS.isFile(path) ? Json.tryParse(Text.stripJsonc(await FS.readText(path))) : undefined
  const claudecode = Json.isRecord(parsed) ? parsed['claudecode'] : undefined
  const window = Json.isRecord(claudecode) ? claudecode['autoCompactWindow'] : undefined
  return typeof window === 'number' ? window : undefined
}

type ModelAuditInfo = {
  /** The compaction budget `.rulesync/permissions.jsonc` sets, when it sets one. */
  autoCompactWindow?: number
  /** Compactions by trigger, and the context each one began from. */
  compactions: { auto: number; manual: number; preTokens: TokenStats }
  context: {
    main: TokenStats
    /** Requests that sent more than `autoCompactWindow`, when there is one. */
    overAutoCompactWindow?: number
    subagents: TokenStats
  }
}

/** underRoots is whether a record came from a session in one of `roots` or beneath it. */
function underRoots(cwd: string, roots: readonly string[]): boolean {
  return roots.some(root => cwd === root || cwd.startsWith(`${root}/`))
}

function measureCheckout(
  activity: ClaudeActivity,
  roots: readonly string[],
  autoCompactWindow: number | undefined,
): ModelAuditInfo {
  const requests = activity.requests.filter(request => underRoots(request.cwd, roots))
  const compactions = activity.compactions.filter(compaction => underRoots(compaction.cwd, roots))
  const contextOf = (kind: TranscriptKind) =>
    tokenStats(requests.filter(request => request.kind === kind).map(request => request.contextTokens))
  return {
    autoCompactWindow,
    compactions: {
      auto: compactions.filter(compaction => compaction.trigger === 'auto').length,
      manual: compactions.filter(compaction => compaction.trigger === 'manual').length,
      preTokens: tokenStats(compactions.map(compaction => compaction.preTokens)),
    },
    context: {
      main: contextOf('main'),
      overAutoCompactWindow: autoCompactWindow === undefined
        ? undefined
        : requests.filter(request => request.contextTokens > autoCompactWindow).length,
      subagents: contextOf('subagent'),
    },
  }
}

export type ModelAuditOptions = {
  /** A one-day window, tail-only reads, and no info section: what session start can afford. */
  brief?: boolean
  /** Where this repository's sessions run; the info section counts only records from beneath them. */
  checkoutRoots: readonly string[]
  claudeDir: string
  codexHome: string
  days: number
  /** Wall-clock time, which also dates the Codex catalog. */
  nowMs: number
  repoRoot: string
  /** Where the window ends, to measure the period before a change. Ignored by `brief`. */
  untilMs?: number
}

export type ModelAuditReport = {
  findings: string[]
  /** This checkout's context and compaction measurements, absent under `brief`. */
  info?: ModelAuditInfo
  notes: string[]
  sinceIso: string
  untilIso: string
  windowDays: number
}

export async function auditModelRouting(options: ModelAuditOptions): Promise<ModelAuditReport> {
  const brief = options.brief === true
  const windowDays = brief ? BRIEF_WINDOW_DAYS : options.days
  const untilMs = brief ? options.nowMs : options.untilMs ?? options.nowMs
  const sinceMs = untilMs - windowDays * MS_PER_DAY

  const notes: string[] = []
  const skillPath = FS.resolvePath(DELEGATION_SKILL_PATH, options.repoRoot)
  const skillSource = await FS.isFile(skillPath) ? await FS.readText(skillPath) : ''
  if (skillSource === '') {
    notes.push(`${DELEGATION_SKILL_PATH} is missing or empty, so there was no routing table to audit`)
  }
  const activity = await collectClaudeActivity(options.claudeDir, sinceMs, untilMs, brief)
  const codex = await readCodexCatalog(options.codexHome)
  const codexTable = tierModels(skillSource, 'codex')
  const fetchedAtMs = codex.catalog?.fetchedAtMs
  const fresh = fetchedAtMs !== undefined && fetchedAtMs <= options.nowMs
    && options.nowMs - fetchedAtMs <= CATALOG_MAX_AGE_MS
  if (codex.note !== undefined) {
    notes.push(codex.note)
  } else if (!fresh) {
    notes.push('the Codex catalog is undated or more than three days old, so a missing codex id was not reported')
  } else if (codex.catalog !== undefined) {
    notes.push(...codexMissingNotes(codexTable, codex.catalog))
  }

  const claudeTable = tierModels(skillSource, 'claude')
  const report: ModelAuditReport = {
    findings: [
      ...(codex.catalog === undefined ? [] : codexFindings(codexTable, codex.catalog)),
      ...aliasLagFindings(claudeTable, activity.requests),
      ...explicitIdFindings('claude', claudeTable, activity.requests),
      ...explicitIdFindings('cursor', tierModels(skillSource, 'cursor'), activity.requests),
    ],
    notes,
    sinceIso: new Date(sinceMs).toISOString(),
    untilIso: new Date(untilMs).toISOString(),
    windowDays,
  }
  if (brief) {
    return report
  }
  return {
    ...report,
    info: measureCheckout(activity, options.checkoutRoots, await readAutoCompactWindow(options.repoRoot)),
  }
}
