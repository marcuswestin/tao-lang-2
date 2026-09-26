import { CLI, FS } from '@shared'

/** Local task metadata is evidence of an association, not proof that an absent task is gone. */
export type ThreadAssociation = {
  createdAt?: string
  description: string
  id: string
  label?: string
  lastActivity?: string
  lastActivityAt?: string
  provider: 'Codex' | 'Claude Code'
  title: string
}

export type ThreadAssociationInventory = {
  byPath: ReadonlyMap<string, readonly ThreadAssociation[]>
  coverage: readonly string[]
}

type CodexThread = {
  archived: number
  created_at: number
  cwd: string
  description: string
  id: string
  label: string | null
  title: string
  updated_at: number
}

type CodexActivity = { at: number | null; agent_text: string | null; user_text: string | null }

const DESCRIPTION_LIMIT = 240

export async function discoverThreadAssociations(paths: readonly string[]): Promise<ThreadAssociationInventory> {
  const byPath = new Map(paths.map(path => [path, [] as ThreadAssociation[]]))
  const coverage: string[] = []
  await addCodexThreads(byPath, coverage)
  await addClaudeSessions(byPath, coverage)
  coverage.push(
    'Cursor task titles and descriptions require an app check; local workspace records do not prove a task association.',
  )
  return { byPath, coverage }
}

async function addCodexThreads(byPath: Map<string, ThreadAssociation[]>, coverage: string[]): Promise<void> {
  const home = FS.resolvePath('.codex', FS.homeDir())
  const state = FS.resolvePath('state_5.sqlite', home)
  const history = FS.resolvePath('thread_history_1.sqlite', home)
  if (!await FS.isFile(state)) {
    coverage.push('Codex task database unavailable; Codex associations are unknown.')
    return
  }
  const query = `SELECT t.id, t.cwd, COALESCE(NULLIF(t.name,''), t.title) AS title,
    SUBSTR(COALESCE(NULLIF(t.first_user_message,''), t.preview),1,${DESCRIPTION_LIMIT * 3}) AS description,
    t.created_at, t.updated_at, t.archived, s.name AS label
    FROM threads t LEFT JOIN thread_sections s ON s.id=t.thread_section_id
    WHERE t.thread_source='user' AND t.archived=0`
  const threads = await sqliteRows<CodexThread>(state, query)
  if (threads === undefined) {
    coverage.push('Codex task database could not be read; Codex associations are unknown.')
    return
  }
  coverage.push(
    'Unarchived Codex primary tasks read from the local task database; app summaries and metadata may be newer.',
  )
  for (const thread of threads) {
    const associations = byPath.get(thread.cwd)
    if (associations === undefined) {
      continue
    }
    const activity = await readCodexActivity(history, thread.id)
    associations.push({
      createdAt: isoSeconds(thread.created_at),
      description: compact(thread.description),
      id: thread.id,
      label: thread.label ?? 'Tasks',
      lastActivity: activity?.user_text
        ? `User: ${compact(activity.user_text)}`
        : activity?.agent_text
        ? `Agent: ${compact(activity.agent_text)}`
        : undefined,
      lastActivityAt: activity?.at === null || activity?.at === undefined
        ? undefined
        : isoSeconds(activity.at),
      provider: 'Codex',
      title: compact(thread.title),
    })
  }
}

async function readCodexActivity(database: string, id: string): Promise<CodexActivity | undefined> {
  if (!await FS.isFile(database) || !/^[0-9a-f-]{36}$/u.test(id)) {
    return undefined
  }
  const rows = await sqliteRows<CodexActivity>(
    database,
    `
    SELECT turn.completed_at AS at,
      (SELECT SUBSTR(json_extract(item_json,'$.content[0].text'),1,${DESCRIPTION_LIMIT * 3})
       FROM thread_items WHERE thread_id=turn.thread_id AND turn_id=turn.turn_id
       AND item_type='userMessage' ORDER BY rollout_ordinal DESC LIMIT 1) AS user_text,
      (SELECT SUBSTR(json_extract(item_json,'$.text'),1,${DESCRIPTION_LIMIT * 3})
       FROM thread_items WHERE thread_id=turn.thread_id AND turn_id=turn.turn_id
       AND item_type='agentMessage' AND json_extract(item_json,'$.phase')='final_answer'
       ORDER BY rollout_ordinal DESC LIMIT 1) AS agent_text
    FROM thread_turns turn WHERE turn.thread_id='${id}'
    ORDER BY turn.rollout_ordinal DESC LIMIT 1`,
  )
  return rows?.[0]
}

