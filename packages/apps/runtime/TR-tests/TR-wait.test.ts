import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import { actionExitOf, createActionExit, TaoActionFailure } from '../TaoRuntime-src/TR-errors'
import { makeQuantityType } from '../TaoRuntime-src/TR-quantity-values'
import { type TaoWaitScheduler, wait } from '../TaoRuntime-src/TR-wait'

const Duration = makeQuantityType({
  domain: 'Duration',
  defaultUnit: 'Seconds',
  units: { Seconds: 1, Milliseconds: 0.001 },
}, TR.Value)

type Scheduled = { callback: () => void; delayMilliseconds: number; cancelCalls: number }

function manualScheduler(): Readonly<{ schedule: TaoWaitScheduler; scheduled: Scheduled[] }> {
  const scheduled: Scheduled[] = []
  return {
    scheduled,
    schedule: (callback, delayMilliseconds) => {
      const entry = { callback, delayMilliseconds, cancelCalls: 0 }
      scheduled.push(entry)
      return () => {
        entry.cancelCalls += 1
      }
    },
  }
}

Describe('checked Wait', () => {
  Test('reads one authenticated duration and resolves signed nonpositive values without scheduling', async () => {
    const scheduler = manualScheduler()
    let reads = 0
    const read = (value: Parameters<typeof Duration.read>[0]) => {
      reads += 1
      return Duration.read(value)
    }

    await wait(read, Duration.fromUnit(-1, 'Seconds'), undefined, scheduler.schedule)
    await wait(read, Duration.fromUnit(0, 'Seconds'), undefined, scheduler.schedule)

    Expect(reads).toBe(2)
    Expect(scheduler.scheduled).toEqual([])
  })

  Test('rounds fractional milliseconds upward and bounds huge finite waits into host-safe chunks', async () => {
    const scheduler = manualScheduler()
    const controller = new AbortController()
    const value = Duration.fromJSValue(Number.MAX_VALUE)
    const pending = wait(Duration.read, value, controller.signal, scheduler.schedule)

    Expect(scheduler.scheduled[0]?.delayMilliseconds).toBe(2 ** 31 - 1)
    scheduler.scheduled[0]?.callback()
    Expect(scheduler.scheduled[1]?.delayMilliseconds).toBe(2 ** 31 - 1)
    scheduler.scheduled[1]?.callback()
    Expect(scheduler.scheduled).toHaveLength(3)
    Expect(scheduler.scheduled[2]?.delayMilliseconds).toBe(2 ** 31 - 1)
    controller.abort()
    let hugeFailure: unknown
    try {
      await pending
    } catch (error) {
      hugeFailure = error
    }
    Expect(hugeFailure).toBeInstanceOf(TaoActionFailure)
    Expect((hugeFailure as TaoActionFailure).caseName).toBe('cancelled')

    const multiChunk = manualScheduler()
    let resolved = false
    const finiteWait = wait(
      Duration.read,
      Duration.fromJSValue((2 ** 31 - 1) / 1000 + 0.0001),
      undefined,
      multiChunk.schedule,
    ).then(() => {
      resolved = true
    })
    Expect(multiChunk.scheduled[0]?.delayMilliseconds).toBe(2 ** 31 - 1)
    multiChunk.scheduled[0]?.callback()
    Expect(multiChunk.scheduled[1]?.delayMilliseconds).toBe(1)
    Expect(resolved).toBe(false)
    multiChunk.scheduled[1]?.callback()
    await finiteWait
    Expect(resolved).toBe(true)

    const fractional = manualScheduler()
    const brief = wait(Duration.read, Duration.fromUnit(0.0001, 'Seconds'), undefined, fractional.schedule)
    Expect(fractional.scheduled[0]?.delayMilliseconds).toBe(1)
    fractional.scheduled[0]?.callback()
    await brief
  })

  Test('rejects pre-cancelled waits with the modeled cancellation and schedules no timer', async () => {
    const controller = new AbortController()
    controller.abort()
    const scheduler = manualScheduler()
    let reads = 0
    let caught: unknown
    try {
      await wait(
        value => {
          reads += 1
          return Duration.read(value)
        },
        Duration.fromUnit(1, 'Seconds'),
        controller.signal,
        scheduler.schedule,
      )
    } catch (error) {
      caught = error
    }

    Expect(reads).toBe(1)
    Expect(caught).toBeInstanceOf(TaoActionFailure)
    Expect((caught as TaoActionFailure).caseName).toBe('cancelled')
    Expect(scheduler.scheduled).toEqual([])
  })

  Test('cancellation clears the active timer and listener and ignores a late callback', async () => {
    const controller = new AbortController()
    const scheduler = manualScheduler()
    let listenersAdded = 0
    let listenersRemoved = 0
    const add = controller.signal.addEventListener.bind(controller.signal)
    const remove = controller.signal.removeEventListener.bind(controller.signal)
    controller.signal.addEventListener = ((...args: Parameters<AbortSignal['addEventListener']>) => {
      listenersAdded += 1
      return add(...args)
    }) as AbortSignal['addEventListener']
    controller.signal.removeEventListener = ((...args: Parameters<AbortSignal['removeEventListener']>) => {
      listenersRemoved += 1
      return remove(...args)
    }) as AbortSignal['removeEventListener']
    const pending = wait(Duration.read, Duration.fromUnit(3, 'Seconds'), controller.signal, scheduler.schedule)
    const lateCallback = scheduler.scheduled[0]?.callback
    controller.abort()

    let caught: unknown
    try {
      await pending
    } catch (error) {
      caught = error
    }
    lateCallback?.()

    Expect(caught).toBeInstanceOf(TaoActionFailure)
    Expect((caught as TaoActionFailure).caseName).toBe('cancelled')
    Expect(scheduler.scheduled[0]?.cancelCalls).toBe(1)
    Expect(scheduler.scheduled).toHaveLength(1)
    Expect([listenersAdded, listenersRemoved]).toEqual([1, 1])
  })

  Test('cancellation remains the primary joined action failure when cleanup also fails', async () => {
    const controller = new AbortController()
    const scheduler = manualScheduler()
    const pending = wait(Duration.read, Duration.fromUnit(3, 'Seconds'), controller.signal, scheduler.schedule)
    controller.abort()
    let caught: unknown
    try {
      await pending
    } catch (error) {
      caught = error
    }
    const cleanupFailure = { kind: 'defer cleanup failure' }
    const exit = actionExitOf(createActionExit(true, caught, undefined, [cleanupFailure]))

    Expect(exit?.kind).toBe('cancelled')
    Expect(exit?.primary).toBe(caught)
    Expect(exit?.cleanupFailures).toEqual([cleanupFailure])
  })

  Test('propagates a host scheduling exception and removes the abort listener', async () => {
    const controller = new AbortController()
    const expected = { kind: 'schedule failed' }
    let added = 0
    let removed = 0
    const add = controller.signal.addEventListener.bind(controller.signal)
    const remove = controller.signal.removeEventListener.bind(controller.signal)
    controller.signal.addEventListener = ((...args: Parameters<AbortSignal['addEventListener']>) => {
      added += 1
      return add(...args)
    }) as AbortSignal['addEventListener']
    controller.signal.removeEventListener = ((...args: Parameters<AbortSignal['removeEventListener']>) => {
      removed += 1
      return remove(...args)
    }) as AbortSignal['removeEventListener']
    let caught: unknown
    try {
      await wait(Duration.read, Duration.fromUnit(1, 'Seconds'), controller.signal, () => {
        throw expected
      })
    } catch (error) {
      caught = error
    }

    Expect(caught).toBe(expected)
    Expect([added, removed]).toEqual([1, 1])

    const undefinedFailure = await wait(
      Duration.read,
      Duration.fromUnit(1, 'Seconds'),
      undefined,
      () => {
        throw undefined
      },
    ).then(() => 'resolved', () => 'rejected')
    Expect(undefinedFailure).toBe('rejected')
  })
})
