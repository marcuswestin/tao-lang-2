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
  width its parent reserved. It neither registers nor divides again.
- An explicit `--jobs` caps that lane but does not opt it out of machine coordination.

So one worktree running `verify` on an 18-CPU machine can use 18 slots, two converge on 9 each, and
four converge on 4 or 5 each. A new lane may briefly wait for already-running peer work to drain;
the registry fails open only when it cannot be read or written at all.

`./agent doctor` reports what it finds there, and the load average beside it — the one reading that
also counts work no lane registered, such as an Xcode build or another repository entirely.

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
  marked `retried`; a deterministic assertion on retry is a repository failure even though the
  original attempt timed out.
- A contended run does not write `.artifacts/timings/durations.json`. Ordering has a cold-start
  fallback; an estimate poisoned by a neighbouring worktree does not.

An assertion failure is never retried, however busy the machine is, and a timeout on a machine the
run had to itself stays a repository failure.

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
  ledger is under `.artifacts/testing`, so a new worktree starts cold and retries everything.
- `just test` is the complete package and Tao app suite. Gates always use this complete mode and
  never consult the retry ledger.
- `just verify` is the commit gate. `just full-verify-sandbox` runs the same full gate membership in
  a managed shell while explicitly skipping the five host-only Studio gates. Only `just full-verify`
  from an unsandboxed shell proves those five gates.

`just test-flakes` and `just test-slowest` report ledger evidence but are not gates. Changed and retry
runs print one advisory when their change shape or full-run history makes a complete run worthwhile.

## Reading a failed lane

```bash
cat .artifacts/logs/verify/latest/summary.json
```

`firstFailure` names the gate to act on and its log. Before treating a timeout as a regression,
check `contention.contended` and the `warnings` — if a retry already recovered it, the lane says so,
and if it did not, the retry has already ruled the machine out for you.