async function sqliteRows<T>(database: string, query: string): Promise<T[] | undefined> {
  const result = await CLI.run('sqlite3', { args: ['-readonly', '-json', database, query], stdio: 'pipe' })
  if (result.error !== undefined || result.exitCode !== 0) {
    return undefined
  }
  try {
    const rows: unknown = JSON.parse(result.stdout.trim() || '[]')
    return Array.isArray(rows) ? rows as T[] : undefined
  } catch {
    return undefined
  }
}

async function addClaudeSessions(byPath: Map<string, ThreadAssociation[]>, coverage: string[]): Promise<void> {
  const projects = FS.resolvePath('.claude/projects', FS.homeDir())
  if (!await FS.isDirectory(projects)) {
    coverage.push('Claude Code project history unavailable; Claude associations are unknown.')
    return
  }
  coverage.push(
    'Claude Code sessions read from local project history; archival state and cloud-only sessions need an app check.',
  )
  for (const [path, associations] of byPath) {
    const project = FS.resolvePath(path.replace(/[^a-zA-Z0-9]/gu, '-'), projects)
    if (!await FS.isDirectory(project)) {
      continue
    }
    for (const entry of await FS.listDir(project)) {
      if (!/^[0-9a-f-]{36}\.jsonl$/u.test(entry)) {
        continue
      }
      const id = entry.slice(0, -'.jsonl'.length)
      const file = FS.resolvePath(entry, project)
      const titleFile = FS.resolvePath(`${id}/custom-title.json`, project)
      const custom = await FS.readJson<{ customTitle?: string }>(titleFile).catch(() => undefined)
      const prefix = await FS.readTextPrefix(file, 256_000).catch(() => '')
      const first = firstClaudeUserMessage(prefix)
      const modified = await FS.modifiedTimeMs(file).catch(() => undefined)
      associations.push({
        createdAt: first.timestamp,
        description: first.text ?? 'First user message unavailable in the local session prefix.',
        id,
        lastActivity: 'Session file modified; inspect the Claude task for the last conversation turn.',
        lastActivityAt: modified === undefined ? undefined : new Date(modified).toISOString(),
        provider: 'Claude Code',
        title: compact(custom?.customTitle ?? first.text ?? 'Untitled Claude session'),
      })
    }
  }
}

function firstClaudeUserMessage(prefix: string): { text?: string; timestamp?: string } {
  for (const line of prefix.split('\n').slice(0, -1)) {
    let record: { type?: string; timestamp?: string; message?: { content?: unknown }; isSidechain?: boolean }
    try {
      record = JSON.parse(line) as typeof record
    } catch {
      continue
    }
    if (record.type !== 'user' || record.isSidechain === true) {
      continue
    }
    const content = record.message?.content
    const text = typeof content === 'string'
      ? content
      : Array.isArray(content)
      ? content.find(item => item?.type === 'text')?.text
      : undefined
    if (typeof text === 'string' && text.trim()) {
      return { text: compact(text), timestamp: record.timestamp }
    }
  }
  return {}
}

function isoSeconds(seconds: number): string {
  return new Date(seconds * 1_000).toISOString()
}

function compact(value: string): string {
  const oneLine = value.replace(/\\[nt]/gu, ' ')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gu, ' ')
    .replace(/<\/?(?:command-message|command-name|command-args)>/gu, ' ')
    .replace(/\s+/gu, ' ').trim()
  return oneLine.length <= DESCRIPTION_LIMIT ? oneLine : `${oneLine.slice(0, DESCRIPTION_LIMIT - 1)}…`
}
