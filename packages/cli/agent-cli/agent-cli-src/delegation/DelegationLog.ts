import { FS, Json } from '@shared'
import { parseAgentFrontmatter, SUBAGENTS_DIRECTORY } from './DelegationProfiles'

/** Where the hooks in .rulesync/hooks.jsonc write one file per delegation event. */
export const DELEGATION_EVENTS_PATH = '.artifacts/delegation/events'

/** What a caller left to the harness instead of naming, reported rather than guessed at. */
export const UNNAMED_MODEL = 'unknown'

type SelectionSource = 'explicit' | 'profile default' | 'harness default' | 'inherited' | 'unknown'

type ModelEvidence = {
  /** Current profile pins establish a source, not the resolved historical model. */
  profilePins?: ReadonlySet<string>
  /** Agent ID to resolved model, extracted only from supported hook fields or bounded metadata. */
  observedByAgent?: ReadonlyMap<string, string>
}

type ProfileSummary = {
  profile: string
  spawns: number
  /** Explicit models named at spawn, most used first; unnamed selections are classified separately. */
  models: string[]
  unnamedModels: number
  observedModels: string[]
  selections: Record<SelectionSource, number>
  /** Effort levels the subagents actually ran at, which only a stop event reports. */
  efforts: string[]
  completed: number
  medianMs?: number
  longestMs?: number
}

export type DelegationSummary = {
  spawns: number
  completed: number
  unnamedModels: number
  firstTime?: string
  lastTime?: string
  profiles: ProfileSummary[]
  /** Lines the reader could not parse; a truncated payload produces one, and it is not an error. */
  unreadableLines: number
}

