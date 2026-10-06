import type { TaoEvaluable } from './TR-action-values'
import { HostEnvironmentError, UserInputError } from './TR-errors'

type DurationFactoryLike = Readonly<{
  fromJSValue(canonical: unknown): TaoEvaluable<unknown>
}>

type TimerResult<Factory extends DurationFactoryLike> = ReturnType<Factory['fromJSValue']>

/** The sampled duration is fixed; Timer handles are runtime-only and cannot be serialized. */
export type TaoTimer<Result extends TaoEvaluable<unknown>> = Readonly<{
  Duration(): Result
}>

/** Start a timer against an explicitly supplied sleep-inclusive monotonic host clock. */
export function startTimer<const Factory extends DurationFactoryLike>(
  durationFactory: Factory,
  nowMilliseconds: () => number,
): TaoTimer<TimerResult<Factory>> {
  const originMilliseconds = readMonotonicMilliseconds(nowMilliseconds, undefined)
  let lastMilliseconds = originMilliseconds
  const handle = {} as { Duration?: () => TimerResult<Factory> }
  Object.defineProperties(handle, {
    Duration: {
      enumerable: false,
      value: () => {
        const sampleMilliseconds = readMonotonicMilliseconds(nowMilliseconds, lastMilliseconds)
        const elapsedSeconds = (sampleMilliseconds - originMilliseconds) / 1000
        if (!Number.isFinite(elapsedSeconds)) {
          throw new HostEnvironmentError('The monotonic clock returned an invalid elapsed duration.')
        }
        lastMilliseconds = sampleMilliseconds
        return durationFactory.fromJSValue(elapsedSeconds) as TimerResult<Factory>
      },
    },
    toJSON: {
      enumerable: false,
      value: () => {
        throw new UserInputError('Timer handles cannot be serialized. Persist a sampled Duration instead.')
      },
    },
  })
  return Object.freeze(handle) as TaoTimer<TimerResult<Factory>>
}

function readMonotonicMilliseconds(
  nowMilliseconds: () => number,
  originMilliseconds: number | undefined,
): number {
  let currentMilliseconds: unknown
  try {
    currentMilliseconds = nowMilliseconds()
  } catch (cause) {
    throw new HostEnvironmentError('The monotonic clock could not be read.', { cause })
  }
  if (
    typeof currentMilliseconds !== 'number'
    || !Number.isFinite(currentMilliseconds)
    || (originMilliseconds !== undefined && currentMilliseconds < originMilliseconds)
  ) {
    throw new HostEnvironmentError('The monotonic clock returned an invalid reading.')
  }
  return currentMilliseconds
}
