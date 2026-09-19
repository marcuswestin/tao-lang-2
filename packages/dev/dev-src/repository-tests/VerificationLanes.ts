/**
 * The names of the verification lanes, written once.
 *
 * A lane's name is a `just` recipe, and until this module existed each consumer kept its own copy
 * of the spelling: the `--green-tree` arguments in the `Justfile`, the lanes `Finalize` will accept
 * a green record from, and the lanes `LandingLock` serializes. Nothing tied the copies together, so
 * a wrong one failed silently rather than loudly — `Finalize` spent months asking for
 * `full-verify` and `full-verify-sandbox`, which are not lanes, and therefore re-verified every
 * branch whose last run was the wider lane.
 *
 * That is the failure mode this module exists to remove: a name that matches nothing looks exactly
 * like a lane that was never run. `verification-lane-names.test.ts` pins every name here against
 * the recipes the `Justfile` actually defines, so the next wrong spelling fails a test instead of
 * quietly costing a verification pass.
 */

export const CHECK = 'check'
export const TEST_ALL = 'test-all'
export const TEST_CHANGED = 'test-changed'
export const VERIFY = 'verify'
export const VERIFY_CHANGED = 'verify-changed'
export const VERIFY_FULL = 'verify-full'
export const VERIFY_FULL_SANDBOX = 'verify-full-sandbox'

/**
 * Lanes whose gate membership is a superset of `verify`, so a green record from any of them also
 * proves `verify`. `GreenTree` owns the rule; this is the list it is applied to.
 */
export const VERIFY_OR_WIDER: readonly string[] = [VERIFY, VERIFY_FULL_SANDBOX, VERIFY_FULL]

/**
 * The lanes that may not run without the landing lock. Membership is by breadth, not by whether the
 * lane is merge evidence: these are the runs that take the machine for minutes, so two at once is
 * both agents finishing later than either would alone, and a landing that follows one of them is
 * standing on a tree a neighbour may already have invalidated.
 *
 * Everything narrower stays free on purpose. An agent must be able to check the change it just made
 * without waiting on anybody — `test-file`, a named test, `test-retry`, `check`, `fix`, `fmt` — and
 * the diff-scoped lanes in between (`verify-changed`, `test-changed`) are throttled by the existing
 * machine-lane slot admission rather than by the lock.
 */
export const LOCKED: readonly string[] = [TEST_ALL, VERIFY, VERIFY_FULL, VERIFY_FULL_SANDBOX]

/** Every lane name this module defines, for the test that pins them against the `Justfile`. */
export const ALL: readonly string[] = [
  CHECK,
  TEST_ALL,
  TEST_CHANGED,
  VERIFY,
  VERIFY_CHANGED,
  VERIFY_FULL,
  VERIFY_FULL_SANDBOX,
]

export const VerificationLanes = {
  ALL,
  CHECK,
  LOCKED,
  TEST_ALL,
  TEST_CHANGED,
  VERIFY,
  VERIFY_CHANGED,
  VERIFY_FULL,
  VERIFY_FULL_SANDBOX,
  VERIFY_OR_WIDER,
} as const
