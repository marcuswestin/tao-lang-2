# Repository lanes

How `check`, `verify`, `verify-full`, and `./agent test` behave when several worktrees of this
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
  finishes its running nodes but cannot admit more until it is back within that share. A lane that
  is running nothing is always admitted one slot, whatever the machine-wide total says.
- A lease is removed when the lane ends, and pruned by the next lane when its process is gone.
- The one remaining nested runner is `./tao test`, the published product CLI, inside the `tao-apps`
  node. It is already within the width its parent reserved, so it neither registers nor divides
  again; the node hands it that width through `TAO_TEST_JOBS`. There is no longer a nested `./dev
  test` inside a verification lane: suites and shards are nodes of the same graph.
- An explicit `--jobs` caps that lane but does not opt it out of machine coordination.

So one worktree running `verify` on an 18-CPU machine can use 18 slots, two converge on 9 each, and
four converge on 4 or 5 each. Every lane keeps a floor of one slot, honoured even when the machine's
slots are all reserved, so a lane that joins a busy machine always starts something instead of
waiting on work that will not shrink for minutes. That is the only oversubscription allowed: above
the floor the machine-wide total still governs, so the bound is `cpuCount` plus at most one slot per
lane that is running nothing. A slot is not a CPU in any case: one slot may run a whole test file's
parallel children, so the reservation total tracks fairness between lanes rather than load. A
blocked node reports what it is waiting for, names the lane holding an exclusive confirmation when
that is the cause, and backs off its registry polling. CPU admission fails open
only when its registry is unavailable; exclusive confirmation and named resources fail closed
because they cannot truthfully claim isolation without shared storage.

Inside one lane there is exactly one graph. Gates, test suites, and the shards of a long suite are all
ordinary nodes of it; there is no second scheduler inside the test gate and no worker budget passed
down through the environment to one. Measured critical-path duration orders nodes within a priority,
a `serial` node — one that cannot use more than one core — sorts ahead of its equal-priority
neighbours because it is a floor the rest can be packed around, and there is no fixed startup sleep:
once a child has started, its slot reservation already protects its worker budget, while a sleep
would leave usable capacity idle. Full-verification's Studio smokes reserve one slot each because
they spend most of their wall time waiting on host services; this lets several smokes overlap the
package critical path while the `gui` resource still serializes the two window-server lanes, which
together are a serial floor of their own and therefore start at t=0.

## Prepare and verify

A node either rewrites the tree or reads it, and `GateCatalog` says which by naming the file classes
each node `writes` and `reads` — `just`, `ts`, `tao`, `gen-parser`, `gen-app`. The scheduler turns
that into edges: a reader waits for the writers of the classes it reads and for nothing else. There
used to be one `mutatesTree` bit instead, and every reader in a lane waited for every fixer in it, so
the TypeScript gates queued behind the five seconds `./tao fix` spends on `.tao` files they have no
relationship with. Five class names replace that, and the kernel is left with edges alone.

The nodes that write anything are the prepare phase. Two things follow from the phase boundary that
an edge cannot express:

- **The prepare phase is serialized per checkout.** Several agents run lanes in one checkout, and two
  of them running generators and fixers over the same files at once is a corruption risk rather than
  a contention one. A lane holds `verify-prepare` under `.artifacts/verify/prepare-lock` until its
  last writer finishes; a second lane waits there and then proceeds into its own read-only phase.
  Read-only phases overlap freely, which is the point of making verification read-only.
- **A green record is keyed by the tree as it stood when the last writer finished.** Writers
  legitimately change the tree, so that is the snapshot the readers proved. The run fingerprints the
  tree again when it ends, and if the two differ something outside this run changed it: the run
  records nothing, fails, and the warning names the paths that changed.

`just verify` runs the fixers, which is why it is the agent's one command. `just check` is the
read-only lane: the same readers with `_tao-check` and `_dprint-check` in place of the fixers.

## How a suite becomes several nodes

`tao-cli`, `studio`, and the other long suites were single processes, so a 25s suite was a 25s floor
on the whole run however idle the machine was. A suite is now split into processes of a few seconds
each, and nothing about the split is hand-written: the count comes from the suite's recorded duration
(`.artifacts/timings/durations.json`) and the files are balanced by their recorded per-test cost
(`.artifacts/testing/ledger.json`), so a suite that grows re-shards itself on the next run. A cold
checkout shards nothing and runs each suite whole.

