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
    Expect(mounted.beginReplay('compile:1:cell:0')).toBe(true)
    Expect(mounted.beginReplay('compile:1:cell:0')).toBe(false)
    mounted.completeReplay('compile:1:cell:0')
    Expect(mounted.beginReplay('compile:1:cell:0')).toBe(false)
    Expect(mounted.beginReplay('compile:1:cell:1')).toBe(true)
    mounted.completeReplay('compile:1:cell:1')
    Expect(mounted.beginReplay('compile:1:cell:1')).toBe(false)

    const remounted = createTaoJourneyReplayGate()
    Expect(remounted.beginReplay('compile:1:cell:1')).toBe(true)
  })

  Test('admits the same revision again after a failed replay', () => {
    const gate = createTaoJourneyReplayGate()

    Expect(gate.beginReplay('compile:1:cell:0')).toBe(true)
    gate.failReplay('compile:1:cell:0')
    Expect(gate.beginReplay('compile:1:cell:0')).toBe(true)
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
      select: () => ({ id: 'selected' }),
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
      select: () => 'selected',
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

  Test('scopes nested selected-row interactions and preserves complete input operations', async () => {
    const observed: string[] = []
    const adapter: TaoJourneyAdapter<string> = {
      advance: () => {},
      dispatch(target, event, value) {
        observed.push([event, target, value].filter(part => part !== undefined).join(':'))
      },
      find(selector, target, scope) {
        return `${scope ?? 'root'}/${selector}:${target}`
      },
      select(tag, index, scope) {
        return `${scope ?? 'root'}/${tag}[${index}]`
      },
      settle() {},
    }

    await replayTaoJourney([{
      index: 2,
      kind: 'select',
      steps: [
        { kind: 'press', selector: 'tag', target: 'open' },
        { kind: 'enter', selector: 'label', target: 'Name', value: 'Tao' },
        { kind: 'submit', selector: 'label', target: 'Name' },
      ],
      tag: 'rows',
    }], adapter)

    Expect(observed).toEqual([
      'press:root/rows[2]/tag:open',
      'enter:root/rows[2]/label:Name:Tao',
      'submit:root/rows[2]/label:Name',
    ])
  })
})
