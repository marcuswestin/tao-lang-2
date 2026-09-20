# Landing Mechanics

`git-workflow` owns the underlying Git commands; this covers what `just merge-with-main` does, its
flags, its message format, and how a red lane is classified.

Remote inspection and push automatically use the host-owned landing broker when installed. If the
command says it is unavailable, ask Ro to run `just landing-setup` in a normal terminal; never grant
the repository access to `~/.config/gh` and never run mutable repository code wholesale outside the
sandbox. The broker exposes only this repository's fixed HTTPS remote and an atomic, lease-checked
main/archive update, not a general Git or credential API.

## `just merge-with-main`

The plain invocation verifies, squashes, commits, and pushes — no flag needed. It touches no checkout
but the invoking one: it builds the squash commit with `git commit-tree` from the verified feature
tree and moves `refs/heads/main` with `git update-ref` and an expected old value, so nothing is
staged anywhere and a losing concurrent landing is refused and told to merge and retry. No worktree
may have `main` checked out while landing; a mirror worktree showing `main` is detached at its tip and
every landing moves it forward itself — treat it as read-only, and give it a branch before working in
it.

Flags only remove work: `--skip-verify-full` runs `verify --complete` on the branch instead of
`verify-full`; `--skip-verify` omits that fallback too; `--skip-all` implies both, defaults to No, and
needs a terminal, so there is no way to land unverified non-interactively. The tree assertion still
runs under every combination, because the landed commit must carry the tree that was verified.
`--dry-run` reports the plan and changes nothing. Preflight requires local `main` to equal
`origin/main` and to be merged into the branch, which is what makes the squash the feature tree; a
remote feature branch behind the worktree is pushed forward during execution, and only one holding
commits the worktree lacks stops the landing. Success leaves the feature worktree clean and detached
at the archived tip, and deletes the local feature branch.

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

Read `.artifacts/logs/<lane>/latest/summary.json` first. A separately recorded retry, not
concatenated output, owns the final classification: a node failing again on its isolated retry is
`repository`, not `machine-contention`. Others name their cause: `native-host-busy`,
`hutch-install-timeout`, `electrobun-prepare-timeout`, `native-probe-timeout`, `native-runtime-exit`,
`test-assertion`, `environment-setup`, `optional-tooling`, `sandbox-restriction`,
`user-interruption`.

Run `verify-full-sandbox` immediately before a merge from a managed shell — it runs the full gate
membership except the host-only browser and native UI gates, and never proves those passed. Run
`verify-full` from an unsandboxed terminal whenever Studio is in scope and before landing through the
human merge workflow.
