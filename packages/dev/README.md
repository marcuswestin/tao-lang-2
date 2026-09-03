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
  and divides `cpuCount` by the number of live lanes it finds there — never below two slots.
- A lease is removed when the lane ends, and pruned by the next lane when its process is gone.
- A nested runner — `./dev test` inside `verify`, `tao test` inside that — is already inside the
  width its parent reserved. It neither registers nor divides again.
- An explicit `--jobs` always wins, and never registers.

So one worktree running `verify` on an 18-CPU machine gets 18 slots, two get 9 each, four get 4
each. Nothing waits on anything: the registry is advisory, and a lane whose registry cannot be read
or written runs at full width rather than failing.

`./agent doctor` reports what it finds there, and the load average beside it — the one reading that
also counts work no lane registered, such as an Xcode build or another repository entirely.

## What a contended lane reports

A busy machine breaks timing-sensitive work first, and an anonymous timeout looks exactly like a
regression. Lanes therefore sample the machine while they run and say what they saw:

- `summary.json` carries a `contention` block — peak lanes, peak load, CPU count — and the terminal
  rollup repeats it as a `! machine contention:` warning.
- A failure whose output says a clock ran out, in a run that measured contention, is classified
  `machine-contention` rather than `repository`.
- Up to three such nodes are then re-run **one at a time**, and the result is reported either way:
  `passed on an isolated retry` (still marked `retried`, never a plain pass) or `failed again on an
  isolated retry`, which means the failure was never about the machine.
- A contended run does not write `.artifacts/timings/durations.json`. Ordering has a cold-start
  fallback; an estimate poisoned by a neighbouring worktree does not.

An assertion failure is never retried, however busy the machine is, and a timeout on a machine the
run had to itself stays a repository failure.

## What is shared, and what to do about it

| Shared thing                              | How it is handled                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| CPUs                                      | Divided between registered lanes; see above                                                           |
| `studio-smoke` ports (42000+)             | Shard defaults to a per-worktree block, then walks to the next free one                               |
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

## Reading a failed lane

```bash
cat .artifacts/logs/verify/latest/summary.json
```

`firstFailure` names the gate to act on and its log. Before treating a timeout as a regression,
check `contention.contended` and the `warnings` — if a retry already recovered it, the lane says so,
and if it did not, the retry has already ruled the machine out for you.
