import { runtimeProcess } from './Platform'

/** Policy keeps deliberate timeout behavior tests bounded during diagnostic verification. */
export type Policy = 'bounded' | 'environment'

/** enabled controls execution watchdogs, never cleanup grace periods or performance assertions. */
export function enabled(
  policy: Policy = 'environment',
  env: Readonly<Record<string, string | undefined>> = runtimeProcess.env,
): boolean {
  return policy === 'bounded' || env['TAO_VERIFY_NO_TIMEOUTS'] !== 'true'
}

/** resolve omits diagnostic execution deadlines rather than scheduling a zero or overflowing timer. */
export function resolve(
  timeoutMs: number | undefined,
  policy: Policy = 'environment',
  env: Readonly<Record<string, string | undefined>> = runtimeProcess.env,
): number | undefined {
  return enabled(policy, env) ? timeoutMs : undefined
}
