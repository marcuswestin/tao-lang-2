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
- **Dependencies:** None.
- **Acceptance:** A file written to `$TMPDIR` in one Bash call is readable by the same spelling in
  the next, or the instruction that sends agents there is corrected.
- **Source:** 2026-09-19 Tao Future dialect consolidation, while waiting on the landing lock.
