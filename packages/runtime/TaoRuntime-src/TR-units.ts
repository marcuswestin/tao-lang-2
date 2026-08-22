/**
 * Unit values and the clock they read (Decisions §2 and §9). A duration is carried as a plain number
 * of its family's base unit, so same-family arithmetic is ordinary numeric arithmetic and only the
 * accessors and the calendar pairs need runtime help. `time` is milliseconds since the epoch.
 */

const NANOSECONDS_PER_MILLISECOND = 1e6
const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60

type IntervalListener = () => void

/** TaoTicker is the reactive value `@tao/time`'s `Interval` returns. */
export type TaoTicker = {
  readonly Value: number
  readonly Running: boolean
  readonly Start: () => void
  readonly Stop: () => void
  /** subscribe re-renders a holder on every tick and owns the timer for as long as it is held. */
  subscribe: (listener: IntervalListener) => () => void
}

/** UnitEvaluable is the runtime value shape unit lowering receives and returns. */
type UnitEvaluable = { evaluate: () => { jsValue: any } }

/**
 * UnitControls converts between unit values, numbers, and clock readings. Each entry takes and
 * returns wrapped runtime values, like every other generated-code operator.
 */
export function makeUnitControls(wrap: <T>(jsValue: T) => any) {
  const number = (value: UnitEvaluable): number => value.evaluate().jsValue as number
  return {
    /** Build turns a number into a unit value of its family's base unit. */
    Build(value: UnitEvaluable, ratioToBase: number) {
      return wrap(number(value) * ratioToBase)
    },

    /** Read turns a unit value back into a number in the named unit. */
    Read(value: UnitEvaluable, ratioToBase: number) {
      return wrap(number(value) / ratioToBase)
    },

    /** Between returns the duration from one time to another. */
    Between(later: UnitEvaluable, earlier: UnitEvaluable) {
      return wrap((number(later) - number(earlier)) * NANOSECONDS_PER_MILLISECOND)
    },

    /** Shift moves a time by a duration, in the direction the operator names. */
    Shift(time: UnitEvaluable, operator: '+' | '-', duration: UnitEvaluable) {
      const milliseconds = number(duration) / NANOSECONDS_PER_MILLISECOND
      return wrap(operator === '+' ? number(time) + milliseconds : number(time) - milliseconds)
    },

    /** Clock renders a duration as clock text. */
    Clock(duration: UnitEvaluable) {
      return wrap(clockText(number(duration)))
    },
  } as const
}

/**
 * Clock renders a duration the way a countdown reads it: whole seconds, `m:ss` under an hour and
 * `h:mm:ss` from an hour up, and `0:00` once there is nothing left.
 */
export function clockText(duration: number): string {
  const totalSeconds = Math.floor(duration / (1e3 * NANOSECONDS_PER_MILLISECOND))
  if (totalSeconds <= 0) {
    return '0:00'
  }
  const seconds = totalSeconds % SECONDS_PER_MINUTE
  const totalMinutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE)
  const minutes = totalMinutes % MINUTES_PER_HOUR
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR)
  return hours > 0
    ? `${hours}:${padded(minutes)}:${padded(seconds)}`
    : `${minutes}:${padded(seconds)}`
}

/**
 * The clock owns both the current time and every repeating and delayed callback in the runtime, so a
 * test can hold it still and advance it deliberately. Outside a test it delegates to the platform.
 */
class RuntimeClock {
  private virtualNowMs: number | undefined
  private scheduled = new Map<number, ScheduledCallback>()
  private nextScheduleId = 1

  /** now returns the current time in milliseconds, virtual while a test holds the clock. */
  now(): number {
    return this.virtualNowMs ?? Date.now()
  }

  /** beginTest holds the clock at a fixed instant so every check starts from the same time. */
  beginTest(startMs = TEST_EPOCH_MS): void {
    this.virtualNowMs = startMs
    this.scheduled = new Map()
  }

  /** endTest releases the clock back to the platform and drops anything still scheduled. */
  endTest(): void {
    for (const callback of this.scheduled.values()) {
      callback.cancelPlatformTimer?.()
    }
    this.virtualNowMs = undefined
    this.scheduled = new Map()
  }

