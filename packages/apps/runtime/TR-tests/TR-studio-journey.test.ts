import { Describe, Expect, Test } from '@shared/test'
import {
  createTaoJourneyReplayGate,
  replayTaoJourney,
  type TaoJourneyAdapter,
  type TaoJourneyEvent,
  type TaoJourneySelector,
  waitForTaoJourneyTarget,
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

  Test('waits for asynchronous target acquisition before dispatching', async () => {
    const observed: string[] = []
    let release: ((target: string) => void) | undefined
    const pending = new Promise<string>(resolve => {
      release = resolve
    })
    const adapter: TaoJourneyAdapter<string> = {
      advance: () => {},
      dispatch(target, event) {
        observed.push(`${event}:${target}`)
      },
      find: () => pending,
      select: () => 'selected',
      settle: () => {},
    }

    const replay = replayTaoJourney([{ kind: 'press', selector: 'tag', target: 'later' }], adapter)
    await Promise.resolve()
    Expect(observed).toEqual([])
    release!('appeared')
    await replay
    Expect(observed).toEqual(['press:appeared'])
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

  Test('re-resolves a selected row before every nested step', async () => {
    const observed: string[] = []
    let generation = 1
    const adapter: TaoJourneyAdapter<string> = {
      advance: () => {},
      dispatch(target, event) {
        observed.push(`${event}:${target}`)
      },
      find(_selector, target, scope) {
        return `${scope}/${target}`
      },
      select(tag, index) {
        observed.push(`select:${tag}:${index}:generation-${generation}`)
        return `row-${generation}`
      },
      settle() {
        generation += 1
      },
    }

    await replayTaoJourney([{
      index: 1,
      kind: 'select',
      steps: [
        { kind: 'press', selector: 'tag', target: 'rename' },
        { kind: 'press', selector: 'tag', target: 'save' },
      ],
      tag: 'rows',
    }], adapter)

    Expect(observed).toEqual([
      'select:rows:1:generation-1',
      'press:row-1/rename',
      'select:rows:1:generation-2',
      'press:row-2/save',
    ])
  })

  Test('accepts the fractional millisecond advance the Tao validator accepts', async () => {
    const observed: number[] = []
    const adapter: TaoJourneyAdapter<string> = {
      advance: milliseconds => {
        observed.push(milliseconds)
      },
      dispatch: () => {},
      find: () => 'target',
      select: () => 'selected',
      settle: () => {},
    }

    await replayTaoJourney([{ kind: 'advance', milliseconds: 0.5 }], adapter)

    Expect(observed).toEqual([0.5])
  })

  Test('interrupts target polling as soon as a replacement replay aborts it', async () => {
    const abort = new AbortController()
    const pending = waitForTaoJourneyTarget(() => undefined, 10_000, abort.signal)

    abort.abort()

    await Expect(pending).rejects.toThrow('superseded before it finished')
  })
})
