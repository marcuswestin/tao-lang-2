# DEVENV-075 — Process-supervision survival assertions flake under load

- **Status:** Candidate
- **Area:** Test execution
- **Impact:** Two tests in `packages/shared/shared-tests/process-supervision.test.ts` fail
  intermittently on a loaded machine, and both are in `_test`, so they red `verify --complete` at
  random. This is the `packages/shared` counterpart to DEVENV-073's `packages/dev` assertions: a
  complete lane on a busy machine now needs several attempts for reasons unrelated to the branch.
- **Evidence:** Eight isolated runs at load 17.85 on 18 CPUs gave one failure, and two later
  `verify --complete` runs failed on it. The assertions are `isAlive(sibling.grandchild)`
  (`process-supervision.test.ts:107`) and `isAlive(server.grandchild)` (`:123`); both assert that a
  backgrounded `sleep 300` grandchild still runs just after its `/bin/sh` parent was signalled.
  Over-signalling is ruled out: `descendantProcesses` walks parentage, on darwin through libproc, so
  a sibling that merely shares the caller's process group is never in the owned tree. The PID parse
  is ruled out: `startTree` waits for a complete `^(\d+)\n` line and for both PIDs to carry
  identities before returning. That leaves the identity match, where `sameProcess` compares the
  recorded `command` as well as `startedAt`. One attempt to exploit that — waiting for the
  grandchild's identity to report an exec'd `sleep` before recording it — was disproved: the
  predicate never became true and all twenty-five runs timed out in that wait, so whatever
  `ProcessTree.identities` reports as that process's `command`, it does not contain `sleep`. That
  change was reverted, not kept.
- **Evidence, second round:** on 2026-09-19 this failed two consecutive `verify --complete` runs on a
  branch touching none of `packages/shared/`, at `peakLoadAverage` 38.9 on 18 CPUs with one lane
  registered — more than twice the 17.85 of the first round, and the machine's own background work
  rather than a second lane. The two runs failed on _different_ assertions of the pair,
  `isAlive(server.grandchild)` (`:123`) then `isAlive(sibling.grandchild)` (`:108`), and the file
  passed in isolation between them in 3.2s. So the rate scales with load rather than sitting at the
  one-in-eight the first round measured, and at this load `verify --complete` cannot be made green
  on an unrelated branch by retrying.
- **Mitigated, not fixed:** a lane no longer fails on this pair once the ledger has watched them
  flip. `FlakeTolerance` demotes a test node whose every failure is a test with two or more recorded
  outcome reversals at an unchanged file identity, the run summary names each demoted test with that
  evidence, and the verdict line says the lane tolerated it. The underlying identity defect below is
  untouched, and tolerance withdraws itself the moment the pair fails three runs in a row or the file
  is edited.
- **Workaround:** Re-run the file; it passes alone most of the time. Do not treat it as a regression
  from a branch that does not touch `packages/shared/`. When the machine is loaded enough that
  `verify --complete` cannot be made green, say so and hand Ro the isolated run as the evidence.
- **Proposed change:** Establish what `ProcessTree.identities` actually records as `command` for a
  forked-then-exec'd child, then make the recorded identity stable across that transition. The
  survival checks are the point of both tests and must not simply be relaxed.
- **Dependencies:** Shares a cause shape with DEVENV-073, but in `packages/shared` and about process
  identity rather than the timings store.
- **Acceptance:** Twenty consecutive isolated runs pass on a machine under comparable load.
- **Source:** 2026-09-18 subagent delegation branch, after merging main.
