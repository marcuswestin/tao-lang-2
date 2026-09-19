# Parallel agents on one machine — design exploration

Status: **exploration, dialogue open**. Fifteen or more worktrees of this repository share one
18-CPU machine, and the agents working in them now interfere with each other more than they
interfere with the code. This is the thousand-mile view of what to share, what to serialize, and what
to stop duplicating. Everything below is measured on this machine on 2026-09-17 unless it says
otherwise. Individual defects belong in `Developer environment upgrades.md`; this document owns the
shape of the problem.

## What the machine actually looked like

One reading, taken while a single `verify --complete` was running:

- **Twelve registered verification lanes at once** — ten other worktrees running `verify`,
  `verify-changed`, or `verify-full` — on 18 CPUs, with load peaking at **34.3**.
- The same `verify --complete`, unchanged, measured **89s** earlier in the afternoon and **207s**
  under that load. Its serial floor went from 84s to 132s. Nothing about the tree changed.
- Two of its suites then failed their per-test hang guards. Both passed in **0.6s** when run alone.
  The failures were starvation, and the only reason anyone could tell was the `contention` block in
  `summary.json`.

That last point is the useful one. The machinery is honest about contention already; what it cannot
do is prevent it.

A second reading, on 2026-09-19, says the registry is not even a complete picture of what to wait
for. Load stood at **22.2 on 18 CPUs with zero registered lanes**: an `xcodebuild` with its
`swift-frontend` children and two bare `bun test` runs, none of which register. Half an hour earlier
the same machine carried **thirteen** registered lanes at once. So the registry's own count swings
between a large undercount and a large number, and a reader who waits for it to reach zero can be
handed a machine at 120% load. Lane count and load average are two independent questions and both
have to be asked; `./agent doctor` is the one command that already prints them together.

## Why the existing broker does not prevent it

`MachineLanes` gives every registered lane a fair share of `cpuCount` and admits each node against a
machine-wide slot budget. It works, and it is the right foundation. Three gaps let the above happen
anyway:

1. **It arbitrates declared widths, not real use.** A node reserving one slot may use one core or
   four. Twelve lanes were each inside their fair share while the machine ran at nearly 2x
   oversubscription, because the sum of what everyone _declared_ was correct and the sum of what
   everyone _did_ was not. The broker already samples load average — for the contention report only.
   Feeding that sample back into admission, holding when `load / cpuCount` exceeds about 1.2, is a
   small change to an existing mechanism and would have prevented the whole episode.
2. **Only top-level lanes register.** A bare `bun test`, a `./tao test`, an `xcodebuild`, a Chrome
   smoke started by hand: all invisible. Ten agents running `verify` coordinate; ten agents running
   `bun test` do not. Measured on 2026-09-19: an `xcodebuild` and two bare `bun test` runs held the
   machine at load 22.2 while the registry reported no lane at all. This is the gap that makes the
   registry unusable as a quiet-machine gate on its own, and it is why the acceptance measurements
   below are still unobtained.
3. **Few scarce resources are named.** The pattern exists and works — the machine-wide
   `studio-native-host` lease means a second worktree's native Studio lane fails immediately with
   `native-host-busy`, naming the holder, instead of timing out. What is missing is coverage: each
   simulator UDID, the Android emulator, the window server across worktrees, the local InstantDB
   stack. `packages/dev/README.md` lists those as "not arbitrated across worktrees", which is
   accurate and is the gap.

## A one-file run should not queue behind fifteen batch lanes

Fair share is the right policy for two lanes and the wrong one for an agent iterating. Measured while
writing this: `./dev test-file <one file>` — normally under two seconds — did not complete in seven
minutes with fifteen lanes registered, because it registers as a lane, receives a one-slot share, and
waits its turn behind whole verification runs. The command an agent runs twenty times an hour is the
one the broker starves.

Interactive work is distinguishable from batch work without guessing, because the entry points
already differ: `test-file`, `test`, and `test-changed` are iteration lanes, while `verify`,
`verify-full`, and `check` are batch lanes. Giving the iteration lanes a small reserved share, or
simply admission priority, costs a batch lane seconds and saves an agent minutes on every edit. The
same argument applies to `./tao check` and a single Studio smoke.

