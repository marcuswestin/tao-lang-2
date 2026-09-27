# DEVENV-094 — Simultaneous worktree finalizations collapse verification throughput

- **Status:** Candidate
- **Section:** External
- **Area:** Parallel verification
- **Impact:** Every agent finishing its task runs the repository's heaviest lane at the same moment,
  so the fair share per lane falls to one or two slots and a lane that takes well under a minute
  alone takes many minutes. This is the largest single component of "finalizing takes far longer
  than expected", and it grows with the number of active worktrees rather than with the change.
- **Evidence:** 260 recorded non-`dev-test` lane runs across every checkout, bucketed by how many
  other lane runs overlapped them: one lane median 37.8s (p90 88.1s), two 54.7s (p90 207.5s), three
  75.8s (p90 390.4s), four 691.3s, five 366.3s — superlinear, not proportional. On 2026-09-17 at
  17:01 local, `ps` showed eight gate-runner processes plus a `full-verify` and a
  `merge-with-main`, and `~/.cache/tao/machine-lanes` held 13 live lane records — none stale —
  holding **two admitted slots between them** while 16 of 18 CPUs' worth of budget went unissued.
  A control `verify --complete` started in this worktree at that moment took **721.5s against a
  32.5s uncontended median, 22x**, reporting `13 Tao lanes ran at once; load peaked at 36.2 on 18
  CPUs`; within it `_test` took 266.6s against ~34s, `_fix-tao` 107.5s against 3.3s, and
  `_compile-word-flower-app` 18.1s against 0.65s. Two candidate causes to separate: the fair-share
  floor gives each of 13 lanes a ceiling of one or two slots, and every admission decision takes
  the single advisory registry lock, so 13 contenders may spend admission in lock contention rather
  than in work.
  A 2026-09-26 `verify-changed` in `feat/clerk-device-acceptance` took 315.6s with six overlapping
  lanes and peak load 172.8 on 18 CPUs. The shipping stale-reclaimer timing assertion and Studio
  malformed-handshake assertion failed, then their exact files passed unchanged in separate
  invocations (3.2s and 11.0s of suite time). The failed run is
  `.artifacts/logs/verify-changed/2026-09-26T22-15-40-789Z-81198-1fab9590/summary.json`;
  retries are `.artifacts/logs/dev-test/2026-09-26T22-23-47-694Z-43035-99bd2067/summary.json`
  and `.artifacts/logs/dev-test/2026-09-26T22-23-48-592Z-43200-845f1769/summary.json`.
  These are observations under contention, not a measured causal explanation or an admission benchmark.
  A 2026-09-27 UTC `verify-changed` in `feat/visionos-development-setup` stopped after 506.5s
  with `Timed out waiting for the machine-lane registry lock.` The board sampled two concurrent
  lanes, each reporting 16/16 slots, and load 220.7 on 16 CPUs. Type checking took 230.6s;
  several suites timed out or were interrupted. The command log is
  `.artifacts/logs/agent/verify-changed/2026-09-27T00-07-22-109Z-38825.log`.
  This is another contention observation; no scheduler settings or foreign processes were changed.
  A 2026-09-27 UTC (2026-09-26 local) `verify-changed` in `feat/native-tooling-followup`
  failed after 812.9s wrapper / 800.6s lane time, with three overlapping lanes and peak load 273.2
  on 16 CPUs. An earlier run of the repair passed in 74.9s; this later run also included its updated
  evidence document. Logs: `.artifacts/logs/verify-changed/2026-09-27T00-07-24-205Z-38997-da30868d/summary.json`.
  Failures included the cache-process lifecycle test's outer 120s deadline, an Expo launcher
  argument probe returning an empty string, and a Clerk exchange returning 401 instead of 200.
  The Clerk fixture freezes its clock at creation (`clerk-account.test.ts:305–310`) and issues the
  late exchange's token with only ten seconds beyond that frozen time (`:73`); the provider verifies
  against the real clock with zero skew. Expiration is a plausible separate fixture defect, not
  a captured verifier diagnosis. No cache-retention assertion failed before the lifecycle timeout.
  Checkout doctor remained usable but itself took 82.0s and observed another lane plus load 224.4.
  These failures do not establish a Hutch regression or an uncontended scheduling result; their
  retry disposition must remain separate from the failed run. `./agent test-retry` recovered the
  Expo-host and account-server suites, but CLI, compiler, Studio, and validator nodes still failed.
  Several 300s node deadlines reported after over 1,200s. The retry was interrupted with SIGINT
  after 1,406.8s (exit 130), not accepted as green; log
  `.artifacts/logs/agent/test-retry/2026-09-27T00-27-44-080Z-61621.log`. No uncontended control was
  established, and nothing about that interruption settles the cause of the original failures.
- **Workaround:** Verify when the machine is quiet, or read the `contention` block in
  `summary.json` before treating a slow lane as a regression.
- **Proposed change:** Admit whole heavy lanes machine-wide in arrival order rather than splitting
  the machine between all of them at once, so two or three lanes run at full width and the rest
  queue with a printed position; reconcile admitted slots with real CPU use, since 13 lanes holding
  one slot each drove load to 28 on 18 CPUs, which means a slot does not describe what a suite
  actually spawns.
- **Dependencies:** `MachineLanes.ts` `fairAllocations` and the `WorkGraph` reservation path;
  builds on DEVENV-001 rather than replacing it.
- **Acceptance:** With ten lanes requested at once, the median completion time of the first three is
  within 1.5x of the uncontended median, and no lane fails a gate it passes alone. `just
  admission-experiment --provision 10 --lane verify` measures exactly this: it makes its own ten
  checkouts, runs the lane alone first for a baseline, runs all ten at once, removes what it made,
  and refuses to start on a machine that is not quiet. It must run outside the agent sandbox, which
  cannot write the checkouts it creates, and the lane must be a broad one — a narrow lane is admitted
  immediately and never touches the queue this measures. The second clause replaces "total wall time for all ten beats today's fair-share behavior",
  which can no longer be measured because fair share no longer exists to compare against — and which
  measured the wrong thing anyway: the starved hang guards, not the seconds, are what made contention
  expensive.
- **Still unmeasured:** The change landed on 2026-09-21 and `ADMITTED_LANES = 2` has never been
  measured. The constant was read off this entry's own buckets, which were recorded under fair share,
  where every lane was simultaneously throttled to a fraction of the machine — and through per-node
  durations since shown to be process-elapsed spans rather than work. Both halves of that evidence
  have been replaced, so the number stands on nothing and the experiment above is what settles it.
  Two known distortions to resolve alongside it, each with its own entry: an admitted seat is held by
  registration rather than demand, so a lane blocked on the prepare lock idles half the admission
  budget; and a queued node's first wait is charged to the lane rather than the machine, so
  `summary.json` under-reports contention for exactly these runs.
- **Note:** Carried an earlier `DEVENV-076` number that another branch reused while this entry
  existed only as a body in the index; renumbered rather than renumbering the merged file.
- **Source:** 2026-09-17 merge-finalization performance investigation.

- **Subsequent integrated verification (2026-09-26):** After merging origin/main `47fa4dc9` into `feat/native-tooling-followup` at `bd66e272`, complete Verify passed in 213.8s (213.5s schedule makespan). Two Tao lanes overlapped and load peaked at 46.8 on 16 CPUs. Evidence: `.artifacts/logs/verify/2026-09-27T01-04-38-596Z-95890-5d89a101/summary.json`. This is warm-cache recovery evidence on a newer tree, not an uncontended benchmark or proof that the earlier failures shared one cause. A later main integration requires its own verification.
