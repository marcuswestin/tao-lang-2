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
- **Evidence, the distortion reaches the schedule line every lane prints:** the per-node `elapsedMs`
  this entry found inflated is also what `chainDuration` sums to produce `serialFloorMs`
  (`packages/dev/dev-src/repository-tests/WorkSchedule.ts:113`), so the `Schedule:` line ending every
  verification — serial floor, critical path, idle slot-seconds — inherits it. The tell is that the
  floor keeps coming out equal to the makespan: four consecutive runs on 2026-09-21 reported 42.3s of
  42.3s, 52.5s of 52.5s, 79.0s of 79.1s and 52.1s of 52.3s, each naming a chain ending in `tao-apps`,
  with 23-83% of slot-seconds called idle. That is what a floor computed from wall-clock-to-date
  looks like, not a real dependency chain. It matters more than the per-test figures, because this is
  the line an agent reads to decide where a lane's time goes: on 2026-09-21 an agent reported to Ro
  that the machine was 83% idle waiting on one serial chain, which these numbers say and the measured
  3.58s WordFlower run contradicts. Fixing the recording fixes both readings.
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
