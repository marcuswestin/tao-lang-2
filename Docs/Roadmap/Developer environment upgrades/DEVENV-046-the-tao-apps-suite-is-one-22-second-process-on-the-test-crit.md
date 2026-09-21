# DEVENV-046 — WordFlower remains the tail of the sharded Tao app tests

- **Status:** Candidate
- **Section:** External
- **Area:** Test performance
- **Impact:** The WordFlower shard is recorded as the serial floor of the Tao app tests, and every
  proposal in this entry's earlier revisions — widen the shard, resize it elastically, split the app
  root — was argued from that recording. The recording was wrong. The tests are fast; what is slow is
  the fixed per-invocation cost around them and the contention they were measured under. The entry is
  kept rather than closed because its conclusion ("do not widen or split") turns out to be right for
  a reason it did not state.
- **Evidence:** Measured directly on 2026-09-21: `./tao test "Apps/WordFlower/1 - Current"` completes
  in **3.58s wall warm** for 29 tests, of which Jest is 2.76s; cold, the same run is roughly 9.2s.
  The figures this entry previously reasoned from — a 56.9s shard against a 53.7s expectation, a
  51.3s observation with only 6.6s of Jest — came from the per-node duration ledger, which under
  `--concurrent` recorded each observation as the process's elapsed wall time up to that point rather
  than the work attributable to the test. A comparable distortion is visible across the suite:
  `packages/dev/dev-tests/studio-dev.test.ts` runs 61 tests in 3.3s standalone while the ledger
  records a dozen of its cases at ~6.20s each.
- **Correction, 2026-09-21:** an earlier revision of this entry claimed the distortion also reached
  the `Schedule:` line every lane prints. It does not, and the claim is withdrawn. A node's
  `elapsedMs` is set from its own `startedAt` at the moment it begins running
  (`WorkGraph.ts:481`), so it is a genuine wall duration; only the per-test durations a runner
  reports are inflated. Checked against the run at
  `.artifacts/logs/verify-changed/2026-09-21T12-53-31-560Z-30857-09a84fb5`, where the reported
  critical path sums exactly to the reported floor: 17ms + 298 + 40 + 17,182 + 586 + 16,240 =
  34.4s, against a 34.4s makespan. The floor equalling the makespan is not a recording artefact —
  it is what a lane looks like when it really is one dependency chain, here with `_fix-tao` and the
  `dev` suite accounting for 97% of it and the machine genuinely idle around them. Whether that
  chain is worth shortening is a live question; it is just not this entry's.
- **Addressed, 2026-09-21, for the per-test durations:** `GateCatalog.reportsAttributableDurations`
  now owns which suites report a duration that means anything, and `TestLedger` records no
  `durationMs` at all for the suites that do not, rather than storing a number every reader has to
  know to distrust. `TestNodes` shard packing, which had worked around the same distortion
  independently, now asks the same predicate.
- **Evidence, implementation audit:** The earlier audit's conclusion — that the cold tail is
  dominated by the shared-workspace validation and compilation pass rather than by Jest — survives
  the correction and is the useful part of it. That fixed cost is paid once per `tao test`
  invocation, so sharding multiplies it; see
  [`DEVENV-EVERY-TAO-APP-SHARD-COMPILES-THE-PROJECT-AGAIN`](DEVENV-EVERY-TAO-APP-SHARD-COMPILES-THE-PROJECT-AGAIN.md),
  which is where the remaining work belongs.
- **Workaround:** `just test-changed` skips tao-apps when no `Apps/` or `.tao` file changed.
- **Proposed change:** Do not widen, elastically resize, or split the shard — now on the evidence
  that there is nothing there to divide. Re-measure the app shards against CPU time rather than
  wall-clock spans before drawing any further conclusion about them; the measurement fix landed with
  this revision, so the numbers this entry was built on cannot be reproduced and should not be
  quoted.
- **Dependencies:** Re-measurement depends on the per-node CPU-time capture; the remaining
  compile-sharing work is tracked in its own entry. DEVENV-034 (Bun worker pool) is separate.
- **Acceptance:** A fresh set of app-shard timings taken under the corrected measurement, against
  which any future proposal here is argued.
- **Source:** 2026-09-04 development-speed review; 2026-09-20 sharded scheduler follow-up; premise
  corrected 2026-09-21 after direct measurement.
