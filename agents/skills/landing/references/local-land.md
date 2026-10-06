# Local `land`

What `./agent unsandboxed land` does, for a personal `dev/<name>` branch and for a feature branch
while GitHub is unavailable. The parent skill owns authorization, the merge message, and `landed`;
`git-workflow` owns the underlying Git commands. Its push to `main` passes the ruleset through the
repository admin bypass.

Remote inspection and push run directly on the host through `./agent unsandboxed land`, which runs
repository code with the normal GitHub credential helper. The final push updates `main`, the
archive, and feature-branch deletion atomically with ref leases. A plain `./agent land` stays
sandboxed, and the `just` and `./dev` landing aliases are human and recovery entry points, not agent
host-access exceptions. A session holds the permission rules it started with: Codex loads
project-local rules at task startup, so a new wrapper prefix needs a new task after it lands; after
changing their source, `./agent setup` refreshes the generated rules where writable, or
`./agent unsandboxed fix-agent-config` in a task that has that prefix loaded.

## One process

The command runs the whole landing as one process with a bounded agent report. Do not assemble it
out of `land-lock`, `finalize`, `verify-full` and `merge-with-main`: the lock used to be held for
36-44 minutes against 5-15 minutes of lane time, and the gap was model turns between commands, not
compute.

**Before the queue**, it rejects missing host capabilities for full verification, using the
required host probes rather than an inherited sandbox environment marker, because an approved
command may retain that marker after the harness has given the process host access. Pause and ask
the Developer for the exact needed intervention; do not retry with alternate commands or skip the
host gates. Unlocked, it then settles what might need an author: this is a clean `feat/*` or `dev/*`
branch checked out only here, no worktree has `main`, the archive ref is free, and
`.artifacts/merge/<branch>.msg` exists and validates. A message saved after the branch's newest
commit of its own is reviewed for this HEAD, so write it once the last commit is made and the first
call proceeds. Otherwise the first call drafts a missing message and refuses, having taken no lock;
read and edit the draft, then rerun. A small review record ties that edit to this HEAD. Merges of
`main` never make a confirmed message stale, including the merge commit that resolves a landing's
conflicted integration, but a new commit of the branch's own does. Do not run `finalize` merely to
prepare an authorized landing: it could integrate and verify outside the lock, then lose that proof
to another landing.

**While queued**, the process keeps its FIFO position, refreshes from new `main` tips, and does not
run full verification. New broad lanes yield to ready landings; running lanes finish normally. A
queued merge conflict removes this request from the queue without taking the lock: resolve and
commit it here, then rerun. A dead waiter is pruned; the lock itself is never stolen. `./agent board`
shows the live queue and holder.

**Inside the lock**, in one `try`/`finally`, it rechecks the preflight, successfully fetches
`origin/main` again and merges that fetched tip into the branch, runs the cheap-gate barrier and
`verify-full`, then fast-forwards local `main` once the verified remote tip is stable, squashes,
pushes, archives, and releases. Local `main` being behind, or the branch not yet containing `main`,
is not a precondition; do not fetch and merge `main` beforehand to satisfy one. An earlier fetch
does not replace the one inside the lock, and preparation that fell back to local `main` because
fetching failed is offline preparation, not current remote integration.

The barrier is `just land-barrier` (`check` plus `dead-exports`), deliberately the **check-mode**
gates, not the `_fix-*` fixers: a fixer writes to the tree the landing is about to commit, and the
landing then refuses itself with `Verification changed the tree this landing was about to commit.`
A red barrier costs ~30s and releases the lock immediately.

**A conflict while integrating `main` ends the lock and hands the worktree back**, durable claim
included. Resolve it here, unlocked, with the machine free for everyone else; commit the merge with
`git commit --no-edit`; run `./agent unsandboxed land` again without touching the merge message. It
re-integrates whatever `main` has become by then.

It touches no checkout but the invoking one: it builds the squash commit with `git commit-tree` from
the verified feature tree and moves `refs/heads/main` with `git update-ref` and an expected old
value, so nothing is staged anywhere and a losing concurrent landing is refused and told to merge and
retry. A mirror worktree showing `main` is detached at its tip and every landing moves it forward
itself; treat it as read-only, and give it a branch before working in it.

Flags only remove work (`land --help` lists them); `--skip-all` (on `merge-with-main`) still defaults
to No and needs a terminal, so there is no way to land unverified non-interactively, and the tree
assertion runs under every combination, because the landed commit must carry the tree that was
verified. A remote feature branch behind the worktree is pushed forward during execution, and only
one holding commits the worktree lacks stops the landing. Success leaves the feature worktree clean
and detached at the archived tip, and deletes the local feature branch. A personal branch archives
each landing at `merged/<name>/<utc>` (`2026-09-28T15-12-03-789Z`; colons cannot appear in a ref).

`./dev merge-with-main` remains the lower half, for `--dry-run` and `--abort` recovery.
`--abort <snapshot>` restores only command-owned local state while the snapshot still matches. Once a
snapshot says `push-started`, the remote result may be ambiguous and automatic rewriting is
forbidden: inspect remote `main` and `merged/*` and follow the printed recovery guidance.

## The lock during a landing

`land` takes the machine-wide lock itself; `verification-lanes` owns the lock's rules, and
`land-lock` and `land-unlock` are recovery and debugging tools. `./agent board` names the phase the
lock is being spent on and how long it has been in it: `integrating`, `cheap gates`,
`repository tests`, `host proof`, `push`, `cleanup`. `held for 36m by a landing, cheap gates: 34m so
far` is a stuck command; `host proof: 9m so far` is a landing earning its turn. Nothing reclaims a
lock on a timer; forcing one is the Developer's call, and `board` is what to bring them.

Let `land` run the broad lanes under its lock; do not run them immediately beforehand unless
diagnosing a failure. `verify-full-sandbox` is a useful managed-shell diagnostic but never proves the
host-only browser and native UI gates passed.
