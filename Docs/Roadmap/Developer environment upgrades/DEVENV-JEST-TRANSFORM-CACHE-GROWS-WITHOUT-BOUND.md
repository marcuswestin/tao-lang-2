# DEVENV-JEST-TRANSFORM-CACHE-GROWS-WITHOUT-BOUND — Jest's transform cache grows without bound

- **Status:** Candidate
- **Section:** External
- **Update, 2026-09-24:** `7a74afbf` moved ordinary `tao test` transforms to a
  lease-aware, 25,000-file/256-MiB cache per runtime-path identity, and the earlier
  `main` ledger entry was archived on 2026-09-23. The broader bound remains open:
  two read-only snapshots found 574–618 identities using 2.14–2.21 GiB under
  `~/.cache/tao/jest-transform-cache`; the identity directories have no parent-level
  retirement. Direct Jest uses a separate unbounded `jest-standalone` fallback,
  measured at 1.18–1.19 GiB in ten identities. The legacy `$TMPDIR/jest_dx`
  held 13.03 GiB/760,998 files and was not removed because ownership and liveness
  were not established. This reopens the original issue rather than assigning a
  second ID to the same lifecycle gap.
- **Area:** Test infrastructure
- **Impact:** Ordinary `tao test` now bounds each managed identity, but accumulated
  identities and the direct-Jest fallback still grow without an aggregate budget.
  They consume cache storage across worktrees and short-lived runtime roots.
  The older shared `$TMPDIR/jest_dx` is also substantial; its ownership and
  liveness have not been established, so it remains untouched.
- **Evidence:** Counted 2026-09-21 with `find "$TMPDIR/jest_dx" -type f` around single `tao test`
  runs of WordFlower. Each run that compiled a new run root added exactly 2,135 files, the whole
  module graph the run loads, because the run root's path was part of Jest's configuration and Jest
  hashes its configuration into every cache key. The change that added this entry moved the
  entrypoints out of the run root, which cut the growth to 650 files per compile, and the change
  after it stored the compiled apps by their contents, which cut it to 116 after an edit and none
  without one. The growth is now proportional to distinct compiled output rather than to runs, and
  still unbounded: entries written under a configuration or path that no longer exists can never be
  hit again.
- **Workaround:** Use the managed `tao test` entrypoint for ordinary runs. Preserve
  shared and live roots until their owners and leases can be accounted for.
- **Proposed change:** Retain `7a74afbf`'s per-identity lease and prune, then add
  a parent-level identity budget with lease-aware retirement across worktrees and
  short-lived runtime roots. Give direct Jest a bounded lifecycle too. Do not use
  age alone to evict transform entries: cache hits do not refresh modification time.
- **Dependencies:** None. Compiling what test variants share once per run, in
  [`Tao tooling performance.md`](<../Tao tooling performance.md>), shrinks what each compile adds but
  does not bound the total.
- **Acceptance:** Repeated ordinary and direct-Jest runs plateau under an explicit
  aggregate byte/file/identity budget. Focused controls cover concurrent worktrees,
  live readers, failed runs, killed owners after grace, and inactive identity
  retirement. The legacy shared root remains untouched until an owner-reviewed
  liveness and migration decision.
- **Source:** Tao tooling performance work, 2026-09-21.
