import { Describe, Expect, Test } from '@shared/test'
import { createStudioBackgroundValidationScheduler } from '../studio-src/StudioBackgroundValidation'

Describe('Studio background validation scheduling', () => {
  Test('keeps the maximum deadline anchored to the first request and releases the latest revision', () => {
    const clock = new FakeClock()
    const released: number[] = []
    const scheduler = createStudioBackgroundValidationScheduler({
      cancelTimer: clock.cancel,
      onRelease: revision => released.push(revision),
      setTimer: clock.set,
    })

    scheduler.request(1)
    clock.advanceBy(4_000)
    scheduler.request(2)
    scheduler.painted(1)
    clock.advanceBy(5_999)
    Expect(released).toEqual([])
    clock.advanceBy(1)

    Expect(released).toEqual([2])
  })

  Test('restarts idle delay for the latest accepted paint and ignores stale paints', () => {
    const clock = new FakeClock()
    const released: number[] = []
    const scheduler = createStudioBackgroundValidationScheduler({
      cancelTimer: clock.cancel,
      idleDelayMs: 1_000,
      maxDelayMs: 10_000,
      onRelease: revision => released.push(revision),
      setTimer: clock.set,
    })

    scheduler.request(1)
    scheduler.painted(1)
    clock.advanceBy(800)
    scheduler.request(2)
    scheduler.painted(1)
    clock.advanceBy(500)
    Expect(released).toEqual([])
    scheduler.painted(2)
    clock.advanceBy(999)
    Expect(released).toEqual([])
    clock.advanceBy(1)

    Expect(released).toEqual([2])
  })

  Test('repeated current and stale paints do not extend the quiet delay', () => {
    const clock = new FakeClock()
    const released: number[] = []
    const scheduler = createStudioBackgroundValidationScheduler({
      cancelTimer: clock.cancel,
      idleDelayMs: 1_000,
      onRelease: revision => released.push(revision),
      setTimer: clock.set,
    })

    scheduler.request(1)
    scheduler.painted(1)
    clock.advanceBy(800)
    scheduler.painted(1)
    scheduler.painted(0)
    clock.advanceBy(200)

    Expect(released).toEqual([1])
    Expect(clock.pendingCount).toBe(0)
  })

  Test('rejected stale paints leave the current request pending', () => {
    const clock = new FakeClock()
    const released: number[] = []
    const scheduler = createStudioBackgroundValidationScheduler({
      cancelTimer: clock.cancel,
      onRelease: revision => released.push(revision),
      setTimer: clock.set,
    })

    scheduler.request(1)
    scheduler.request(2)
    scheduler.painted(1, false)
    Expect(released).toEqual([])
    scheduler.painted(2, false)
    Expect(released).toEqual([2])
    Expect(clock.pendingCount).toBe(0)
  })

  Test('maximum deadline releases the latest request even when no paint arrives', () => {
    const clock = new FakeClock()
    const released: number[] = []
    const scheduler = createStudioBackgroundValidationScheduler({
      cancelTimer: clock.cancel,
      maxDelayMs: 10_000,
      onRelease: revision => released.push(revision),
      setTimer: clock.set,
    })

    scheduler.request(1)
    clock.advanceBy(4_000)
    scheduler.request(2)
    clock.advanceBy(5_999)
    Expect(released).toEqual([])
    clock.advanceBy(1)

    Expect(released).toEqual([2])
    Expect(clock.pendingCount).toBe(0)
  })

  Test('invalid revisions cannot create or consume pending work', () => {
    const clock = new FakeClock()
    const released: number[] = []
    const scheduler = createStudioBackgroundValidationScheduler({
      cancelTimer: clock.cancel,
      onRelease: revision => released.push(revision),
      setTimer: clock.set,
    })

    for (const revision of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0, 1.5]) {
      scheduler.request(revision)
      scheduler.painted(revision)
    }
    scheduler.release()
    clock.advanceBy(10_000)

    Expect(released).toEqual([])
    Expect(clock.pendingCount).toBe(0)
  })

  Test('releases immediately when the latest paint is rejected', () => {
    const clock = new FakeClock()
    const released: number[] = []
    const scheduler = createStudioBackgroundValidationScheduler({
      cancelTimer: clock.cancel,
      onRelease: revision => released.push(revision),
      setTimer: clock.set,
    })

    scheduler.request(1)
    scheduler.painted(1, false)
    clock.advanceBy(10_000)

    Expect(released).toEqual([1])
  })

  Test('explicit release consumes pending work once and cancels both timers', () => {
    const clock = new FakeClock()
    const released: number[] = []
    const scheduler = createStudioBackgroundValidationScheduler({
      cancelTimer: clock.cancel,
      onRelease: revision => released.push(revision),
      setTimer: clock.set,
    })

    scheduler.request(1)
    scheduler.painted(1)
    scheduler.release()
    scheduler.release()
    clock.advanceBy(10_000)

    Expect(released).toEqual([1])
    Expect(clock.pendingCount).toBe(0)
  })

  Test('completion clears pending work and leaves the scheduler reusable', () => {
    const clock = new FakeClock()
    const released: number[] = []
    const scheduler = createStudioBackgroundValidationScheduler({
      cancelTimer: clock.cancel,
      onRelease: revision => released.push(revision),
      setTimer: clock.set,
    })

    scheduler.request(1)
    scheduler.painted(1)
    scheduler.complete()
    clock.advanceBy(10_000)
    Expect(released).toEqual([])
    Expect(clock.pendingCount).toBe(0)

    scheduler.request(2)
    scheduler.painted(2)
    clock.advanceBy(1_000)
    Expect(released).toEqual([2])
  })

  Test('a canceled maximum callback cannot erase a newer timer before close', () => {
    const clock = new FakeClock()
    const scheduler = createStudioBackgroundValidationScheduler({
      cancelTimer: clock.cancel,
      onRelease: () => {},
      setTimer: clock.set,
    })

    scheduler.request(1)
    const staleMaximum = clock.latestHandle
    scheduler.complete()
    scheduler.request(2)
    const currentMaximum = clock.latestHandle
    scheduler.painted(2)
    const currentIdle = clock.latestHandle

    clock.invokeCaptured(staleMaximum)
    scheduler.close()

    Expect(clock.isPending(currentMaximum)).toBe(false)
    Expect(clock.isPending(currentIdle)).toBe(false)
    Expect(clock.pendingCount).toBe(0)
  })

  Test('a canceled idle callback cannot erase a newer timer before close', () => {
    const clock = new FakeClock()
    const scheduler = createStudioBackgroundValidationScheduler({
      cancelTimer: clock.cancel,
      onRelease: () => {},
      setTimer: clock.set,
    })

    scheduler.request(1)
    scheduler.painted(1)
    const staleIdle = clock.latestHandle
    scheduler.complete()
    scheduler.request(2)
    const currentMaximum = clock.latestHandle
    scheduler.painted(2)
    const currentIdle = clock.latestHandle

    clock.invokeCaptured(staleIdle)
    scheduler.close()

    Expect(clock.isPending(currentMaximum)).toBe(false)
    Expect(clock.isPending(currentIdle)).toBe(false)
    Expect(clock.pendingCount).toBe(0)
  })

  Test('close cancels pending work and ignores future requests and paints', () => {
    const clock = new FakeClock()
    const released: number[] = []
    const scheduler = createStudioBackgroundValidationScheduler({
      cancelTimer: clock.cancel,
      onRelease: revision => released.push(revision),
      setTimer: clock.set,
    })

    scheduler.request(1)
    scheduler.painted(1)
    scheduler.close()
    scheduler.close()
    Expect(clock.pendingCount).toBe(0)
    scheduler.request(2)
    scheduler.painted(2)
    clock.advanceBy(10_000)

    Expect(released).toEqual([])
    Expect(clock.pendingCount).toBe(0)
  })
})

class FakeClock {
  #now = 0
  #nextId = 0
  #callbacks = new Map<number, () => void>()
  #timers = new Map<number, { callback: () => void; deadline: number }>()

  set = (callback: () => void, delayMs: number) => {
    const id = ++this.#nextId
    this.#callbacks.set(id, callback)
    this.#timers.set(id, { callback, deadline: this.#now + delayMs })
    return id
  }

  get latestHandle(): number {
    return this.#nextId
  }

  invokeCaptured(handle: number): void {
    this.#callbacks.get(handle)?.()
  }

  isPending(handle: number): boolean {
    return this.#timers.has(handle)
  }

  cancel = (handle: unknown) => {
    this.#timers.delete(handle as number)
  }

  get pendingCount() {
    return this.#timers.size
  }

  advanceBy(durationMs: number) {
    const target = this.#now + durationMs
    while (true) {
      const due = [...this.#timers.entries()]
        .filter(([, timer]) => timer.deadline <= target)
        .sort((left, right) => left[1].deadline - right[1].deadline || left[0] - right[0])[0]
      if (!due) {
        break
      }
      const [id, timer] = due
      this.#timers.delete(id)
      this.#now = timer.deadline
      timer.callback()
    }
    this.#now = target
  }
}