Sharding is not free — every shard pays the suite's process startup again — and that declared cost is
what caps the count: a shard must carry at least as much work as it spends starting up, or it is
mostly overhead. The cap is deliberately not "stop when the next shard costs more total CPU than it
saves": a verification lane leaves most of an 18-core machine idle, so what it is short of is wall
time, not cores, and trading cores for wall time is the point.

What decides whether a suite shards at all is whether its runner already parallelizes its own run,
and that is a measurement, not a guess. Both of the long ones were measured directly:

- **Jest does, so it stays whole.** 30 files in one process at `--maxWorkers=3` take 19.7s; the same
  files as three processes at one worker each take 21.3s. Its pool covers the whole run, so a shard
  adds a startup without adding any parallelism. It gets a reservation and the matching
  `--maxWorkers`. Re-measuring this by hand needs a tree a lane has already prepared: the suite
  compiles against the generated parser, which is Git-ignored, and without it 20 of the 30 files fail
  for a reason that does not name it (`DEVENV-090`).
- **`./tao test` does not, so it shards.** Its compiler worker pool parallelizes the compile and not
  the run, and its shards are app roots because roots are what the command takes. The whole corpus in
  one process is 49.7s; the same corpus as two concurrent halves is 27.8s — 44% less wall for 13%
  more CPU, which is the trade this whole exercise is for. Its startup, the language-service load, is
  6.0s (`./tao test Apps/HNReader`, one journey), and that is what caps the count. Shrinking it is
  what the workspace daemon in `Docs/Roadmap/` would change, and it would raise the cap as well.

A suite whose numbers say sharding is a loss declares `shardable: false` with the measurement beside
it, so nobody re-derives the conclusion from a duration recorded on a busy machine.

A suite is now a unit of reporting rather than of scheduling. Its shards run as separate nodes and
every rollup groups them back under the suite's name, with the work its shards did together stated
beside the wall time it occupied, because that difference is what sharding bought. The test ledger
still records per-file outcomes, so `test-retry` and both `report-test-stats` reports read the same
evidence whether the suites ran under `./dev test` or inside a verification lane.

## Reading the schedule

`summary.json` carries a `schedule` block and the terminal rollup prints it as one line: the
makespan, the serial floor with the chain that produced it, the idle slot-seconds, and what each node
that waited was waiting on. A lane that got faster because the machine was idle and one that got
faster because its work packs better are indistinguishable from a wall time alone, and the floor is
the honest target — the gap between the makespan and the floor is what packing can still win, and the
floor itself is what only a faster tool can.

A gate is a name in a lane's list; `GateCatalog` says how it runs. Most gates are the Justfile recipe
of their own name. The Studio smokes are the exception: their catalog entries carry the
`./dev studio-smoke` command, and the graph numbers them from the `studio-smoke` worker pool as it
admits them, so `StudioSmoke.resources()` hands each its own ports and artifact root without any
recipe pinning a worker index. Those gates are named for the public recipes that run the same files by
hand — `studio-smoke`, `studio-proof-real-app`, `keyboard-navigation-smoke`, `studio-smoke-native`,
`studio-canary` — and log under those names.

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
- A contended run does not write `.artifacts/timings/durations.json`, and failed or interrupted gates
  do not update their estimates. Ordering has a cold-start fallback; neither a neighbouring worktree
  nor time spent waiting for a stopped child can poison later schedules.

A structured assertion or process-launch failure is never retried, however busy the machine is. A
nonzero test process is eligible only when its own output contains a recognized test-framework
timeout, and a timeout on a machine the run had to itself stays a repository failure.

## What is shared, and what to do about it

Some of it is shared between the agents inside one checkout rather than between checkouts. Each of
those either takes a lock or tolerates a concurrent writer, and which one it is has to be explicit:

| State inside one checkout      | Lock or tolerate                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Generated trees and the fixers | **Lock.** `verify-prepare`, one lease per checkout, held for the whole prepare phase                 |
| The test ledger                | **Lock.** `test-ledger`, under `.artifacts/testing/transaction-lock`; readers merge, never overwrite |
| Green records                  | **Tolerate.** One file per record, published by atomic rename; a torn write can only lose a skip     |
| Run directories and `latest`   | **Tolerate.** Timestamp-plus-pid-plus-uuid names; `latest` is swapped by atomic symlink replacement  |
| The machine lane registry      | **Tolerate.** Atomic admission under its own registry lock; see above                                |
| Processes                      | **Neither.** A lane stops the process groups it started and nothing else — never by name or by tree  |

