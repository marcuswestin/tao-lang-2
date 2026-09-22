---
name: verification-lanes
description: >-
  Choose and use Tao test, verification, retry, sandbox, reporting, and human merge workflows.
---

# Verification Lanes

`./agent help` and each command's own `--help` print the lane scopes, their composition, and the flags (`--no-cache`, target resolution, `--json`); read those rather than a second copy here. This skill owns what they do not print: the caching and test-selection reasoning (`references/caching-and-selection.md`), the landing command's mechanics and failure classification (`references/landing.md`), and the judgment calls below.

## The machine-wide landing lock

You do not claim it by hand. Ready `./agent land` processes queue FIFO, ahead of new broad lanes;
an active holder is never preempted. While queued, they refresh main without full verification.
`verify`, `verify-full`, `verify-full-sandbox`, and `test-all` take it
for the length of the run, and `./agent land` takes it once for the whole landing, so **`land-lock` and
`land-unlock` are recovery and debugging tools**, not part of the normal path. Everything narrower
needs no lock and never waits — `test-file`, a named test, `test-retry`, `check`, `fix`, `fmt`. While
a **landing** holds it, `verify-changed` and `test-changed` additionally wait; lanes already running
drain. `./agent board` names the phase a landing is in and how long it has been in it, which is what
separates a lock doing useful work from one waiting on an agent. Nothing takes it away on a timer:
forcing one is Ro's call, so bring `./agent board` to Ro rather than running `--force` yourself.

## `./agent finalize`

It is the iteration-time readiness command when landing is not yet authorized, not a step of an
already authorized landing — `./agent land` does
its own preparation, integration and verification in one process. It brings a branch to ready:
asserts the branch and a clean tree, integrates `main`, runs a verification lane only when no green
record already covers this exact tree, drafts the merge message from the branch's own commits when
none exists, and prints what remains. An existing merge message is kept; `--redraft` is the explicit
request that replaces it with a fresh mechanical draft. Cheap and safe to re-run — it records what it
established and redoes only what changed — so run it instead of the sequence by hand, and again after
every round of Ro's corrections. `--check` previews without touching anything. Completing the work
still means commits landed, worktree clean, affected documents refreshed, the reachable host lanes
run, and the message reviewed and edited, never handed over as drafted. `./agent board` reports every
worktree's branch, cleanliness, finalize state, and last proof, beside the lane and lease registry —
read it before calling a slow lane a regression, and before landing, to see who else is close.

## Whether to propose the landing or hold it back

Ro's explicit yes authorizes landing the named slice for the rest of this thread, including retries;
absent one a ready branch waits. What you ask for turns on whether the gates prove the change, not
on its size.

- **Propose it as ready to land** when the gates that ran green cover the change: documentation,
  roadmap, agent instructions, developer tooling, and test-only changes always; product code whose
  behavior the suites actually exercise.
- **Propose it as needing Ro's eyes first** when the change reaches what no gate proves — Studio's or
  an app's visible behavior, a language surface Ro has not seen, native or device paths, or anything
  covered only by the lanes a person runs: `./dev studio-manual-checks`, a device install, and
  everything named in `FULL_VERIFY_SKIPPED`. Say exactly what needs looking at and why.
- A green `full-verify` is not by itself an answer: a change can pass every gate and still be one Ro
  wants to see first, because the thing it changed is the thing Ro is designing. When the two pull
  against each other, say so in the proposal.

## Working inside a busy machine

- Never background a gate and then poll for its output in a sleep loop: run it in the foreground with
  a timeout, since the gate is no faster for being backgrounded. **Reporting while a lane runs**,
  below, is the one exception — a lane too long to wait out, with Ro waiting on it.
- Refresh the roadmap, ledger, and spec documents the work changed **before** verifying; a tracked
  edit made after a green lane changes the tree that lane proved, so the next lane runs everything
  again from nothing.
- A lane that is slow is usually not a regression — read the `contention` block in
  `.artifacts/logs/<lane>/latest/summary.json` first: it names how many lanes shared the machine.

## Reporting while a lane runs

A lane running for many minutes is the one place where backgrounding a gate is right, because Ro is
waiting on it and a silent agent is indistinguishable from a stuck one. Backgrounding buys the turn
in which to say something; it does not buy the right to say nothing.

- Decide by how long the run is, not by which is tidier: a gate finishing inside a minute runs in the
  foreground with a timeout, while `verify-full` and `./agent land` run backgrounded with a report.
- Report about every 20 seconds from start to verdict, one line each: what finished since the last
  note, what is running now, and anything that has already failed. A note that the same node is still
  running is the report Ro wants, because it dates the silence — do not wait to be asked.
- Take progress from the backgrounded command's own output and `.artifacts/logs/<lane>/<stamp>/`,
  where each node's `.log` lands as it completes; `latest` and `summary.json` land only when the lane
  finishes, so never read them for progress, and report what the run printed rather than a verdict of
  your own — a node timed out under load is the runner's to classify on its isolated retry.
- Stop reporting when the lane reports, then give the outcome once with the evidence behind it and
  the gates that did not run. Never add a sleep loop whose only product is a progress note.
