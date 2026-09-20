# DEVENV-011 — Preview and native-launch diagnosis

- **Status:** Resolved
- **Area:** Studio diagnostics
- **Impact:** Failed preview bundles and native launch hangs previously produced weak or unbounded
  feedback.
- **Evidence:** Diagnosis endpoint/message and host/preview fixes exist in commits `3c671497`,
  `42218ab2`, and `a2dea067` on `poc/semantic-agent-implementation`. The native half of `d6dde832` --
  clearing a stale Electrobun build lock and refusing to launch while another worktree held the shared
  release -- was dropped when that branch merged `main`: an isolated per-worktree Hutch home removes the
  contention those probes detected, and bounded native phases report a hang that survives it.
- **Workaround:** Inspect Studio lifecycle logs and bind explicitly to `127.0.0.1`.
- **Proposed change:** Re-verify after merge; do not duplicate the branch implementation.
- **Dependencies:** Resolved on current `main`; the bounded launch and actionable preview diagnostics
  are present independently of the historical branch hashes.
- **Acceptance:** Preview failure names the bundler cause and native launch terminates within its bound.
- **Resolution (2026-09-20):** Reverified at `7b7dc0bc`: Studio client passed 89/89, Studio server
  passed 22/22, and Studio smoke-launch passed 6/6. These cover the actionable preview notice and the
  bounded early-child-exit path without reproducing the historical ambiguous readiness timeout.
- **Source:** 2026-09-03 semantic-agent implementation briefing.
- **Archived:** 2026-09-20
