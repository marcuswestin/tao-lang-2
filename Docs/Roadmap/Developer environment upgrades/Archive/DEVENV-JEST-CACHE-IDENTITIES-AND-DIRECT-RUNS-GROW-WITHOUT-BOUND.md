# DEVENV-JEST-CACHE-IDENTITIES-AND-DIRECT-RUNS-GROW-WITHOUT-BOUND — Jest cache identities and direct runs grow without bound

- **Status:** Resolved
- **Update, 2026-09-25:** Commit `f10e7429` adds a new owner-managed cache namespace with
  aggregate limits for transform identities, preserves the old namespace without
  migration or deletion, and routes the cache through `TaoHome` for relocation.
  Cache roots now follow `TAO_HOME` and default to `~/.tao/cache`, rather than XDG.
  Direct Jest gets a separate bounded cache with setup/teardown leases;
  a focused runtime Jest suite measured 6.8 seconds uncached, 6.2 seconds cold,
  and 1.3 seconds warm. These are two-test measurements, not whole-gate timings.
  Focused lifecycle controls pass.
- **Acceptance follow-up, 2026-09-26:** `feat/summary-cache-cleanup` adds
  `cache-process-lifecycle.test.ts`. Five fresh processes in each cache namespace
  plateau at `[1, 2, 2, 2, 2]` identities under explicit identity/file/byte budgets.
  Isolated `TAO_HOME` runs preserve the legacy sentinel and add no login-home
  cache files. Real competing processes wait for the coordination lock; real live
  readers survive eviction, and killed owners survive their grace before retirement.
  Retained test-run roots exercise the same live-owner and interrupted-owner cases.
  Grace passage is simulated by aging isolated receipts, not by waiting hours.
  Mutations removing locking, live-owner protection, dead-owner retirement, or
  aggregate pruning fail the corresponding assertions. The restored focused run
  has seven passing tests and no failures; these are lifecycle API subprocess
  checks, not whole-gate performance measurements.
- **Legacy cleanup, 2026-09-26:** After two process snapshots found no active Jest
  consumers and all managed leases were empty, the two old `~/.cache/tao/` roots
  were removed: 897,626 files totaling 11,858,820,028 logical bytes. Their newest
  file writes were September 25. Current v2 caches were preserved. OS startup
  improvement is not established by these code checks or this cleanup.
- **Section:** External
- **Area:** Test infrastructure
- **Impact:** Before the fix, the managed `tao test` cache enforced 25,000 files and
  256 MiB per runtime-path identity, but never retired identity directories as a
  group. Direct Jest used a separate persistent `jest-standalone` cache without
  that lifecycle. Both accumulated across worktrees and short-lived runtime roots.
- **Evidence:** Two read-only snapshots on 2026-09-24 found 574–618 identities
  using 2.14–2.21 GiB under `~/.cache/tao/jest-transform-cache` and ten direct-Jest
  identities using 1.18–1.19 GiB. The managed implementation caps only each
  identity; the direct-Jest fallback does not enter its lease and prune path.
  At `7af60641`, `TaoHome` promises machine-wide cache relocation, but the managed
  and direct Jest paths still use the login home; `TAO_HOME` does not move them.
  These are measured sizes and a source-confirmed lifecycle gap, not a measured
  growth rate. The archived
  [original cache entry](DEVENV-JEST-TRANSFORM-CACHE-GROWS-WITHOUT-BOUND.md)
  records the earlier machine-wide default-cache fix and its acceptance evidence.
  Legacy `$TMPDIR/jest_dx` held 13.03 GiB/760,998 files in the same survey; its
  ownership and liveness were not established, so it was left untouched.
- **Workaround:** Use the managed `tao test` entrypoint for ordinary runs. Preserve
  shared and live roots until their owners and leases can be accounted for.
- **Proposed change:** Add an aggregate identity budget and lease-aware retirement
  across worktrees and short-lived runtime roots. Give direct Jest a bounded
  lifecycle too. Decide how both cache roots follow `TAO_HOME`/XDG without losing
  account of existing leased roots. Do not use age alone to evict transforms because
  cache hits do not refresh modification time.
- **Dependencies:** None. The prior per-identity bound remains in place.
- **Acceptance:** Repeated ordinary and direct-Jest runs plateau under an explicit
  aggregate byte/file/identity budget. Focused controls cover concurrent worktrees,
  live readers, failed runs, killed owners after grace, and inactive identity
  retirement. An isolated `TAO_HOME` run writes no new transform cache in the login
  home. Existing roots remain untouched until an owner-reviewed liveness and
  migration decision.
- **Source:** September 2026 recurring repository review continuation, 2026-09-24.
- **Archived:** 2026-09-26