That last row is a rule, not a mechanism. A lane's teardown signals the process groups it created,
identified by the OS process-start time so a reused PID cannot be hit, and it never looks for work to
kill by command name, port, or working directory. The start time is the whole identity, deliberately:
it is set at `fork` and never moves, while the kernel process name changes at `exec`, so comparing
the name as well made a process captured between the two fail to match itself — and a descendant that
exec'd since the snapshot was then skipped when its tree was signalled. A sibling agent's `bun test`, Metro, simulator, or
Studio session must survive any teardown, and a `server` process policy opts a long-lived child out
of the test-shaped bounds entirely, because servers idle legitimately.

| Shared thing                           | How it is handled                                                                                         |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| CPUs                                   | Atomically admitted across registered lanes; see above                                                    |
| `studio-smoke` ports (42000+)          | Sharded, probed, and held by a cross-worktree block lease for the whole smoke process                     |
| Expo Metro 8081                        | `Ports` falls back to an ephemeral port; the kill prompt warns it may be a neighbour's                    |
| Local InstantDB (9020, 3000)           | One Docker stack for the whole machine, by design — `just stop-local-instantdb` stops it for everyone     |
| Bun's package cache, Watchman          | Shared and concurrency-safe in practice; `./agent doctor` reports Watchman's health                       |
| `~/.hutch`                             | Read only; each worktree clones Hutch's mutable registry into its own `.artifacts/user/studio-hutch-home` |
| The window server, Simulator, emulator | Not arbitrated across worktrees                                                                           |

`./tao test` invoked directly is the one runner outside this: it is the published product CLI, and
it sizes itself to `cpuCount` unless `TAO_TEST_JOBS` is set. Inside `check`, `verify`, and
`./agent test` the graph sets that budget for it, so the unbounded case is only a hand-run
`./tao test` beside another worktree's lane. Pass `TAO_TEST_JOBS` yourself when that is what you are
doing.

The window-server row is the honest gap. `verify-full`'s native Studio and canary lanes hold a `gui` resource
so they never overlap **inside one run**, and across worktrees the machine-wide `studio-native-host`
lease lets exactly one native Studio session run at a time. A second worktree's native lane does not
wait or time out: it fails at once with the `native-host-busy` failure kind, naming the worktree and
command that hold the host, so the summary says why before any minute is spent. Only interactive
`just studio-native` offers to take the host over. If the registry lock under
`~/.cache/tao/machine-lanes` belongs to a dead process, the allocator elects one reclaimer and
removes only that stale lock. A live or unreadable owner is preserved and the waiting lane times
out rather than risking concurrent registry writers; use `./agent doctor` to identify the owner.
Never delete the shared registry while another worktree may be using it.

## Choosing a lane

- `just test [target]` is the fast default: with no target it is `test-changed`. One target resolves
  by existence, not by shape — an existing file or directory runs as a path, anything else is a
  cross-runner test-name filter, and a name matching zero tests fails. The recipe prints the reading
  it chose, which is what makes one positional safe to overload.
- A test-name pattern is a filter, not a scope: it narrows the suites a scope already chose. `just
  test "<name>"` is therefore the changed set filtered to that name rather than every suite filtered
  to it, and `just test-all "<name>"` is the same filter over every suite. `TestRunRequest` carries
  the two as separate fields for that reason. `tao-apps` takes the pattern like every other suite and
  is told to pass on no match, because a name that selects plenty elsewhere normally selects no
  journey — it used to sit such runs out, which silently dropped the Tao behavior coverage from every
  filtered run. A run that matched no journey says so, and that is what the zero-match guard reads: a
  suite reporting nothing per test cannot otherwise be told apart from one that ran and passed. A
  filtered run is never recorded as a complete one — it skipped most of the tests in the suites it
  scheduled, so it can neither call a test green for the retry ledger nor time a suite for the
  timings store.
- `just test-file <path>` runs one package Bun or runtime Jest file, or every test file the registry
  owns under a directory, with repository-local tools.
- `just test-changed [ref]` selects whole suites from the workspace import graph (`PackageGraph`
  reads the `@alias` imports under each package and resolves them through
  `packages/tsconfig.base.json`; `TestSelection.planChangedSuites` maps changed paths onto it) and
  states every suite it selected, why, and every suite it skipped. A package source change selects
  that package and every package importing it; a test file selects only its own suite; an app change
  runs `./tao test` on that app's directory; a repository workflow file selects `dev`; documentation
  selects nothing; a path no rule owns widens the run to everything and names itself. Bun's own
  `--changed` and Jest's `--changedSince` are not used: the first stops at the package boundary and
  the second is ignored beside explicit paths.