  /** every schedules a repeating callback and returns its canceller. */
  every(intervalMs: number, fire: () => void): () => void {
    return this.schedule(intervalMs, fire, true)
  }

  /** after schedules a one-shot callback and returns its canceller. */
  after(delayMs: number, fire: () => void): () => void {
    return this.schedule(delayMs, fire, false)
  }

  /**
   * advance moves a held clock forward, firing every callback that falls due in time order so that
   * a journey observing several tickers sees the same sequence a real clock would produce.
   */
  advance(milliseconds: number): void {
    if (this.virtualNowMs === undefined) {
      throw new Error('The Tao clock can only be advanced while a test holds it.')
    }
    const target = this.virtualNowMs + milliseconds
    for (;;) {
      const next = this.nextDue(target)
      if (!next) {
        break
      }
      this.virtualNowMs = next.dueMs
      if (next.repeating) {
        next.dueMs += next.intervalMs
      } else {
        this.scheduled.delete(next.id)
      }
      next.fire()
    }
    this.virtualNowMs = target
  }

  private schedule(intervalMs: number, fire: () => void, repeating: boolean): () => void {
    const id = this.nextScheduleId++
    if (this.virtualNowMs === undefined) {
      const forget = () => this.scheduled.delete(id)
      const timer = repeating ? setInterval(fire, intervalMs) : setTimeout(() => {
        forget()
        fire()
      }, intervalMs)
      const cancel = () => repeating ? clearInterval(timer) : clearTimeout(timer)
      this.scheduled.set(id, { id, dueMs: 0, intervalMs, repeating, fire, cancelPlatformTimer: cancel })
      return () => {
        cancel()
        forget()
      }
    }
    this.scheduled.set(id, { id, dueMs: this.now() + intervalMs, intervalMs, repeating, fire })
    return () => this.scheduled.delete(id)
  }

  private nextDue(targetMs: number): ScheduledCallback | undefined {
    let soonest: ScheduledCallback | undefined
    for (const callback of this.scheduled.values()) {
      if (callback.dueMs <= targetMs && (!soonest || callback.dueMs < soonest.dueMs)) {
        soonest = callback
      }
    }
    return soonest
  }
}

type ScheduledCallback = {
  id: number
  dueMs: number
  intervalMs: number
  repeating: boolean
  fire: () => void
  cancelPlatformTimer?: () => void
}

/** A held clock starts at a fixed instant so a journey's times read the same on every run. */
const TEST_EPOCH_MS = Date.UTC(2026, 0, 1, 9, 0, 0)

export const Clock = new RuntimeClock()

/**
 * An interval is created once by its holder and ticks only while something holds it, which is what
 * makes it start when the view mounts and stop when that view unmounts.
 */
export function createTicker(everyNanoseconds: number): TaoTicker {
  const intervalMs = Math.max(1, Math.round(everyNanoseconds / NANOSECONDS_PER_MILLISECOND))
  const listeners = new Set<IntervalListener>()
  let running = true
  let valueMs = Clock.now()
  let cancel: (() => void) | undefined

  const notify = () => {
    for (const listener of [...listeners]) {
      listener()
    }
  }
  const startTimer = () => {
    if (!cancel && running && listeners.size > 0) {
      cancel = Clock.every(intervalMs, () => {
        valueMs = Clock.now()
        notify()
      })
    }
  }
  const stopTimer = () => {
    cancel?.()
    cancel = undefined
  }

  return {
    get Value() {
      return valueMs
    },
    get Running() {
      return running
    },
    Start() {
      if (running) {
        return
      }
      running = true
      valueMs = Clock.now()
      startTimer()
      notify()
    },
    Stop() {
      if (!running) {
        return
      }
      running = false
      stopTimer()
      notify()
    },
    subscribe(listener) {
      listeners.add(listener)
      startTimer()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          stopTimer()
        }
      }
    },
  }
}

/** isTicker reports whether a runtime value drives re-renders as it changes. */
export function isTicker(value: unknown): value is TaoTicker {
  return typeof value === 'object' && value !== null && typeof (value as TaoTicker).subscribe === 'function'
    && 'Running' in value
}

function padded(value: number): string {
  return value.toString().padStart(2, '0')
}