## Elastic work shares; exclusive work takes a lease

The two kinds need opposite treatment, and conflating them is what makes "should verification be
serialized?" feel like a hard question when it is not.

**Elastic** work packs into whatever width it is given: `verify`, `check`, every test suite, the
typechecker, the compile. It should share, and the fix for today's problem is a stricter broker, not
a queue. Serializing verification across worktrees would idle the machine whenever fewer than
`cpuCount` worth of work existed, which is most of the time.

**Exclusive** work cannot be shared at all, and each instance needs a machine-wide named lease:

| Resource                | Why it is exclusive                                                        |
| ----------------------- | -------------------------------------------------------------------------- |
| One simulator or device | Two agents installing to one UDID corrupt each other's install             |
| The Android emulator    | One AVD, one instance                                                      |
| The window server       | `verify-full` already declares it needs the GUI to itself                  |
| Local InstantDB         | One Docker stack machine-wide by design; stopping it stops it for everyone |
| A native Studio session | Already leased, and the worked example the rest should follow              |

`verify` is worth naming explicitly as _not_ an example of this, because it is the intuitive guess:
it holds no device, it is pure CPU, and it is exactly the thing a broker can divide.

## What is duplicated fifteen times and need not be

Each worktree is a full checkout with its own `node_modules`, its own `_gen_*` trees, and its own
`.artifacts/`. Most of that isolation is load-bearing. Three parts are not:

1. **Green records.** A record is keyed by the whole visible tree plus the resolved toolchain, and
   that key is already strong enough to be safe across checkouts: a hit requires byte-identical
   trees read by identical tools. A machine-wide store would let one worktree skip what another has
   already proved at the same tree, which happens constantly when several agents branch from the
   same `main`. The invariant is the hard part and it is already done.
2. **Parser generation.** The content stamp that lets repeat runs skip Langium already exists; it is
   per checkout. Keyed by grammar content hash, one machine-wide cache serves every worktree.
3. **Measured timings.** A new worktree starts cold and re-learns every duration, which is also what
   makes its first runs mis-ordered and its suites unsharded. Durations are a property of the machine
   and the tree, not of the checkout.

## The largest repeated cost is not scheduling

`./tao test Apps/HNReader` — one journey — measures **6.0s**, essentially all language-service
startup. `./tao fix` spends about 5s to report "0 fixed, 123 unchanged". Every lane in every worktree
pays that, repeatedly. A per-machine workspace daemon along `tsserver`'s lines is the single largest
lever on the whole picture: it would cut the prepare phase's critical path, cut the Tao behavior
suite's floor, and _raise the shard cap_, because the cap is precisely that startup cost. It is
language-service work rather than scheduling work, which is why the scheduling overhaul stopped at
the boundary and measured the cost instead.

## One orchestrator: yes for work, no for scheduling

**Scheduling belongs in the machine-level broker, not in an agent.** A broker sees what an
orchestrator cannot — an Xcode build, a person's own Chrome, another harness's worktree — and adds no
round trip. An orchestrator agent that admitted work would be both a bottleneck and the least
informed participant.

**Work assignment is a real problem that no broker solves.** Ten agents are editing one repository;
today, four subagents within one task collided on shared files, and one of them read a half-written
module and reported a defect that did not exist. Two independent agents wrote a `DEVENV-065` entry
for different findings. That is not CPU contention, it is two agents believing they own the same
seam. An orchestrator holding the map of who owns which paths, and admitting new work against both
that map and current load, would address it. The cheap version is not an agent: a shared claims file
plus the load-aware admission above.

## Suggested order

Smallest first, each independently useful:

1. Load-aware admission in `MachineLanes`. Prevents the failure mode above; touches one existing
   mechanism.
2. Admission priority for the iteration lanes over the batch lanes, so a one-file run is never queued
   behind fifteen verification runs.
3. Register non-lane work — a bare `bun test`, `tao test`, a native build — so the broker can see it.
4. Machine-wide leases for each simulator, the emulator, and the window server.
5. Machine-wide green-record and timings stores, keyed as they already are.
6. One persistent browser in the GUI session with a fresh context per run, replacing per-run Chrome
   launches. This also addresses DEVENV-015, where Chrome will not register as an app from an agent's
   process context at all. It converts per-run launches into shared state that no single lane owns,
   so it needs an owner process and a lease, and it must not break the rule that a lane stops only
   the processes it started.
