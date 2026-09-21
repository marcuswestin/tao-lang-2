import { FS, Json } from '@shared'

/** Where the hooks in .rulesync/hooks.jsonc write one file per delegation event. */
export const DELEGATION_EVENTS_PATH = '.artifacts/delegation/events'

/** What a caller left to the harness instead of naming, reported rather than guessed at. */
export const UNNAMED_MODEL = 'inherited'

type ProfileSummary = {
  profile: string
  spawns: number
  /** Models the caller named for this profile, most used first; `inherited` is counted separately. */
  models: string[]
  unnamedModels: number
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
export function summarizeDelegationLog(content: string): DelegationSummary {
  const profiles = new Map<string, ProfileTally>()
  const startedAt = new Map<string, { profile: string; timeMs: number }>()
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
    profile,
    spawns: counts.spawns,
    unnamedModels: counts.unnamedModels,
  }
}

/** readDelegationLog returns an empty summary when nothing has been logged yet. */
export async function readDelegationLog(root: string): Promise<DelegationSummary> {
  const directory = FS.resolvePath(DELEGATION_EVENTS_PATH, root)
  if (!(await FS.isDirectory(directory))) {
    return summarizeDelegationLog('')
  }
  const records: string[] = []
  for (const name of await FS.listDir(directory)) {
    if (name.endsWith('.json')) {
      records.push(await FS.readText(FS.resolvePath(name, directory)))
    }
  }
  return summarizeDelegationLog(records.join('\n'))
}