- `just test-retry`, or `just retry` under its shorter name, re-runs files not green since this
  checkout's latest complete test run. The
  ledger is under `.artifacts/testing`, so a new worktree starts cold and retries everything. Its
  JSONL history is compacted to a bounded recent window while retaining at least the newest two
  valid outcomes for every recorded test, so one test cannot crowd out another's flake evidence.
- `just test-all` is the complete package and Tao app suite. Complete gates use this mode and never
  consult the retry ledger. Bare `just test` is a heuristic over the branch diff and can be green
  while a suite the change broke elsewhere never ran, which is what `test-all` is for.
- Each verification scope is its own recipe rather than a flag, so it completes under `just v<TAB>`
  and sorts into the order it widens in. `verify-changed` runs the fix, typecheck, lint, and build
  gates with `_test-changed` in place of `_test`, under the `verify-changed` lane; it is the
  iteration gate. `just verify` is the same graph with `_test`, under the `verify` lane; it is the
  gate before a reviewed commit and before the merge, and `merge-with-main` runs it on the squash.
  `verify-full` and `verify-full-sandbox` widen from there. `--no-cache` is the one flag they share.
- Every lane that passes `--green-tree` to `./dev gates` records what it proved under
  `.artifacts/verify/green/`, one small file per record. A record is keyed by the **whole visible
  tree** of this checkout — never by a test file, a package, or any declared input set — together
  with the resolved `.devenv/profile` symlink target, which pins bun, node, just, and dprint at once
  (`bun.lock` is tracked and so already inside the tree hash). That coarseness is the design: it is
  what makes it impossible to reuse a verdict after a file the run depended on changed, without
  anyone having to declare that dependency. There is no time-to-live, because time is not what makes
  a verdict stale. A later run on the same key stands on the record and prints its evidence instead
  of running, when the record belongs to the lane itself or a lane whose gates contain it: `verify`
  accepts the `verify-full-sandbox` and `verify-full` lane records, `verify-changed` accepts all
  three, `verify-full` accepts only itself. `--no-cache` ignores every record; a red or interrupted run writes none.
- Three kinds of node are never recorded, because the key does not describe their verdict:
  - a node that rewrites the tree or fills a generated directory, whose output is derived state;
  - a node whose verdict depends on the host — the Studio smokes, the native shell, the canary, the
    bundle proof — declared `hostDependent` in the gate table. This is the only gap in the design
    that can produce a **false green**, which is why it is a declared property of the node and why
    `GreenTree.record` refuses a name the caller listed as unrecordable;
  - a test node covering a file the flake ledger has seen flip without changing
    (`just report-test-stats`).
    A tree hash cannot see instability, and a record would leave a flake unrun for as long as nobody
    touches its file — exactly when it most needs to run. The run says which nodes it refused to
    skip and why.
- The backstop for everything a key cannot describe is a cold run on a schedule, not a shorter record
  lifetime: `just verify-full --no-cache` on `main`, nightly or weekly. It belongs wherever the hosted
  gate that reads `summary.json` lands; until that exists, it is a periodic human or scheduled-agent
  run, and making the merge lane cold instead would restore exactly the duplicate run this machinery
  exists to remove.
- `just verify-full-sandbox` runs the same full gate membership in a managed shell while explicitly
  skipping the five active host-only browser and native UI gates. Only `just verify-full` from an
  unsandboxed shell proves those five gates. The simulated editor journey remains individually
  runnable as `just studio-smoke packages/dev/studio-smoke/studio-simulated-user.test.ts`, but its
  gate, `studio-smoke-simulated-user`, is temporarily quarantined from both full-verification lanes
  while DEVENV-042 tracks its unreliable synthetic sketch input.

`./dev test` chooses suites from one registry in `TestRunner.ts`: a Bun suite per package with a
`<name>-tests` directory, `performance-checks`, `runtime-jest`, and `tao-apps`. Each entry owns its
files and knows how to build a process for **any subset** of them, which is what lets `TestNodes`
split it into shards without the registry knowing shards exist; its scheduling weights live in
`GateCatalog` beside every other node's. Every lane above is a filter over that registry — an exact
file, the changed plan's suites, the retry ledger's files, and, composed with any of them, a
test-name pattern — and a source that cannot serve a selection says so in the entry, which is where
the summary's "suite was skipped" note comes from. The gate lanes filter the same registry through the same seam, so the suites a
verification run schedules and the suites `./dev test` schedules cannot drift apart.