7. The workspace daemon.

## Open items from the verification-scheduling work

The one-graph verification scheduler landed on `main` with two acceptance measurements outstanding,
for the reason this document exists: between three and fifteen other verification lanes were
registered on this machine for the whole measurement window, and the same unchanged run measured
92.5s, 207.3s, and 1798.2s at three, five, and fifteen lanes. Both items need a window when the other
worktrees are idle, and neither is blocked on code:

- A single-lane `verify --complete` before-and-after pair. The components are measured (see the
  numbers above and in `packages/dev/README.md`) and the schedule report gives the packing loss —
  0.0% at three lanes, 8.2% at five — but there is no single-lane wall time for the lane as a whole.
- A `just verify-full` before-and-after pair, unsandboxed. The lane is reachable from an agent
  session: a browser smoke passes from one in 5.5s, so DEVENV-015's Chrome registration failure is
  specific to another harness's process context.

One measured follow-up is worth taking before either: `runtime-jest` is the largest remaining
unshardable test item at 19.7s, and it is pinned at `--maxWorkers=3` by a reservation chosen when the
test gate held only twelve slots. Widening both together is a one-line change that wants a quiet
machine to prove.

### The second attempt, 2026-09-19, and what it settled

A dedicated attempt on 2026-09-19 did not obtain any of the three, and the reason is worth recording
because it is not the one the section above predicts. Waiting for the lane registry to reach zero is
not sufficient and the attempt was designed around the wrong signal: the registry hit zero while the
machine ran at load 22.2 on unregistered work, and over the window the count moved between thirteen
lanes and none. Held against a gate of no lanes _and_ a low load average, no window of the two or
three minutes a pair of runs needs ever opened.

What the attempt did establish, none of which needs redoing:

- **The registry is not the quiet-machine gate.** Both readings above. A future attempt should gate
  on `./agent doctor`, which prints the lane count and the load average together, and should treat
  the load average as the binding one.
- **`runtime-jest` cannot be benchmarked outside a lane on an unprepared tree.** Run directly, it
  fails 20 of 30 suites with `Something went wrong while compiling Tao tests`, because the generated
  parser the suite compiles against is Git-ignored and a freshly switched worktree has not built it.
  Run the lane, or `just verify`, before timing the suite by hand. `DEVENV-090` owns the diagnostic.
- **An interleaved paired design does not rescue a contended measurement here.** Alternating
  `--maxWorkers=3` and `6` round by round, so the same drifting load falls on both arms, still gave
  the 3-worker arm a spread of 22.3s to 51.7s at load 34 to 47. The within-suite effect being looked
  for is a few seconds; the noise is thirty. Contention does not average out at this ratio, and no
  amount of repetition inside a busy window substitutes for a quiet one.

So the three items stand, unchanged in substance and better specified:

1. The single-lane `verify --complete` pair, `before` at `3e1ae411`. Switching HEAD to it needs an
   unsandboxed shell.
2. The single-lane `just verify-full` pair, unsandboxed.
3. `runtime-jest` widened. `SUITE_TUNING`'s `cost` is the whole change: `TestNodes` passes it through
   as both the node's reservation and Jest's `--maxWorkers`, so the two cannot drift. It is
   deliberately left at `3`, because a widening that only a contended machine has seen is a guess.

Neither is assigned to a branch. All three are a measurement in a quiet window rather than a change,
so whoever next has the machine to themselves can take them from here — and should confirm the
machine is theirs by load average, not by lane count.

## Sources

- 2026-09-17 twelve-lane reading, and the `verify --complete` pair at 89s and 207s, taken while
  building the one-graph verification scheduler.
- 2026-09-18 thirteen-lane reading and 2026-09-19 zero-lane-at-load-22.2 reading, taken during the
  second attempt at the acceptance measurements.
- `packages/dev/README.md` for what is shared today and what is not.
- `Developer environment upgrades.md`, DEVENV-015 (Chrome registration) and DEVENV-066 to DEVENV-069
  (the runaway-process class, sandboxed `ps`, cross-worktree edit interference).
