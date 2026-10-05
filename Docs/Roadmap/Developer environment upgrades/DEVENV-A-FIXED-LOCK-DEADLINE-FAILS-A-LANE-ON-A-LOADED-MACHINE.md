# DEVENV-A-FIXED-LOCK-DEADLINE-FAILS-A-LANE-ON-A-LOADED-MACHINE — A fixed lock deadline fails a lane on a loaded machine

- **Status:** Incoming
- **Section:** External
- **Area:** Parallel verification
- **Impact:** A verification lane fails with no product defect when the machine is busy, because a
  test that waits on the Jest transform-cache file mutation lock gives up after a fixed wall-clock
  deadline. The run reads as a red lane, so the author re-runs a full `verify` that the same load
  can fail again.
- **Evidence:** On 2026-10-03 `finalize` on `feat/staged-release-qa-2` failed `tao-apps#6` with
  `Timed out waiting for the file mutation lock …/jest-transform-cache-v2/coordination.tao-file-mutation.`
  after its suite had passed 12 of 12 tests, while the five-minute load average stood at 138. The
  only change since the previous green run was one roadmap paragraph. The deadline is
  `FILE_MUTATION_LOCK_TIMEOUT_MS = 120_000` in `packages/shared/shared-src/FS.ts:856`. The run before
  it failed `tao-apps#1` on the lane's 240-second silence limit under a load of 122.
- **Additional evidence (2026-10-05):** Instruction-only `feat/contention-aware-ci-guidance`
  at `c5860acc2`, after integrating `b4c88165d`, failed local finalize on the mutation lock for
  `packages/apps/stdlib/@tao/device/files.tao`. Its verification report recorded two overlapping
  Tao lanes and peak load 15.7 on 18 CPUs; compiler shards 1–3 passed on isolated retry, while
  other compiler, parser, and validator timeouts lacked exclusive confirmation. Log:
  `.artifacts/logs/verify/2026-10-05T16-50-07-518Z-33632-72c97338/compile-word-flower-app.log`.
  After that lane released, the focused `validation-dependencies.test.ts` run compiled WordFlower
  and passed all 12 tests in 7 seconds overall. This does not replace the aborted broad proof or
  establish that every timeout had the same cause; retain the lock failure alongside the existing
  fixed-deadline evidence. No lock was removed and no runtime code was changed.
- **Workaround:** Re-run once the load average falls.
- **Proposed change:** Judge the lock by its holder rather than by the clock, as the archived
  per-test wall-time entry did for test timeouts: keep waiting while the holder is alive and making
  progress, and fail fast, naming the holder, when it is gone.
- **Dependencies:** Related to DEVENV-077 (admission under load) and the archived per-test
  wall-time timeout entry.
- **Acceptance:** A lane run under heavy machine load waits for a live lock holder instead of
  failing, and a dead holder's lock is reported with its owner within seconds.
- **Source:** 2026-10-03 staged-release QA branch.
