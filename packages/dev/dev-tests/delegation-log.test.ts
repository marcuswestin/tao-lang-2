import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { DELEGATION_EVENTS_PATH, readDelegationLog, summarizeDelegationLog } from '../dev-src/delegation/DelegationLog'

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

  Test('reports a spawn that named no model as inherited rather than guessing one', () => {
    const summary = summarizeDelegationLog(logLine('spawn', '2026-09-17T10:00:00Z', spawn('reviewer')))

    Expect(summary.unnamedModels).toEqual(1)
    Expect(summary.profiles[0]?.models).toEqual([])
    Expect(summary.profiles[0]?.unnamedModels).toEqual(1)
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
})
