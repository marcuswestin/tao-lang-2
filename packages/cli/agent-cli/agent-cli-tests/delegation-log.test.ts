import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import {
  DELEGATION_EVENTS_PATH,
  readDelegationLog,
  summarizeDelegationLog,
} from '../agent-cli-src/delegation/DelegationLog'

function logLine(event: string, time: string, payload: unknown): string {
  return JSON.stringify({ event, payload, time })
}

const spawn = (profile: string, model?: string) => ({
  tool_input: { description: `work for ${profile}`, subagent_type: profile, ...(model === undefined ? {} : { model }) },
})

Describe('delegation log', () => {
  Test('counts one row per profile and keeps the models a caller named', () => {
    const summary = summarizeDelegationLog([
      logLine('spawn', '2026-09-17T10:00:00Z', spawn('scout', 'sonnet')),
      logLine('spawn', '2026-09-17T10:01:00Z', spawn('scout', 'haiku')),
      logLine('spawn', '2026-09-17T10:02:00Z', spawn('reviewer', 'opus')),
    ].join('\n'))

    Expect(summary.spawns).toEqual(3)
    Expect(summary.profiles.map(profile => profile.profile)).toEqual(['scout', 'reviewer'])
    Expect(summary.profiles[0]?.models).toEqual(['haiku', 'sonnet'])
    Expect(summary.firstTime).toEqual('2026-09-17T10:00:00Z')
    Expect(summary.lastTime).toEqual('2026-09-17T10:02:00Z')
  })

  Test('keeps an unnamed spawn unknown when no default is established', () => {
    const summary = summarizeDelegationLog(logLine('spawn', '2026-09-17T10:00:00Z', spawn('reviewer')))

    Expect(summary.unnamedModels).toEqual(1)
    Expect(summary.profiles[0]?.models).toEqual([])
    Expect(summary.profiles[0]?.unnamedModels).toEqual(1)
    Expect(summary.profiles[0]?.selections.unknown).toEqual(1)
    Expect(summary.profiles[0]?.observedModels).toEqual([])
  })

  Test('distinguishes explicit, pinned profile, harness default, and built-in inheritance', () => {
    const summary = summarizeDelegationLog(
      [
        logLine('spawn', '2026-09-17T10:00:00Z', spawn('reviewer', 'gpt-6-astra')),
        logLine('spawn', '2026-09-17T10:01:00Z', spawn('reviewer')),
        logLine('spawn', '2026-09-17T10:02:00Z', spawn('general-purpose')),
        logLine('spawn', '2026-09-17T10:03:00Z', spawn('Explore')),
        logLine('start', '2026-09-17T10:03:01Z', { agent_id: 'a1', agent_type: 'Explore', model: 'claude-opus-5' }),
      ].join('\n'),
      { profilePins: new Set(['reviewer']) },
    )

    Expect(summary.profiles.find(profile => profile.profile === 'reviewer')?.selections).toEqual({
      explicit: 1,
      'profile default': 1,
      'harness default': 0,
      inherited: 0,
      unknown: 0,
    })
    Expect(summary.profiles.find(profile => profile.profile === 'general-purpose')?.selections['harness default'])
      .toEqual(1)
    Expect(summary.profiles.find(profile => profile.profile === 'Explore')?.selections.inherited).toEqual(1)
  })

  Test('times a delegation only when its start and stop share an agent id', () => {
    const summary = summarizeDelegationLog([
      logLine('start', '2026-09-17T10:00:00Z', { agent_id: 'a1', agent_type: 'scout' }),
      logLine('stop', '2026-09-17T10:00:30Z', { agent_id: 'a1', agent_type: 'scout' }),
      logLine('start', '2026-09-17T10:01:00Z', { agent_id: 'a2', agent_type: 'scout' }),
      logLine('stop', '2026-09-17T10:05:00Z', { agent_id: 'a2', agent_type: 'scout' }),
      logLine('stop', '2026-09-17T10:09:00Z', { agent_id: 'unmatched', agent_type: 'scout' }),
    ].join('\n'))

    Expect(summary.completed).toEqual(2)
    Expect(summary.profiles[0]).toMatchObject({ completed: 2, longestMs: 240_000, medianMs: 135_000, profile: 'scout' })
  })

  Test('takes the profile of a stop from its start, because a stop can carry an empty type', () => {
    const summary = summarizeDelegationLog([
      logLine('start', '2026-09-17T10:00:00Z', { agent_id: 'a1', agent_type: 'reviewer' }),
      logLine('stop', '2026-09-17T10:02:00Z', { agent_id: 'a1', agent_type: '', effort: { level: 'xhigh' } }),
    ].join('\n'))

    Expect(summary.profiles.map(entry => entry.profile)).toEqual(['reviewer'])
    Expect(summary.profiles[0]?.efforts).toEqual(['xhigh'])
  })

  Test('reads effort from a stop and never from a spawn, where it belongs to the caller', () => {
    const summary = summarizeDelegationLog([
      logLine('spawn', '2026-09-17T10:00:00Z', { ...spawn('oracle', 'opus'), effort: { level: 'high' } }),
      logLine('start', '2026-09-17T10:00:01Z', { agent_id: 'a1', agent_type: 'oracle' }),
      logLine('stop', '2026-09-17T10:00:41Z', { agent_id: 'a1', agent_type: 'oracle', effort: { level: 'xhigh' } }),
    ].join('\n'))

    Expect(summary.profiles[0]?.efforts).toEqual(['xhigh'])
  })

  Test('counts an unreadable line instead of failing the whole report', () => {
    const summary = summarizeDelegationLog([
      'not json at all',
      logLine('spawn', '2026-09-17T10:00:00Z', spawn('scout', 'sonnet')),
      '',
    ].join('\n'))

    Expect(summary.unreadableLines).toEqual(1)
    Expect(summary.spawns).toEqual(1)
  })

  Test('reports nothing for an empty log', () => {
    Expect(summarizeDelegationLog('')).toEqual({
      completed: 0,
      firstTime: undefined,
      lastTime: undefined,
      profiles: [],
      spawns: 0,
      unnamedModels: 0,
      unreadableLines: 0,
    })
  })

  Test('reads a directory of one file per event, which is how the hooks avoid interleaving', async () => {
    const directory = await FS.mkTmpDir('delegation-events')
    const events = FS.resolvePath(`${DELEGATION_EVENTS_PATH}`, directory)
    await FS.mkdir(events)
    await FS.writeText(
      FS.resolvePath('a-spawn.json', events),
      logLine('spawn', '2026-09-17T10:00:00Z', spawn('scout', 'haiku')),
    )
    await FS.writeText(
      FS.resolvePath('b-start.json', events),
      logLine('start', '2026-09-17T10:00:00Z', { agent_id: 'a1', agent_type: 'scout' }),
    )
    await FS.writeText(
      FS.resolvePath('c-stop.json', events),
      logLine('stop', '2026-09-17T10:00:10Z', { agent_id: 'a1', agent_type: 'scout' }),
    )
    await FS.writeText(FS.resolvePath('ignored.txt', events), 'not an event file')

    const summary = await readDelegationLog(directory)

    Expect(summary.spawns).toEqual(1)
    Expect(summary.completed).toEqual(1)
    Expect(summary.profiles[0]).toMatchObject({ longestMs: 10_000, models: ['haiku'], profile: 'scout' })
  })

  Test('reads all event files and orders same-second starts before stops', async () => {
    const root = await FS.mkTmpDir('delegation-history')
    const events = FS.resolvePath(DELEGATION_EVENTS_PATH, root)
    await FS.mkdir(events)
    for (let index = 0; index < 260; index += 1) {
      await FS.writeText(
        FS.resolvePath(`${String(index).padStart(3, '0')}-spawn.json`, events),
        logLine('spawn', '2026-09-17T10:00:00Z', spawn('scout')),
      )
    }
    await FS.writeText(
      FS.resolvePath('z-start.json', events),
      logLine('start', '2026-09-17T10:00:00Z', { agent_id: 'a1', agent_type: 'scout' }),
    )
    await FS.writeText(
      FS.resolvePath('a-stop.json', events),
      logLine('stop', '2026-09-17T10:00:00Z', { agent_id: 'a1', agent_type: 'scout' }),
    )

    const summary = await readDelegationLog(root)
    Expect(summary.spawns).toEqual(260)
    Expect(summary.completed).toEqual(1)
  })

  Test('extracts a resolved model from bounded transcript metadata and tolerates a missing file', async () => {
    const root = await FS.mkTmpDir('delegation-models')
    const events = FS.resolvePath(DELEGATION_EVENTS_PATH, root)
    const transcript = FS.resolvePath('subagents/agent-a1.jsonl', root)
    await FS.mkdir(events)
    await FS.mkdir(FS.resolvePath('subagents', root))
    await FS.writeText(
      transcript,
      [
        JSON.stringify({ type: 'user', message: { content: 'ignored' } }),
        JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5-5', content: 'ignored' } }),
      ].join('\n'),
    )
    await FS.writeText(
      FS.resolvePath('a-start.json', events),
      logLine('start', '2026-09-17T10:00:00Z', { agent_id: 'a1', agent_type: 'reviewer' }),
    )
    await FS.writeText(
      FS.resolvePath('b-stop.json', events),
      logLine('stop', '2026-09-17T10:00:01Z', {
        agent_id: 'a1',
        agent_type: 'reviewer',
        agent_transcript_path: transcript,
      }),
    )
    await FS.writeText(
      FS.resolvePath('c-stop.json', events),
      logLine('stop', '2026-09-17T10:00:02Z', {
        agent_id: 'missing',
        agent_type: 'reviewer',
        agent_transcript_path: FS.resolvePath('subagents/agent-missing.jsonl', root),
      }),
    )

    const summary = await readDelegationLog(root)
    Expect(summary.profiles[0]?.observedModels).toEqual(['claude-opus-5-5'])
  })
})
