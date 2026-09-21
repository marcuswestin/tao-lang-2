# DEVENV-073 — Gate-runner tests assume an idle machine, so contention handling fails its own suite

- **Status:** Incoming
- **Section:** External
- **Area:** Verification diagnostics
- **Impact:** `packages/dev/dev-tests/gate-runner.test.ts`, `test-runner.test.ts`, and
  `verification-concurrency.test.ts` assert
  an exact warning list and the presence of `.artifacts/timings/durations.json`. When the host is busy,
  the runner does the right thing — it adds a contention warning and declines to teach the timings store
  from measurements taken under load — and those assertions fail. `verify --complete` and `full-verify`
  therefore go red at random for reasons unrelated to the branch under test, and a merge can need several
  attempts to get through. It is intermittent rather than constant, and a run's peak load average does
  not predict it: on 2026-09-18 the `dev` node failed at peaks of 86.5 and 75.0 on 18 CPUs but passed at
  89.4. What decides it is what the runner samples while those few tests run, so waiting for a quiet
  machine is a gamble rather than a fix.
- **Evidence:** On 2026-09-18, `bun test packages/dev/dev-tests` failed four tests on a tree whose only
  difference from `main` was one validator diagnostic and one ledger entry, neither under `packages/dev`
  or `packages/shared`. `gate-runner.test.ts:157` received one extra warning,
  `machine contention: no other Tao lane registered; load peaked at 75.0 on 18 CPUs`; `gate-runner.test.ts:299`
  and `:326` and `verification-concurrency.test.ts:240` each failed `ENOENT ... /.artifacts/timings/durations.json`.
  All four pass when the file is run alone on an idle machine. Across four `verify --complete` runs the
  failure set tracked host load, shrinking from four to one as the load average fell from 86.5 to 18.8.
  The same three reappeared later that day at `load peaked at 31.8`, and the load they turn on is not
  something lane admission can govern: sampled every ten seconds while they failed, the machine's total
  reserved slots stayed at 1 across five registered lanes while the load average ran 86 down to 20. The
  contention these tests trip over is the load ratio alone — the warning they received says `no other
  Tao lane registered` — so no admission rule makes them green.
  A third file joins them: on 2026-09-18 `test-runner.test.ts`'s `an exact-file subset does not teach
  the full-suite timing estimate` passed its own 60s timeout and carried the whole `dev` node past
  120s, where the file passes 21 of 21 in 1.2s alone. That one failed its isolated retry too, so the
  lane classified it `repository` — worth naming, because a retry is machine-exclusive within its lane
  and not on a box running fourteen of them, and that classification is what a reader takes as proof
  the branch under test is at fault.
  A fourth file shows the same class reaching a test that is not about verification at all, and shows
  why the isolated retry does not save it: on 2026-09-19 at a peak load of 723.9 on 18 CPUs,
  `dev-data.test.ts`'s `rejects a save while the server is away and resumes on the server that replaces
  it` failed after 6.2s and the lane classified the node `test-assertion`, which is not a retryable
  kind — so it was the one node of four that never got a second pass, while `studio`, `tao-cli`, and
  `tao-apps` all failed and then passed on theirs. The file passes 14 of 14 in 741ms alone. A
  contention failure that lands as a failed assertion rather than a timeout is therefore invisible to
  the retry policy, and reads in the summary as the branch's own defect.
- **Workaround:** Run the file alone to confirm the tests themselves are sound; treat a `dev` suite red
  whose failures are all timings-store or warning-list assertions as a host-load artifact, and confirm by
  re-reading the warning text for a contention line.
- **Proposed change:** Let these tests state the contention precondition rather than assume it: inject the
  load reading the runner samples so a test can pin an idle or a contended machine, and assert warnings by
  subset against the injected condition instead of exact equality. A test that needs real timings should
  force the teach-the-store path rather than depend on the host being quiet.
- **Dependencies:** DEVENV-001 and DEVENV-003 own the runner behavior these tests exercise; this entry is
  about the tests' assumptions, not that behavior.
- **Acceptance (added):** A contention-caused assertion failure is either retried like a timeout or
  named as contention in the summary, so no lane reports a busy machine as the branch's defect.
- **Acceptance:** The four assertions pass whether or not the runner samples contention while they run,
  proved by pinning both conditions rather than by repeat runs on a busy host, and a genuine
  timings-store regression still fails them.
- **Source:** 2026-09-18 bridged-sidecar file-reference validation, found while gating that branch. Found
  independently the same day on the subagent-delegation branch, which fixed the
  `verification-concurrency.test.ts:240` quarter of it: two lanes at once is contention by
  `MachineLanes.ts:285`'s own definition, so `GateRunner.ts:317` passes `recordTimings: false` and the
  store the test demanded is exactly what the design withholds. That test now asserts what each outcome
  requires — no store when a summary reports contention, a whole one when none does — and passed twenty
  consecutive isolated runs where it had been failing about half. The three `gate-runner.test.ts`
  assertions were fixed the same way on `feat/lane-admission-share`: `RunGatesOptions` gained an
  injected `machineLoadAverage` beside the `machineCpuCount` it already had, the suite's shared helper
  and the two timings-store tests pin an idle machine, and a new test pins a contended one and asserts
  the other half — the contention warning appears and no durations file is written. The whole file
  passed at load 44.15 on 18 CPUs, which is the condition that had been failing it.
