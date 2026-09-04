# Repository lanes

How `check`, `verify`, `full-verify`, and `./agent test` behave when several worktrees of this
repository are working at once. `packages/dev` owns the scheduler, the gate catalog, the artifacts
every lane writes, and the doctor; this README owns the operational half — what is shared, what is
not, and how a lane reports a failure it did not cause.

Several agents and people work in linked worktrees under `.claude/worktrees/`, `~/.codex/worktrees/`,
and elsewhere. Every one of them is a full checkout with its own `node_modules`, its own `_gen_*`
trees, and its own `.artifacts/`. What they cannot have their own copy of is the machine.

## What a lane takes

Every scheduling number in this repository is a reservation against `Platform.cpuCount()`. One
checkout may take the whole machine; the fifth may not. `MachineLanes` is the shared fact that makes
that work:

- A top-level lane registers itself under `~/.cache/tao/machine-lanes` before it schedules anything,
  and every node atomically reserves slots from that machine-wide budget before it starts.
- Fair shares are recomputed whenever work is admitted. A lane already above a newly reduced share
  finishes its running nodes but cannot admit more until it is back within that share; total
  recorded reservations never exceed `cpuCount`.
- A lease is removed when the lane ends, and pruned by the next lane when its process is gone.
- A nested runner — `./dev test` inside `verify`, `tao test` inside that — is already inside the
  width its parent reserved. It neither registers nor divides again, but still samples registered
  peer lanes so contended timings are not saved as clean-machine evidence.
- An explicit `--jobs` caps that lane but does not opt it out of machine coordination.

So one worktree running `verify` on an 18-CPU machine can use 18 slots, two converge on 9 each, and
four converge on 4 or 5 each. If lanes outnumber CPUs, every lane retains a one-slot admission turn
while the global reservation check still prevents oversubscription. A blocked node reports that it
is waiting and backs off its registry polling. CPU admission fails open only when its registry is
unavailable; exclusive confirmation and named resources fail closed because they cannot truthfully
claim isolation without shared storage.

Inside one lane, every tree-mutating preflight finishes before readers start. The long `_test` and
`_typecheck` readers are then launched first, and measured critical-path duration orders the rest.
There is no fixed startup sleep: once a child has started, its slot reservation already protects its
worker budget, while a sleep would leave usable capacity idle. Full-verification's Studio smokes
reserve one slot each because they spend most of their wall time waiting on host services; this lets
several smokes overlap the package critical path while the `gui` resource still serializes the two
window-server lanes.

`./agent doctor` reads this registry without pruning or otherwise mutating it, and reports the load
average beside it — the one reading that also counts work no lane registered, such as an Xcode build
or another repository entirely.

## What a contended lane reports

A busy machine breaks timing-sensitive work first, and an anonymous timeout looks exactly like a
regression. Lanes therefore sample the machine while they run and say what they saw:

- `summary.json` carries a `contention` block — peak lanes, peak load, CPU count — and the terminal
  rollup repeats it as a `! machine contention:` warning.
- A structured graph timeout, or a test-framework timeout in process output, is eligible for
  contention confirmation when the run measured contention.
- Up to three such nodes are re-run **one at a time** after an exclusive lease blocks new machine
  admissions and drains peer reservations. If exclusivity cannot be obtained within five minutes,
  the original failure remains and is explicitly unconfirmed.
- Original and retry attempts keep separate output and classification. A passing retry remains
  marked `retried` and is accepted as green gate evidence only because the exclusive run removed
  peer-machine load; a deterministic assertion on retry is a repository failure even though the
  original attempt timed out.
- A contended run does not write `.artifacts/timings/durations.json`. Ordering has a cold-start
  fallback; an estimate poisoned by a neighbouring worktree does not.

A structured assertion or process-launch failure is never retried, however busy the machine is. A
nonzero test process is eligible only when its own output contains a recognized test-framework
timeout, and a timeout on a machine the run had to itself stays a repository failure.

## What is shared, and what to do about it

| Shared thing                              | How it is handled                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| CPUs                                      | Atomically admitted across registered lanes; see above                                                |
| `studio-smoke` ports (42000+)             | Sharded, probed, and held by a cross-worktree block lease for the whole smoke process                 |
| Expo Metro 8081                           | `Ports` falls back to an ephemeral port; the kill prompt warns it may be a neighbour's                |
| Local InstantDB (9020, 3000)              | One Docker stack for the whole machine, by design — `just stop-local-instantdb` stops it for everyone |
| Bun's package cache, Watchman, `~/.hutch` | Shared and concurrency-safe in practice; `./agent doctor` reports Watchman's health                   |
| The window server, Simulator, emulator    | Not arbitrated across worktrees                                                                       |

`./tao test` invoked directly is the one runner outside this: it is the published product CLI, and
it sizes itself to `cpuCount` unless `TAO_TEST_JOBS` is set. Inside `check`, `verify`, and
`./agent test` the graph sets that budget for it, so the unbounded case is only a hand-run
`./tao test` beside another worktree's lane. Pass `TAO_TEST_JOBS` yourself when that is what you are
doing.

The window-server row is the honest gap. `full-verify`'s native Studio and canary lanes hold a `gui` resource
so they never overlap **inside one run**, but nothing stops a second worktree from starting its own.
Two concurrent `full-verify` runs on one machine will interfere; run them one at a time. When it
happens anyway, the lanes time out and the contention report names why, which is the difference
between a wasted afternoon and a re-run.

## Choosing a lane

- `just test "name"` keeps the simple cross-runner name filter; a name matching zero tests fails.
- `just test-file <path>` runs one exact package Bun or runtime Jest file with repository-local tools.
- `just test-changed [ref]` delegates module-aware selection to Bun and Jest and states every suite
  it selected or skipped.
- `just test-retry` re-runs files not green since this checkout's latest complete test run. The
  ledger is under `.artifacts/testing`, so a new worktree starts cold and retries everything. Its
  JSONL history is compacted to a bounded recent window while retaining at least the newest two
  valid outcomes for every recorded test, so one test cannot crowd out another's flake evidence.
- `just test` is the complete package and Tao app suite. Gates always use this complete mode and
  never consult the retry ledger.
- `just verify` is the commit gate. `just full-verify-sandbox` runs the same full gate membership in
  a managed shell while explicitly skipping the five host-only Studio gates. Only `just full-verify`
  from an unsandboxed shell proves those five gates.

`just test-flakes` and `just test-slowest` report ledger evidence but are not gates. Changed and retry
runs print one advisory when their change shape or full-run history makes a complete run worthwhile.

When a lane runs through another command, such as `merge-with-main`, its non-interactive report prints
the local start time for each admitted gate before printing that gate's completion and log path. The
two durable lines remain readable while several gates run concurrently; the interactive dashboard
continues updating its tiles in place.

`just merge-with-main` is human-only and defaults to a non-mutating dry run. Its strict preflight
requires the sole live `main` worktree to equal `origin/main`; a local-ahead `main` must be reconciled
deliberately first. Successful execution removes the invoking feature worktree, so run it from a
shell you are prepared to leave. `--abort` cannot be combined with merge-start flags, and remote-main
movement is bounded to three verification passes before the command stops safely. Snapshots are
written atomically, and `push-started` is an irreversible recovery boundary because a failed client
may not know whether the remote accepted the push.

## Reading a failed lane

```bash
cat .artifacts/logs/verify/latest/summary.json
```

`firstFailure` names the gate to act on and its log. Before treating a timeout as a regression,
check `contention.contended` and the `warnings` — if a retry already recovered it, the lane says so,
and if it did not, the retry has already ruled the machine out for you.