type ProfileTally = {
  spawns: number
  models: Map<string, number>
  unnamedModels: number
  efforts: Map<string, number>
  observedModels: Map<string, number>
  selections: Record<SelectionSource, number>
  durationsMs: number[]
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return Json.isRecord(value) ? value : undefined
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function tally(profiles: Map<string, ProfileTally>, profile: string): ProfileTally {
  const existing = profiles.get(profile)
  if (existing !== undefined) {
    return existing
  }
  const created: ProfileTally = {
    durationsMs: [],
    efforts: new Map(),
    models: new Map(),
    observedModels: new Map(),
    selections: { explicit: 0, 'profile default': 0, 'harness default': 0, inherited: 0, unknown: 0 },
    spawns: 0,
    unnamedModels: 0,
  }
  profiles.set(profile, created)
  return created
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
}

/**
 * summarizeDelegationLog folds the log into one row per profile. It reconciles two kinds of event
 * that no harness emits together: the spawning tool call, which alone knows the model and the
 * brief, and the subagent's own start and stop, which alone carry the id that bounds a duration.
 * Effort is read only from a stop event, where it describes the subagent that just finished; the
 * same field on a spawn belongs to the caller, which has not started the subagent yet.
 */
export function summarizeDelegationLog(content: string, evidence: ModelEvidence = {}): DelegationSummary {
  const profiles = new Map<string, ProfileTally>()
  const startedAt = new Map<string, { profile: string; timeMs: number }>()
  const observedAtStart = new Set<string>()
  const times: string[] = []
  let spawns = 0
  let completed = 0
  let unnamedModels = 0
  let unreadableLines = 0

  for (const line of content.split('\n')) {
    if (line.trim() === '') {
      continue
    }
    let entry: Record<string, unknown> | undefined
    try {
      entry = asRecord(JSON.parse(line))
    } catch {
      entry = undefined
    }
    if (entry === undefined) {
      unreadableLines += 1
      continue
    }
    const time = asText(entry['time'])
    const payload = asRecord(entry['payload']) ?? {}
    if (time !== undefined) {
      times.push(time)
    }

    if (entry['event'] === 'spawn') {
      const input = asRecord(payload['tool_input']) ?? {}
      const profile = tally(profiles, asText(input['subagent_type']) ?? 'unknown')
      profile.spawns += 1
      spawns += 1
      const model = asText(input['model'])
      const source = selectionSource(asText(input['subagent_type']), model, evidence.profilePins)
      profile.selections[source] += 1
      if (model === undefined) {
        profile.unnamedModels += 1
        unnamedModels += 1
      } else {
        profile.models.set(model, (profile.models.get(model) ?? 0) + 1)
      }
      continue
    }

    const agentId = asText(payload['agent_id'])
    const agentType = asText(payload['agent_type']) ?? 'unknown'
    const timeMs = time === undefined ? Number.NaN : Date.parse(time)
    if (agentId === undefined || Number.isNaN(timeMs)) {
      continue
    }
    if (entry['event'] === 'start') {
      startedAt.set(agentId, { profile: agentType, timeMs })
      const observed = asText(payload['model']) ?? evidence.observedByAgent?.get(agentId)
      if (observed !== undefined) {
        const started = tally(profiles, agentType)
        started.observedModels.set(observed, (started.observedModels.get(observed) ?? 0) + 1)
        observedAtStart.add(agentId)
      }
      continue
    }
    if (entry['event'] !== 'stop') {
      continue
    }
    const start = startedAt.get(agentId)
    if (start === undefined) {
      continue
    }
    startedAt.delete(agentId)
    completed += 1
    const stopped = tally(profiles, start.profile)
    const observed = evidence.observedByAgent?.get(agentId)
    if (observed !== undefined && !observedAtStart.has(agentId)) {
      stopped.observedModels.set(observed, (stopped.observedModels.get(observed) ?? 0) + 1)
    }
    stopped.durationsMs.push(Math.max(0, timeMs - start.timeMs))
    const effort = asText(asRecord(payload['effort'])?.['level'])
    if (effort !== undefined) {
      stopped.efforts.set(effort, (stopped.efforts.get(effort) ?? 0) + 1)
    }
  }

  const sortedTimes = [...times].sort()
  return {
    completed,
    firstTime: sortedTimes[0],
    lastTime: sortedTimes[sortedTimes.length - 1],
    profiles: [...profiles.entries()]
      .map(([profile, counts]) => summarizeProfile(profile, counts))
      .sort((left, right) => right.spawns - left.spawns || left.profile.localeCompare(right.profile)),
    spawns,
    unnamedModels,
    unreadableLines,
  }
}

function selectionSource(
  profile: string | undefined,
  explicit: string | undefined,
  pins?: ReadonlySet<string>,
): SelectionSource {
  if (explicit !== undefined) {
    return 'explicit'
  }
  if (profile !== undefined && pins?.has(profile)) {
    return 'profile default'
  }
  if (profile === 'general-purpose' || profile === 'claude') {
    return 'harness default'
  }
  if (profile === 'Explore' || profile === 'Plan') {
    return 'inherited'
  }
  return 'unknown'
}

function summarizeProfile(profile: string, counts: ProfileTally): ProfileSummary {
  const durations = counts.durationsMs
  const byUse = (left: [string, number], right: [string, number]) =>
    right[1] - left[1] || left[0].localeCompare(right[0])
  return {
    completed: durations.length,
    efforts: [...counts.efforts.entries()].sort(byUse).map(([effort]) => effort),
    longestMs: durations.length === 0 ? undefined : Math.max(...durations),
    medianMs: durations.length === 0 ? undefined : median(durations),
    models: [...counts.models.entries()].sort(byUse).map(([model]) => model),
    observedModels: [...counts.observedModels.entries()].sort(byUse).map(([model]) => model),
    profile,
    selections: { ...counts.selections },
    spawns: counts.spawns,
    unnamedModels: counts.unnamedModels,
  }
}

/** readDelegationLog returns an empty summary when nothing has been logged yet. */
export async function readDelegationLog(root: string, limit?: number): Promise<DelegationSummary> {
  const directory = FS.resolvePath(DELEGATION_EVENTS_PATH, root)
  if (!(await FS.isDirectory(directory))) {
    return summarizeDelegationLog('')
  }
  const names = (await FS.listDir(directory)).filter(name => name.endsWith('.json')).sort()
  const selected = limit === undefined ? names : names.slice(-limit)
  const records = await Promise.all(selected.map(name => FS.readText(FS.resolvePath(name, directory))))
  records.sort((left, right) => {
    const a = eventSortKey(left)
    const b = eventSortKey(right)
    return a.time.localeCompare(b.time) || a.rank - b.rank
  })
  const pins = await currentProfilePins(root)
  const observedByAgent = new Map<string, string>()
  for (const record of records.filter(record => record.includes('"event":"stop"')).slice(-32)) {
    try {
      const payload = asRecord(asRecord(JSON.parse(record))?.['payload'])
      const agentId = asText(payload?.['agent_id'])
      const path = asText(payload?.['agent_transcript_path'])
      if (
        agentId === undefined || path === undefined || !path.includes('/subagents/agent-') || !path.endsWith('.jsonl')
      ) {
        continue
      }
      const model = await transcriptModel(path)
      if (model !== undefined) {
        observedByAgent.set(agentId, model)
      }
    } catch {
      // Missing or changed transcript metadata is not evidence of a model mismatch.
    }
  }
  return summarizeDelegationLog(records.join('\n'), { observedByAgent, profilePins: pins })
}

function eventSortKey(record: string): { time: string; rank: number } {
  try {
    const entry = asRecord(JSON.parse(record))
    const event = asText(entry?.['event'])
    return { time: asText(entry?.['time']) ?? '', rank: event === 'spawn' ? 0 : event === 'start' ? 1 : 2 }
  } catch {
    return { time: '', rank: 3 }
  }
}

/**
 * currentProfilePins names the profiles that pin a Claude Code model. Only Claude Code's `Agent`
 * tool reaches the spawn hook, so a Codex pin says nothing about a logged spawn; most profiles leave
 * Codex on its `[agents]` default and would otherwise read as an unknown selection.
 */
async function currentProfilePins(root: string): Promise<Set<string>> {
  const directory = FS.resolvePath(SUBAGENTS_DIRECTORY, root)
  const pins = new Set<string>()
  if (!await FS.isDirectory(directory)) {
    return pins
  }
  for (const name of await FS.listDir(directory)) {
    if (!name.endsWith('.md')) {
      continue
    }
    const document = parseAgentFrontmatter(name, await FS.readText(FS.resolvePath(name, directory)))
    if (document.name !== undefined && document.sections['claudecode']?.['model'] !== undefined) {
      pins.add(document.name)
    }
  }
  return pins
}

/** Only the first 256 KiB and 32 JSONL records are inspected; message content is never returned. */
async function transcriptModel(path: string): Promise<string | undefined> {
  const prefix = await FS.readTextPrefix(path, 256 * 1024)
  for (const line of prefix.split('\n').slice(0, 32)) {
    try {
      const record = asRecord(JSON.parse(line))
      if (record?.['type'] !== 'assistant') {
        continue
      }
      const model = asText(asRecord(record['message'])?.['model'])
      if (model !== undefined) {
        return model
      }
    } catch {
      // A partial last line or a changed transcript shape leaves the model unknown.
    }
  }
  return undefined
}
