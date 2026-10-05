import TR from '@runtime/TR'
import { RuntimeAssert } from '@runtime/TR-assert'
import { nowMilliseconds } from '@runtime/TR-continuous-clock'
import { startTimer, type TaoTimer } from '@runtime/TR-time'
import { type Duration, types } from '../core/Quantity.tao'
import type { SampleDuration as SampleDurationContract } from './Durations.tao'

const timers = new WeakMap<object, TaoTimer<Duration>>()

export const StartTimer = (): TaoTimer<Duration> => {
  const timer = startTimer(types.Duration.Factory, nowMilliseconds)
  timers.set(timer, timer)
  return timer
}

export const SampleDuration = (timer: Parameters<SampleDurationContract>[0]): Duration => {
  const handle = typeof timer === 'object' && timer !== null ? timers.get(timer) : undefined
  RuntimeAssert.input(handle, 'SampleDuration requires a Timer created by StartTimer.')
  return handle.Duration()
}

export const Wait = (duration: Duration): Promise<void> => TR.Wait(types.Duration.Factory.read, duration)
