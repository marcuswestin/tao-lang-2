# DEVENV-LANDING-SNAPSHOTS-MAIN-BEFORE-WAITING-FOR-THE-LOCK — A landing that queues behind another loses to every landing that finishes while it waits

- **Status:** Candidate
- **Section:** External
- **Area:** Landing, verification lanes, parallel agents
- **Impact:** On an evening when several agents land, `just land` refuses itself after every wait for
  the lock, so a branch that is ready cannot land without an agent re-merging `main` by hand and
  re-running `finalize` between attempts. Four attempts and about forty minutes landed one two-commit
  branch on 2026-09-21.
- **Evidence:** `packages/testing/verification/verification-src/MergeWithMain.ts`: the preflight
  reads `main`'s head before `acquireLandingLease`, `createSnapshot` copies it into
  `currentMainHead` after the lease is granted, and `stabilizeAndVerify` then calls
  `assertExpectedLocalState`, which compares local `main` against that value and throws
  `Repository state changed after preflight; refusing to continue the merge.` Two landings of
  `feat/smoke-gate-and-inset-decisions` waited 5 and 11 minutes for the lock
  (`.artifacts/tmp/land2.log`, `land3.log` in the worktree that ran them), each behind a landing or
  lane elsewhere, and each was refused on that line right after taking the lock, because the
  landing it waited behind had moved local `main` (`22ea66d4` → `9c048a99`). A third attempt was
  refused before the lock because the by-hand merge of `main` counted as a new commit the merge
  message had not been confirmed for; the fourth landed in 45 s. Measured: the four logs. Inferred:
  that the mirror-worktree fast-forward another landing performs is what moves local `main`.
- **Workaround:** Run `./agent unsandboxed finalize` to integrate current main and record the
  message for the new HEAD, then retry `./agent unsandboxed land`. If another landing moves main
  during the next wait, repeat from `finalize`.
- **Proposed change:** Re-read the preflight facts after the lease is granted, or take the snapshot
  of `main` inside the lock. `references/landing.md` already says local `main` being behind is no
  longer a precondition and that the landing integrates whatever `main` has become; the snapshot
  check should hold the feature worktree still, not `main`. Let `finalize` treat a merge of `main`
  that changes no branch-authored content as not needing the message re-confirmed.
- **Dependencies:** `Docs/Roadmap/Parallel agents on one machine.md` owns the lock's wider design.
- **Acceptance:** A landing that waits behind another and finds `main` moved integrates it and
  continues, and a test in `verification-tests` pins that a moved `main` during the lock wait does
  not refuse the landing.
- **Source:** 2026-09-21 landing of `feat/smoke-gate-and-inset-decisions`.
