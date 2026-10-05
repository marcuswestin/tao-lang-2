import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import { HostEnvironmentError, UserInputError } from '../TaoRuntime-src/TR-errors'
import { makeQuantityType } from '../TaoRuntime-src/TR-quantity-values'
import { startTimer } from '../TaoRuntime-src/TR-time'

const Duration = makeQuantityType({
  domain: 'Duration',
  defaultUnit: 'Seconds',
  units: { Seconds: 1, Milliseconds: 0.001 },
}, TR.Value)

Describe('monotonic Timer', () => {
  Test('samples fixed, typed elapsed durations in the factory default unit', () => {
    const readings = [100, 1_600, 2_100]
    let clockReads = 0
    let factoryCalls = 0
    const factory = {
      ...Duration,
      fromJSValue(canonical: unknown) {
        factoryCalls += 1
        return Duration.fromJSValue(canonical)
      },
    }
    const timer = startTimer(factory, () => {
      clockReads += 1
      return readings.shift() ?? 2_100
    })
    const first: ReturnType<typeof Duration.fromJSValue> = timer.Duration()
    const second = timer.Duration()

    Expect(Duration.read(first)).toEqual({ canonical: 1.5, unit: 'Seconds' })
    Expect(Duration.read(second)).toEqual({ canonical: 2, unit: 'Seconds' })
    Expect(Duration.read(first)).toEqual({ canonical: 1.5, unit: 'Seconds' })
    Expect([clockReads, factoryCalls]).toEqual([3, 2])
  })

  Test('reads only the injected monotonic clock once per start and sample', () => {
    const readings = [10, 20]
    const timer = startTimer(Duration, () => readings.shift() ?? 20)
    Expect(Duration.read(timer.Duration()).canonical).toBe(0.01)
    Expect(readings).toEqual([])
  })

  Test('keeps the handle runtime-only and rejects serialization with a Tao input error', () => {
    const timer = startTimer(Duration, () => 1)

    Expect(Object.isFrozen(timer)).toBe(true)
    Expect(Object.keys(timer)).toEqual([])
    Expect(Object.getOwnPropertyDescriptor(timer, 'Duration')?.enumerable).toBe(false)
    Expect(() => JSON.stringify(timer)).toThrow(UserInputError)
    Expect(() => JSON.stringify(timer)).toThrow(
      'Timer handles cannot be serialized. Persist a sampled Duration instead.',
    )
  })

  Test('classifies invalid, nonfinite, overflowing, and backwards clock readings as host failures', () => {
    Expect(() => startTimer(Duration, () => Number.NaN)).toThrow(HostEnvironmentError)
    Expect(() => startTimer(Duration, () => Number.POSITIVE_INFINITY)).toThrow(HostEnvironmentError)

    const regressing = [10, 20, 15]
    const timer = startTimer(Duration, () => regressing.shift() ?? 15)
    Expect(Duration.read(timer.Duration()).canonical).toBe(0.01)
    Expect(() => timer.Duration()).toThrow(HostEnvironmentError)

    const overflowing = [-Number.MAX_VALUE, Number.MAX_VALUE]
    const overflowTimer = startTimer(Duration, () => overflowing.shift() ?? Number.MAX_VALUE)
    Expect(() => overflowTimer.Duration()).toThrow(HostEnvironmentError)
  })
})
