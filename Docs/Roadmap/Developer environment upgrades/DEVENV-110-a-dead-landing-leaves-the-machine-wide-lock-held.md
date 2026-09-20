# DEVENV-110 — A dead landing leaves the machine-wide landing lock held

- **Status:** Candidate
- **Area:** Landing and merge workflow
- **Impact:** The landing lock is never reclaimed automatically. When a landing or a `verify` lane
  dies — killed, crashed, or ended with its harness — the lock stays held under a PID that no longer
  exists, and every other worktree queues behind it indefinitely. The machine stops landing until a
  person notices and forces the lock. This is distinct from `DEVENV-093` and `DEVENV-094`, which are
  about contention making landings slow: this one stops them entirely, and no amount of waiting
  resolves it.
- **Evidence:** On 2026-09-19 two locks went stale inside one hour while landing
  `feat/publication-audit-report-d93f40`. `align-tao-apps-dialect-243197` (PID 86672, taken
  22:33:29Z) held it for over thirteen minutes across two `./agent finalize` attempts, which printed
  `Still waiting 5m` and `Still waiting 10m`; PID 86672 did not exist. After
  `./dev land-unlock --force`, finalize acquired the lock immediately and completed a full
  verification without interference, which confirms nothing else held it.
  `wordflower-revolution-rewrite-deaf54` (PID 96689, taken 23:01:22Z) went stale the same way
  shortly after. The warning text is accurate and names the remedy, but only a human reading it acts
  on it.
- **Workaround:** `./dev land-unlock --force`, after confirming the named PID is gone. Confirming it
  is itself unreliable in a sandboxed shell — see `DEVENV-068`, whose intermittent `ps` denial makes
  a dead PID and an unreadable process table look identical.
- **Proposed change:** Have the lock record the holder's process-start identity, not just its PID,
  and treat a lock whose holder is provably absent as reclaimable, so a waiter can take it without a
  human. The Darwin libproc path `DEVENV-068` already prefers supplies exactly that identity, and
  `StudioDeviceTrustStore` already solved the same problem for its own lock. Failing that, have the
  waiter print a single actionable line naming the force command once, rather than repeating a
  five-minute warning that reads as "still working".
- **Dependencies:** `DEVENV-068` — a liveness check that cannot run is what makes the manual remedy
  unsafe.
- **Acceptance:** A landing whose process is killed mid-run leaves a lock that the next waiter
  reclaims on its own, and no agent needs `--force` for a holder that is provably gone.
- **Source:** Observed while landing `feat/publication-audit-report-d93f40` on 2026-09-19.
