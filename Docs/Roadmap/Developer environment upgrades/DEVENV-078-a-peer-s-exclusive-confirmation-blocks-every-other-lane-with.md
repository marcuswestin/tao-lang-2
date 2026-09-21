# DEVENV-078 — A peer's exclusive confirmation blocks every other lane without bound

- **Status:** Candidate
- **Section:** External
- **Area:** Parallel verification
- **Impact:** While any lane holds the machine-wide exclusive lease, `tryAcquire` returns nothing to
  every other lane, and a waiting lane retries forever with no deadline. A `./dev test` lane started
  inside a test therefore hangs until that test's own timeout, so a gate reddens for something
  another worktree is doing. On a machine running several lanes, contention confirmations are
  frequent enough that this is a routine failure rather than a rare one.
- **Evidence:** `packages/dev/dev-tests/test-runner.test.ts`, `an exact-file subset does not teach
  the full-suite timing estimate`, timed out at 60s in a lane and again at 120s in isolation, while
  `~/.cache/tao/machine-lanes/.exclusive` was continuously held — first by PID 14313, then by PID
  1658, across a 60-second sample at six-second intervals. The test's own lane was registered and
  visible at `0/1` slots throughout. The same test passed in 24.7s minutes earlier, in a window with
  no lease, and hung identically at 45s on pre-change code while a lease was held, so this is the
  lease and not the admission rule DEVENV-077 changed.
- **Evidence, second round:** the same evening, four `verify-changed` attempts on one branch were
  frozen by it, one of them mid-run between two gates. Sampled at six-second intervals, the lease
  passed between three different worktrees' lanes in a train of short holds, so a waiting lane that
  loses the gap waits again; the machine sat at load 11.4 on 18 CPUs with four lanes registered, one
  slot reserved, and nothing able to start. That is the reported symptom exactly — CPU far from
  pegged and tests not starting — reached without any slot being scarce.
- **Evidence that the isolation is nominal:** the lease drains peers to zero slots, but slots do not
  bound CPU demand (see DEVENV-077). Sampled during one such confirmation, with one slot reserved
  machine-wide, the load average was 86 on 18 CPUs. A confirmation that believes it has the machine
  to itself can be measuring a host under five times its CPU count, and the one-minute load average
  it judges by is still mostly the drained peers' work. So the lease charges every other lane for an
  isolation its own verdict does not actually get.
- **Workaround:** Re-run the file when no other worktree is confirming. A waiting node now names the
  holding lane, so the cause is visible in the run rather than only in the registry.
- **Proposed change:** Decide what an exclusive confirmation may cost its peers. A holder that keeps
  the machine past a bound should lose it or be reported; a lane that waits past one should fail
  with `machine-contention` rather than hang until an unrelated timeout fires. A test that starts a
  real lane may also deserve an isolated registry root, which would make it independent of what the
  machine is doing at the time.
- **Dependencies:** Adjacent to DEVENV-077: both are the machine refusing every admission at once,
  and this is the remaining cause of it.
- **Acceptance:** A lane blocked by a peer's exclusive confirmation either starts within a bounded
  wait or fails with a message naming the holder, and the test above does not depend on what other
  worktrees are doing.
- **Source:** 2026-09-18 repository-deduplication branch, while verifying DEVENV-077.
