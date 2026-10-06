---
name: verification-lanes
description: >-
  Choose and interpret Tao verification workflows. Use when selecting or running test and
  verification lanes, diagnosing a red lane, a failed Verify partition, or pr-checks, retrying
  one, assessing cache or test selection, comparing machine and CI contention or the partition
  count, reporting long gates, or preparing finalize.
---

# Verification Lanes

`./agent help` and each command's own `--help` print the lane scopes, their composition, and the flags; read those rather than a second copy here. This skill owns what they do not print: the caching and test-selection reasoning (`references/caching-and-selection.md`), CI contention and coverage (`references/hosted-verification.md`), and the judgment calls below. `landing` owns the route that proves a merge.

Run a host-only lane through its listed wrapper shape, such as `./agent unsandboxed studio-smoke`;
the plain `./agent` shape stays sandboxed.

`quiet-ui-workflows` owns authorization for visible windows and focus during host lanes. Native
host-control, Mac2, and manual checks require `--show-studio` after that authorization; otherwise
defer them before launch. Native canary and simulated-user probes run with hidden windows and
need no visibility flag. Ordinary native development launches open Welcome; `--no-browser`
does not hide it. Report deferred visible acceptance separately from completed quiet checks.

For development loops used during acceptance, follow `quiet-ui-workflows`' managed-session
guidance. A background start receipt or successful reload dispatch is not a behavior-test verdict.

## Reading a red lane

- After a broad failure, let the runner finish cleanup and release its leases, diagnose the failed scope with an explicit file or name target, fix it, then repeat broad verification. An aborted or filtered run is not complete coverage. Command help owns the failure policy; keep diagnostic scope explicit instead of repeatedly paying for a broad inventory of failures.
- Read `.artifacts/logs/<lane>/latest/summary.json` first; it names each node's failure cause. A separately recorded retry, not concatenated output, owns the final classification: a node failing again on its isolated retry is `repository`, not `machine-contention`.
- For hosted `Verify`, `./agent pr-checks --wait` follows the run and says why failed checks failed; a failed partition uploads its `verify-partition-<k>` logs. Diagnose from those, fix, and push again through `landing`'s route; a run link is not completion.

## The machine-wide landing lock

You do not claim it by hand. Ready `./agent unsandboxed land` processes queue FIFO, ahead of new broad lanes;
an active holder is never preempted. While queued, they refresh main without full verification.
`verify`, `verify-full`, `verify-full-sandbox`, and `test-all` take it
for the length of the run, and `./agent unsandboxed land` takes it once for the whole landing, so **`land-lock` and
`land-unlock` are recovery and debugging tools**, not part of the normal path. Everything narrower
needs no lock and never waits — `test-file`, a named test, `test-retry`, `check`, `fix`, `fmt`. While
a **landing** holds it, `verify-changed` and `test-changed` additionally wait; lanes already running
drain. `./agent board` names the phase a landing is in and how long it has been in it, which is what
separates a lock doing useful work from one waiting on an agent. Nothing takes it away on a timer:
forcing one is the Developer's call, so bring `./agent board` to the Developer rather than running `--force` yourself.

## `./agent finalize`

For a Developer-directed edit or commit in the primary `dev/<name>` checkout, do not run `finalize`.
Use available focused checks, commit the exact reviewed paths when asked, and leave full verification
to authorized landing. Other work may be in progress in that shared checkout.

It is not a step of any landing: the hosted route needs only the reviewed message, and
`./agent unsandboxed land` does its own preparation, integration and verification in one process.
It is the iteration-time readiness command for the local route before landing is authorized. It
brings a branch to ready:
asserts the branch and a clean tree, integrates `main`, runs a verification lane only when no green
record already covers this exact tree, drafts the merge message from the branch's own commits when
none exists, and prints what remains. An existing merge message is kept; `--redraft` is the explicit
request that replaces it with a fresh mechanical draft. Cheap and safe to re-run — it records what it
established and redoes only what changed — so run it instead of the sequence by hand, and again after
every round of the Developer's corrections. `--check` previews without touching anything. Completing the work
still means commits landed, worktree clean, affected documents refreshed, the reachable host lanes
run, and the message reviewed and edited, never handed over as drafted. `./agent board` reports every
worktree's branch, cleanliness, finalize state, and last proof, beside the lane and lease registry —
read it before calling a slow lane a regression, and before landing, to see who else is close.

## Working inside a busy machine

- Local lanes are for iteration and diagnosis; never repeat CI-covered verification locally, and
  never offer a broad local lane as merge evidence. Hosted `Verify` is the portable final proof even
  when a local lane would finish sooner.
- Never background a gate and then poll for its output in a sleep loop: run it in the foreground with
  a timeout, since the gate is no faster for being backgrounded. **Reporting while a lane runs**,
  below, is the one exception — a lane too long to wait out, with the Developer waiting on it.
- Refresh the roadmap, ledger, and spec documents the work changed **before** verifying; a tracked
  edit made after a green lane changes the tree that lane proved, so the next lane runs everything
  again from nothing.
- A lane that is slow is usually not a regression — read `.artifacts/logs/<lane>/latest/summary.json`
  first. `overlap` names every other Tao lane that ran at any moment of it (`solo: true` means none);
  `contention.contended` also trips on load a broad lane raises by itself, so it cannot say that.
- Every worktree's `verify-changed` and broad-lane runs, with timing, overlap, and failure reason, and
  every landing's outcome and phases, append to the machine-wide history under
  `~/.cache/tao/machine-lanes/history/` (`runs.jsonl`, `landings.jsonl`), which outlives reclaimed
  worktrees. Compare timings there, not in one checkout's `.artifacts/`.

## Hosted verification

Read [hosted verification](references/hosted-verification.md) before judging CI contention, a
partition count, or what hosted `Verify` covers. A change meant to make CI faster carries its own `./agent ci-timings` before-and-after
(`references/ci-speed.md`).

## Periodic performance proof

Run `./agent unsandboxed performance-check` for a pipeline performance change and during a periodic
repository pass. It measures language operations and real Studio saves sequentially, separately from
the parallel `verify-full` lane. Its report owns admission, ceilings, contamination, and the verdict;
retain an inconclusive run and repeat unchanged code after contention clears. A correctness smoke
under load does not qualify a speed budget. `pipeline-performance` owns the implementation workflow
and `test-quality` owns deterministic regression proofs.

## Reporting while a lane runs

A lane running for many minutes is the one place where backgrounding a gate is right, because the Developer is
waiting on it and a silent agent is indistinguishable from a stuck one. Backgrounding buys the turn
in which to say something; it does not buy the right to say nothing.

- Decide by how long the run is, not by which is tidier: a gate finishing inside a minute runs in the
  foreground with a timeout, while `open-pr --auto-merge`, `verify-full`, and
  `./agent unsandboxed land` may run backgrounded with a report.
- Report about every 20 seconds from start to verdict, one line each: what finished since the last
  note, what is running now, and anything that has already failed. A note that the same node is still
  running is the report the Developer wants, because it dates the silence — do not wait to be asked.
- Take progress from the backgrounded command's own output and `.artifacts/logs/<lane>/<stamp>/`,
  where each node's `.log` lands as it completes; `latest` and `summary.json` land only when the lane
  finishes, so never read them for progress, and report what the run printed rather than a verdict of
  your own — a node timed out under load is the runner's to classify on its isolated retry.
- Stop reporting when the lane reports, then give the outcome once with the evidence behind it and
  the gates that did not run. Never add a sleep loop whose only product is a progress note.
