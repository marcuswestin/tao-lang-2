# Landing Mechanics

`git-workflow` owns the underlying Git commands; this covers what `just land` does, its flags, its
message format, and how a red lane is classified.

Remote inspection and push automatically use the host-owned landing broker when installed. If the
command says it is unavailable, ask Ro to run `just landing-setup` in a normal terminal; never grant
the repository access to `~/.config/gh` and never run mutable repository code wholesale outside the
sandbox. The broker exposes only this repository's fixed HTTPS remote and an atomic, lease-checked
main/archive update, not a general Git or credential API.

## `just land`

`just land` is the whole landing, as one command and one process. Do not assemble a landing out of
`land-lock`, `finalize`, `verify-full` and `merge-with-main` any more: the lock used to be held for
36-44 minutes against 5-15 minutes of lane time, and the gap was model turns between commands, not
compute. One process closes the gap without making any step faster.

**Before the lock**, unlocked, it settles what might need an author: this is a clean `feat/*` or
`dev/*` branch checked out only here, no worktree has `main`, the archive branch is free, and
`.artifacts/merge/<branch>.msg` exists and validates. It refuses, having taken nothing, when the
merge message still needs review.

**Inside the lock**, in one `try`/`finally`, it then fetches `origin/main`, merges it into the
branch, fast-forwards local `main`, runs the cheap-gate barrier, runs `verify-full`, squashes,
pushes, archives, and releases. Local `main` being behind, or the branch not yet containing `main`,
is no longer a precondition — that requirement is what made a landing lose a race it had already
paid a full verification for.

The barrier is `just land-barrier` (`check` plus `dead-exports`), and it is deliberately the
**check-mode** gates, not the `_fix-*` fixers: a fixer writes to the tree the landing is about to
commit, and the landing then refuses itself with `Verification changed the tree this landing was
about to commit.` A red barrier costs ~30s and releases the lock immediately.

**A conflict while integrating `main` ends the lock and hands the worktree back**, durable claim
included. Resolve it here, unlocked, with the machine free for everyone else; commit the merge with
`git commit --no-edit`; run `just land` again. It re-integrates whatever `main` has become by then.

It touches no checkout but the invoking one: it builds the squash commit with `git commit-tree` from
the verified feature tree and moves `refs/heads/main` with `git update-ref` and an expected old
value, so nothing is staged anywhere and a losing concurrent landing is refused and told to merge and
retry. A mirror worktree showing `main` is detached at its tip and every landing moves it forward
itself — treat it as read-only, and give it a branch before working in it.

Flags only remove work (`land --help` lists them); `--skip-all` (on `merge-with-main`) still defaults
to No and needs a terminal, so there is no way to land unverified non-interactively, and the tree
assertion still runs under every combination, because the landed commit must carry the tree that was
verified. A remote feature branch behind the worktree is pushed forward during execution, and only
one holding commits the worktree lacks stops the landing. Success leaves the feature worktree clean
and detached at the archived tip, and deletes the local feature branch.

`./dev merge-with-main` remains the lower half, for `--dry-run` and `--abort` recovery.

## The lock, and what `board` now shows

`land` takes the lock itself. **`land-lock` and `land-unlock` are recovery and debugging tools**, not
part of the normal path: claiming the lock by hand before a landing now only adds a durable claim the
landing does not need.

While a landing holds the lock, `verify-changed` and `test-changed` are not admitted — already
running ones drain, and `test-file`, a named test, `check`, `fix` and `fmt` stay free, so iteration
never waits on somebody else's landing.

`./agent board` names the phase the lock is being spent on and how long it has been in it:
`integrating`, `cheap gates`, `repository tests`, `host proof`, `push`, `cleanup`. That is what
separates a lock doing useful work from one waiting on an agent — `held for 36m by a landing, cheap
gates: 34m so far` is a stuck command, `host proof: 9m so far` is a landing earning its turn. Nothing
reclaims a lock on a timer; forcing one is still Ro's call, and `board` is what to bring to Ro.

Ask `./agent landed [branch]` whether a branch landed; never infer it. The landing runs for minutes
behind a wrapper, and every other signal is ambiguous: a stopped wrapper, a task reported failed
because the shell it was piped into exited non-zero, a `summary.json` read while the lane was still
writing it. `merge-with-main` pushes `merged/<name>` on success and at no other time, so that ref is
the fact and the command reads it from the local remote-tracking refs after a fetch — `git ls-remote`
authenticates, and credential paths are denied inside the agent sandbox. Guessing costs more than
asking: one branch was re-landed twice in a session because a successful landing read as a failure.

`--abort <snapshot>` restores only command-owned local state while the snapshot still matches. Once a
snapshot says `push-started`, the remote result may be ambiguous and automatic rewriting is forbidden
— inspect remote `main` and `merged/*` and follow the printed recovery guidance.

## The merge message

Write or refresh `.artifacts/merge/<branch>.msg` every time a branch becomes merge-ready, including
after later commits change what it does — landing fails with `Merge message file does not exist`
otherwise. Format: a summary of at most 72 characters, a blank line, then one or more contiguous
`- ...` bullets free to wrap onto indented continuation lines. Do not add Git's squash appendix or
author attribution; the command appends the generated appendix itself.

## Reading a red lane

Read `.artifacts/logs/<lane>/latest/summary.json` first — it names each node's failure cause. A
separately recorded retry, not concatenated output, owns the final classification: a node failing
again on its isolated retry is `repository`, not `machine-contention`.

Run `verify-full-sandbox` immediately before a merge from a managed shell — it runs the full gate
membership except the host-only browser and native UI gates, and never proves those passed. Run
`verify-full` from an unsandboxed terminal whenever Studio is in scope and before landing through the
human merge workflow.
