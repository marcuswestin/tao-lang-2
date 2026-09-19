# DEVENV-094 — Nothing serializes landing, so ready branches convoy into each other

- **Status:** In progress
- **Area:** Human merge workflow
- **Impact:** Several agents reach "ready to merge" together, each runs the full suite on its own
  branch, one lands, and the rest must integrate the new `main` and verify again — by which time
  another has landed. Landing K branches costs work that grows with K rather than with the change,
  and it spends that work in exactly the window when every lane is slowest.
- **Evidence:** `main`'s own history shows the convoy: of 92 inter-merge gaps under six hours, 25%
  are under five minutes and 43% under fifteen, against a `merge-with-main` verified window of two
  to five minutes uncontended and far longer under load. `inspectMergePreflight` requires exactly
  one `main` worktree and requires it to equal `origin/main`, and `MergeWithMain.ts` takes no lock
  of any kind, so two concurrent `--execute` runs stage a squash in the same shared `main` checkout
  and are caught only afterwards by `Repository state changed unexpectedly while preparing the
  staged squash` — after both have already paid a `full-verify`. `stabilizeAndVerify` restarts the
  whole lane when `origin/main` moves and gives up after three passes.
- **Workaround:** Land one branch at a time by agreement, and re-run `merge-with-main` after the
  preflight rejects a stale `main`.
- **Proposed change:** Take a machine-wide landing lease for the whole preflight-to-push window, so
  a second landing queues with a printed position instead of racing. Inside the lease, verify the
  integration tree — `main` plus the branch — once, and treat the branch-side lane as iteration
  evidence rather than the gate, which removes both the pre-merge pass and the restart. Consider
  landing several ready branches as one verified batch that commits as separate squashes, so K
  branches cost one pass.
- **Dependencies:** DEVENV-092 (the lanes a batch would run); `MergeWithMain.ts` preflight and
  `stabilizeAndVerify`; the lease can reuse the registry in `MachineLanes.ts`.
- **Acceptance:** Two `merge-with-main --execute` runs started together land one after the other
  with one verification pass each and no `Repository state changed unexpectedly` failure; landing
  three ready branches costs one full verification, not three.
- **Source:** 2026-09-17 merge-finalization performance investigation.
