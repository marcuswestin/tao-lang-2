import { expect, test } from '@playwright/test'
import {
  createHostTestEnvironment,
  type HostTestClock,
  HostTestControlError,
} from '@runtime/host-testing'
import { installRuntimeHostTestControl } from '@runtime/host-testing/RuntimeHostTestControl'
import { Clock } from '@runtime/TR-units'
import { Effects } from '@shared'
import * as RuntimeEffects from '@tao/runtime/core'

test('Clockwork host environments have independent same-process clocks and known random streams', () => {
  const firstClock = ownedClock()
  const secondClock = ownedClock()
  expect(Effects.createSession).toBe(RuntimeEffects.createSession)
  const first = Effects.createSession({ runId: 'first-run', seed: 123_456_789, epochMs: 1_000 }, firstClock.port)
  const second = createHostTestEnvironment({ runId: 'second-run', seed: 7, epochMs: 8_000 }, secondClock.port)

  expect([
    first.chooseRandom('first-run', 100),
    first.chooseRandom('first-run', 100),
    first.chooseRandom('first-run', 100),
  ]).toEqual([21, 87, 52])
  expect(first.advance('first-run', 250)).toMatchObject({ wallMs: 1_250, monotonicMs: 250 })
  expect(second.snapshot()).toMatchObject({ wallMs: 8_000, monotonicMs: 0 })
  expect(second.advance('second-run', 20)).toMatchObject({ wallMs: 8_020, monotonicMs: 20 })
  expect(first.snapshot()).toMatchObject({ wallMs: 1_250, monotonicMs: 250 })

  first.dispose()
  second.dispose()
  expect(firstClock.endCount()).toBe(1)
  expect(secondClock.endCount()).toBe(1)
})

test('Clockwork rejects foreign or invalid controls without moving its clock, then closes it', () => {
  const clock = ownedClock()
  const environment = createHostTestEnvironment({ runId: 'clockwork-run', seed: 9, epochMs: 50 }, clock.port)
  const initial = environment.snapshot()

  expect(() => environment.advanceControl('other-run', 10)).toThrow(HostTestControlError)
  expect(() => environment.advanceControl('clockwork-run', -1)).toThrow(HostTestControlError)
  expect(environment.snapshot()).toEqual(initial)

  environment.dispose()
  environment.dispose()
  expect(clock.endCount()).toBe(1)
  expect(() => environment.snapshot()).toThrow(HostTestControlError)
  expect(() => environment.advance('clockwork-run', 1)).toThrow(HostTestControlError)
})

test('Clockwork subscribers observe the control receipt and consistent elapsed time at each due instant', () => {
  let environment: ReturnType<typeof createHostTestEnvironment> | undefined
  const observations: Array<{ lastControlAdvanceMs?: number; wallMs: number; monotonicMs: number }> = []
  let nowMs = 0
  const clock: HostTestClock = {
    begin(epochMs: number): void {
      nowMs = epochMs
    },
    now: (): number => nowMs,
    advance(advanceMs: number): void {
      nowMs += advanceMs / 2
      observations.push(environment!.snapshot())
      nowMs += advanceMs / 2
      observations.push(environment!.snapshot())
    },
    end(): void {},
  }
  environment = createHostTestEnvironment({ runId: 'receipt-run', seed: 1, epochMs: 100 }, clock)

  const snapshot = environment.advanceControl('receipt-run', 1_000)
  expect(observations).toMatchObject([
    { lastControlAdvanceMs: 1_000, wallMs: 600, monotonicMs: 500 },
    { lastControlAdvanceMs: 1_000, wallMs: 1_100, monotonicMs: 1_000 },
  ])
  expect(snapshot).toMatchObject({ lastControlAdvanceMs: 1_000, wallMs: 1_100, monotonicMs: 1_000 })
  environment.dispose()
})

test('Clockwork production controls schedule, close, and reinstall one runtime clock', () => {
  const first = installRuntimeHostTestControl({ runId: 'runtime-first', seed: 17, epochMs: 1_000 })
  let second: ReturnType<typeof installRuntimeHostTestControl> | undefined
  const callbacks: string[] = []
  try {
    Clock.after(2, () => callbacks.push(`first after at ${Clock.now()}`))
    Clock.every(3, () => callbacks.push(`first every at ${Clock.now()}`))
    Clock.after(7, () => callbacks.push(`first delayed after at ${Clock.now()}`))
    Clock.after(20, () => callbacks.push(`discarded first after at ${Clock.now()}`))

    expect(() => installRuntimeHostTestControl({ runId: 'runtime-duplicate', seed: 18, epochMs: 2_000 }))
      .toThrow('A Tao host-test runtime environment is already active in this JavaScript realm.')

    expect(first.advanceControl('runtime-first', 12)).toEqual({
      runId: 'runtime-first',
      seed: 17,
      epochMs: 1_000,
      wallMs: 1_012,
      monotonicMs: 12,
      lastControlAdvanceMs: 12,
    })
    expect(callbacks).toEqual([
      'first after at 1002',
      'first every at 1003',
      'first every at 1006',
      'first delayed after at 1007',
      'first every at 1009',
      'first every at 1012',
    ])

    first.dispose()
    expect(() => first.snapshot()).toThrow('The effect session has already been disposed.')
    expect(() => first.advanceControl('runtime-first', 1)).toThrow('The effect session has already been disposed.')

    second = installRuntimeHostTestControl({ runId: 'runtime-second', seed: 19, epochMs: 1_019 })
    Clock.after(1, () => callbacks.push(`second after at ${Clock.now()}`))
    expect(second.advanceControl('runtime-second', 1)).toEqual({
      runId: 'runtime-second',
      seed: 19,
      epochMs: 1_019,
      wallMs: 1_020,
      monotonicMs: 1,
      lastControlAdvanceMs: 1,
    })
    expect(callbacks).toEqual([
      'first after at 1002',
      'first every at 1003',
      'first every at 1006',
      'first delayed after at 1007',
      'first every at 1009',
      'first every at 1012',
      'second after at 1020',
    ])
  } finally {
    first.dispose()
    second?.dispose()
  }
})

function ownedClock(): Readonly<{ port: HostTestClock; endCount: () => number }> {
  let nowMs = 0
  let ends = 0
  return {
    port: {
      begin(epochMs: number): void {
        nowMs = epochMs
      },
      now(): number {
        return nowMs
      },
      advance(advanceMs: number): void {
        nowMs += advanceMs
      },
      end(): void {
        ends += 1
      },
    },
    endCount: () => ends,
  }
}
