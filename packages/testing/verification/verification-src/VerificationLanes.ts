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
 * The host-only gates hosted `Verify` does not run, run locally beside it as the other half of a
 * landing's proof. Its membership is derived from the catalog and `ci-macos.yml` (`VerifyComplement`),
 * not listed.
 */
export const VERIFY_COMPLEMENT = 'verify-complement'
/**
 * The hosted macOS half of the same key: the host gates the workflow's `CI_HOST_GATES` admits, with
 * the prepare nodes they read (`CiGateAdmission`). Never a green record: it proves one runner's
 * share, not the tree.
 */
export const VERIFY_FULL_CI = 'verify-full-ci'
export const DIAGNOSE_VERIFICATION = 'diagnose-verification'

/**
 * Lanes whose gate membership is a superset of `verify`, so a green record from any of them also
 * proves `verify`. `GreenTree` owns the rule; this is the list it is applied to.
 */
export const VERIFY_OR_WIDER: readonly string[] = [VERIFY, VERIFY_FULL_SANDBOX, VERIFY_FULL]

/**
 * The lanes broad enough to take the machine for minutes rather than seconds — the property both
 * `LandingLock` and `MachineLanes`' admission queue key off of, each for its own reason (see `LOCKED`
 * below and `MachineLanes.laneQueue`). Kept as its own export, distinct from `LOCKED`, so a consumer
 * reads the policy it actually means rather than a name that happens to hold the same lanes today;
 * nothing requires the two policies to keep agreeing, and an alias would make a future disagreement
 * silent instead of a one-line diff.
 */
export const BROAD: readonly string[] = [
  TEST_ALL,
  VERIFY,
  VERIFY_FULL,
  VERIFY_FULL_SANDBOX,
  VERIFY_COMPLEMENT,
  VERIFY_FULL_CI,
  DIAGNOSE_VERIFICATION,
]

/**
 * The lanes that may not run without the landing lock. Membership is by breadth (see `BROAD`), not by
 * whether the lane is merge evidence: these are the runs that take the machine for minutes, so two at
 * once is both agents finishing later than either would alone, and a landing that follows one of them
 * is standing on a tree a neighbour may already have invalidated.
 *
 * Everything narrower stays free on purpose. An agent must be able to check the change it just made
 * without waiting on anybody — `test-file`, a named test, `test-retry`, `check`, `fix`, `fmt` — and
 * the diff-scoped lanes in between (`verify-changed`, `test-changed`) are narrow by this same
 * membership: `MachineLanes`' admission queue admits them immediately rather than making them wait
 * behind a broad lane, so they are bounded only by their own per-lane slot ceiling, never by another
 * lane's presence, and never by the lock.
 */
export const LOCKED: readonly string[] = [...BROAD]

/** Every lane name this module defines, for the test that pins them against the `Justfile`. */
export const ALL: readonly string[] = [
  DIAGNOSE_VERIFICATION,
  CHECK,
  TEST_ALL,
  TEST_CHANGED,
  VERIFY,
  VERIFY_CHANGED,
  VERIFY_FULL,
  VERIFY_FULL_SANDBOX,
  VERIFY_COMPLEMENT,
  VERIFY_FULL_CI,
]

export const VerificationLanes = {
  DIAGNOSE_VERIFICATION,
  ALL,
  BROAD,
  CHECK,
  LOCKED,
  TEST_ALL,
  TEST_CHANGED,
  VERIFY,
  VERIFY_CHANGED,
  VERIFY_FULL,
  VERIFY_FULL_SANDBOX,
  VERIFY_COMPLEMENT,
  VERIFY_FULL_CI,
  VERIFY_OR_WIDER,
} as const