`just report-test-stats` prints both ledger reports — suspected flakes, then the slowest tests — in
one run, over the `./dev test-flakes` and `./dev test-slowest` implementations, and bounds both with
one `limit`. It is evidence, not a gate. Changed and retry runs print one advisory when their change
shape or full-run history makes a complete run worthwhile.

Human `merge-with-main` execution hands both verification phases the real terminal, so their parallel
gates use the same live dashboard as a direct `just verify-full` or `just verify`. A non-interactive
merge keeps the durable report: it prints the local start time for each admitted gate before that
gate's completion and log path.

`just merge-with-main` runs only when Ro asks for it in the current request, never on an agent's own
initiative. It takes no flag to do its job: the plain invocation performs the landing, and its flags
only remove work. `--skip-verify-full` omits `just verify-full` on the feature branch, so the staged
squash gets `just verify --complete` instead; `--skip-verify` omits that staged-squash pass;
`--skip-all` implies both after one confirmation that defaults to No and needs a terminal. The
staged-squash **tree-equality assertion** runs under every combination, including `--skip-all`,
because it is a correctness check rather than an optimization: the squash must be the same tree the
verification proved, and a mismatch stops the landing.

Nothing verifies the same bytes twice. When an agent has already run `verify --complete`, the
`verify-full` the merge runs at that same tree skips every gate that run recorded and executes only
the host-dependent lanes, which are never recorded; and because preflight requires `main` to be
merged into the branch, the squash can only be the feature tree, so the bytes `verify-full` proved
are the bytes that land.

**A person works the same way, through the `Mine` recipes.** `just my-branch [name]` switches the
checkout to `dev/<name>` — defaulting to `$TAO_DEV_BRANCH`, then `tao.devBranch` in Git config
(`git config --local tao.devBranch dev/<name>` says it once per machine), then the Git identity —
creating it from `main` the first time and carrying uncommitted work across. `just my-sync` fast-forwards the local
`main` ref to `origin/main`, moves every mirror that follows it, and merges `main` into the branch,
naming the conflicted files if there are any. `just my-resolve` hands exactly those conflicts to an
agent, which resolves them, runs `./agent verify`, and commits the merge. `just my-land` finalizes
and lands. A `dev/*` branch lands through the same `merge-with-main` as a `feat/*` branch, with the
same gates and the same archive.

**The landing touches no checkout but the invoking one.** It builds the squash commit with
`git commit-tree` from the verified feature tree and moves `refs/heads/main` with `git update-ref`
and an expected old value, so nothing is ever staged anywhere and two landings on one machine cannot
interleave — the second is refused and told to merge main and retry. A landing that fails leaves no
commit and no staged state behind, because the commit exists only from the moment the ref moves.
For the same reason the command **refuses to land while any worktree has `main` checked out**: a
checked-out branch promises that a worktree's files match it, and moving the ref underneath turns
that worktree's `git status` into a wall of phantom deletions. A checkout that only exists to show
what `main` holds is detached at main's tip instead (`git worktree add --detach <path> main`), and
every landing moves such a mirror forward itself, as long as it is still clean and still where main
was; a mirror someone has edited is left alone with a warning rather than overwritten. Its strict
preflight requires the local `main` ref to equal `origin/main`, read through the ref rather than
through a checkout. A local-ahead `main` must be reconciled deliberately first. A remote feature branch left behind by later local commits is pushed forward as
the first mutation instead of refusing the landing; a remote holding commits the worktree lacks still
stops preflight, because the squash would drop them. Successful execution preserves the invoking
feature worktree as a clean detached checkout of the archived feature tip, deletes the local feature
branch, and leaves worktree removal to the owning task's archival. `--abort` cannot be combined with merge-start flags, and
remote-main movement is bounded to three verification passes before the command stops safely.
Snapshots are written atomically, and `push-started` is an irreversible recovery boundary because a
failed client may not know whether the remote accepted the push.

## Reading a failed lane

```bash
cat .artifacts/logs/verify/latest/summary.json
```

`firstFailure` names the gate to act on and its log. Before treating a timeout as a regression,
check `contention.contended` and the `warnings` — if a retry already recovered it, the lane says so,
and if it did not, the retry has already ruled the machine out for you.
