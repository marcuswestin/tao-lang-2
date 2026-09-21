# DEVENV-103 — `$TMPDIR` resolves to two different paths between tool calls

- **Status:** Candidate
- **Area:** Agent sandbox
- **Impact:** A file an agent writes to `$TMPDIR` in one Bash call can be unreadable by the same
  spelling in the next, because the variable expands to the sandbox's own temporary root in some
  calls and to the host's `/var/folders/.../T/` in others. Nothing reports the switch: the write
  succeeds, the read fails with `No such file or directory`, and a background watcher built on the
  path simply never fires. `AGENTS.md` tells agents to use `$TMPDIR` for temporary files, so the
  advice and the behaviour disagree.
- **Evidence:** 2026-09-19, one session, two consecutive calls. `./agent finalize > "$TMPDIR/f.out"`
  then `ls -la "$TMPDIR/f.out"` reported `/tmp/claude-501/f.out`, 99 bytes; the next call's
  `cat "$TMPDIR/f.out"` reported
  `cat: /var/folders/ch/gy4zgxlx0zdcqqt9gllqprrc0000gn/T//finalize2.out: No such file or directory`.
  A `Monitor` whose condition read `"$TMPDIR/f.out"` therefore watched a path that never existed and
  reported only unrelated state until it was stopped and rewritten against the absolute path.
- **Workaround:** Resolve the directory once and use the absolute path afterwards, or write under
  `.artifacts/tmp/` in the worktree, which is stable across calls. Never share a `$TMPDIR` path
  between two tool calls or into a `Monitor` condition.
- **Proposed change:** Pin one temporary root per session so `$TMPDIR` means the same directory in
  every tool shell, as the session-start hook already does for `PATH`. Failing that, say in
  `AGENTS.md` that `$TMPDIR` is per-call and that anything read back later belongs under
  `.artifacts/tmp/`.
- **Also (2026-09-20):** a Git worktree created under `$TMPDIR` cannot be typechecked. `/tmp` is a
  symlink to `/private/tmp` on macOS, so the same file reaches TypeScript under two paths and every
  cross-module type compares unequal to itself — `_typecheck` failed with
  `Type 'AdvanceStep' is not assignable to type 'AdvanceStep'`, naming
  `/tmp/claude-501/...` and `/private/tmp/claude-501/...` as the two identities, and the same for the
  runtime's `ActionValue`. The lane is red for a reason that has nothing to do with the branch.
  `git worktree move` to a real path fixes it, and needs an unsandboxed shell. Create agent worktrees
  under the repository's own worktree directory rather than under `$TMPDIR`. **Addressed for the
  worktree case (2026-09-21):** `./agent doctor`'s `worktree path` check compares the shell's `PWD`
  to its resolved path and fails with that diagnosis, and `AGENTS.md` says to create worktrees at a
  real path. This entry stays open for the original symptom — `$TMPDIR` naming two different
  directories between tool calls — which that check does not cover.
- **Dependencies:** None.
- **Acceptance:** A file written to `$TMPDIR` in one Bash call is readable by the same spelling in
  the next, or the instruction that sends agents there is corrected.
- **Source:** 2026-09-19 Tao Future dialect consolidation, while waiting on the landing lock.
