import { Describe, Expect, Test } from '@shared/test'
import {
  createTaoJourneyReplayGate,
  replayTaoJourney,
  type TaoJourneyAdapter,
  type TaoJourneyEvent,
  type TaoJourneySelector,
} from '../TaoRuntime-src/TR-studio-journey'

Describe('Studio scenario journey replay', () => {
  Test('replays once per cell revision and starts fresh after a remount', () => {
    const mounted = createTaoJourneyReplayGate()
    Expect(mounted.shouldReplay('compile:1:cell:0')).toBe(true)
    Expect(mounted.shouldReplay('compile:1:cell:0')).toBe(false)
    Expect(mounted.shouldReplay('compile:1:cell:1')).toBe(true)
    Expect(mounted.shouldReplay('compile:1:cell:1')).toBe(false)

    const remounted = createTaoJourneyReplayGate()
    Expect(remounted.shouldReplay('compile:1:cell:1')).toBe(true)
  })

  Test('delivers phase, time, hover, and focus operations once in source order', async () => {
    const observed: string[] = []
    const targets = new Map([
      ['tag:revertSave', { id: 'button' }],
    ])
    const adapter: TaoJourneyAdapter<{ id: string }> = {
      advance(milliseconds) {
        observed.push(`advance:${milliseconds}`)
      },
      dispatch(target, event) {
        observed.push(`${event}:${target.id}`)
      },
      find(selector: TaoJourneySelector, target: string) {
        observed.push(`find:${selector}:${target}`)
        return targets.get(`${selector}:${target}`)!
      },
      settle() {
        observed.push('settle')
      },
    }

    await replayTaoJourney([
      { kind: 'pressDown', selector: 'tag', target: 'revertSave' },
      { kind: 'advance', milliseconds: 600 },
      { kind: 'pressUp', selector: 'tag', target: 'revertSave' },
      { kind: 'hover', selector: 'tag', target: 'revertSave' },
      { kind: 'focus', tag: 'revertSave' },
    ], adapter)

    Expect(observed).toEqual([
      'find:tag:revertSave',
      'pressDown:button',
      'settle',
      'advance:600',
      'settle',
      'find:tag:revertSave',
      'pressUp:button',
      'settle',
      'find:tag:revertSave',
      'hover:button',
      'settle',
      'find:tag:revertSave',
      'focus:button',
      'settle',
    ])
  })

  Test('waits for an asynchronous event before settling and continuing', async () => {
    const observed: string[] = []
    let release: (() => void) | undefined
    const pending = new Promise<void>(resolve => {
      release = resolve
    })
    const adapter: TaoJourneyAdapter<string> = {
      advance: () => {},
      async dispatch(_target: string, event: TaoJourneyEvent) {
        observed.push(event)
        await pending
      },
      find: () => 'target',
      settle: () => {
        observed.push('settled')
      },
    }

    const replay = replayTaoJourney([
      { kind: 'pressDown', selector: 'tag', target: 'one' },
      { kind: 'pressUp', selector: 'tag', target: 'one' },
    ], adapter)
    await Promise.resolve()
    Expect(observed).toEqual(['pressDown'])
    release!()
    await replay
    Expect(observed).toEqual(['pressDown', 'settled', 'pressUp', 'settled'])
  })
})
