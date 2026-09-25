# DEVENV-JEST-CACHE-IDENTITIES-AND-DIRECT-RUNS-GROW-WITHOUT-BOUND — Jest cache identities and direct runs grow without bound

- **Status:** Candidate
- **Section:** External
- **Area:** Test infrastructure
- **Impact:** The managed `tao test` cache enforces 25,000 files and 256 MiB per
  runtime-path identity, but it never retires identity directories as a group.
  Direct Jest uses a separate persistent `jest-standalone` cache without that
  lifecycle. Both can accumulate across worktrees and short-lived runtime roots.
- **Evidence:** Two read-only snapshots on 2026-09-24 found 574–618 identities
  using 2.14–2.21 GiB under `~/.cache/tao/jest-transform-cache` and ten direct-Jest
  identities using 1.18–1.19 GiB. The managed implementation caps only each
  identity; the direct-Jest fallback does not enter its lease and prune path.
  These are measured sizes and a source-confirmed lifecycle gap, not a measured
  growth rate. The archived
  [original cache entry](<Archive/DEVENV-JEST-TRANSFORM-CACHE-GROWS-WITHOUT-BOUND.md>)
  records the earlier machine-wide default-cache fix and its acceptance evidence.
  Legacy `$TMPDIR/jest_dx` held 13.03 GiB/760,998 files in the same survey; its
  ownership and liveness were not established, so it was left untouched.
- **Workaround:** Use the managed `tao test` entrypoint for ordinary runs. Preserve
  shared and live roots until their owners and leases can be accounted for.
- **Proposed change:** Add an aggregate identity budget and lease-aware retirement
  across worktrees and short-lived runtime roots. Give direct Jest a bounded
  lifecycle too. Do not use age alone to evict transforms because cache hits do
  not refresh modification time.
- **Dependencies:** None. The prior per-identity bound remains in place.
- **Acceptance:** Repeated ordinary and direct-Jest runs plateau under an explicit
  aggregate byte/file/identity budget. Focused controls cover concurrent worktrees,
  live readers, failed runs, killed owners after grace, and inactive identity
  retirement. The legacy shared root remains untouched until an owner-reviewed
  liveness and migration decision.
- **Source:** September 2026 recurring repository review continuation, 2026-09-24.
