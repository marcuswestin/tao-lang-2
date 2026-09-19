import { afterEach, jest } from '@jest/globals'
import { Clock } from '@runtime/TR-units'
import { Describe, Expect, Test } from '@shared/test'

afterEach(() => {
  Clock.endTest()
  jest.useRealTimers()
})

Describe('runtime clock lifecycle', () => {
  Test('re-arms a repeating callback for its remaining delay and keeps its canceller authoritative', () => {
    jest.useFakeTimers()
    jest.setSystemTime(1_000)
    const ticks: number[] = []
    const cancel = Clock.every(100, () => ticks.push(Clock.now()))

    jest.advanceTimersByTime(40)
    const release = Clock.hold()
    Clock.advance(20)
    release()

    jest.advanceTimersByTime(39)
    Expect(ticks).toEqual([])
    jest.advanceTimersByTime(1)
    Expect(ticks).toEqual([1_080])

    cancel()
    jest.advanceTimersByTime(500)
    Expect(ticks).toEqual([1_080])
  })

  Test('keeps the clock held until every replay generation releases its own hold', () => {
    jest.useFakeTimers()
    jest.setSystemTime(2_000)
    const first = Clock.hold()
    const second = Clock.hold()

    Clock.advance(25)
    first()
    Expect(Clock.now()).toBe(2_025)
    Clock.advance(25)
    second()

    Expect(Clock.now()).toBe(2_000)
  })

  Test('ignores a stale replay release after a test clock takes ownership', () => {
    jest.useFakeTimers()
    jest.setSystemTime(3_000)
    const staleRelease = Clock.hold()

    Clock.beginTest(9_000)
    staleRelease()

    Expect(Clock.now()).toBe(9_000)
    Clock.advance(5)
    Expect(Clock.now()).toBe(9_005)
  })
})
