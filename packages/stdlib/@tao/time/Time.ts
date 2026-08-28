import TR from '@runtime/TR'

/**
 * The TypeScript side of `@tao/time`. The ticker owns its timer through the runtime clock, so a
 * check that holds the clock still drives it exactly as wall-clock time would.
 */
export const Interval = (everyNanoseconds: number): TR.Ticker => TR.Interval(everyNanoseconds)
