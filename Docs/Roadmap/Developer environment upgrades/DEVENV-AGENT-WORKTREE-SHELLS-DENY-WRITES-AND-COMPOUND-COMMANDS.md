# DEVENV-AGENT-WORKTREE-SHELLS-DENY-WRITES-AND-COMPOUND-COMMANDS — Agent worktree shells deny writes and compound commands

- **Status:** Candidate
- **Section:** External
- **Area:** The sandbox policy and the output-discipline hook for worktrees under
  `tao-lang-2.worktrees/agent-*`, `.rulesync/permissions.jsonc`, `.rulesync/hooks.jsonc`
- **Impact:** An agent created in a tool-made worktree reports that sandboxed shell writes are
  refused there, so it runs every repository command on the host, losing the sandbox for ordinary
  work; and the shell hook refuses several shapes it needs for CI work, each refusal costing a
  turn.
- **Evidence:** 2026-10-06, four sessions in worktrees the harness's Agent tool created
  (`agent-a0ba4770e567e6a98`, `agent-a50648adcd522f479`, `agent-af78e0545a4a82bd9`,
  `agent-ae44c8547cb93e4bb`) each reported the same two things at hand-off: sandboxed writes into
  the worktree were denied, so `./agent` calls ran unsandboxed; and the hook rejected compound
  `gh` and `git` commands, heredocs, `for` loops, `$VAR` arguments, and `jq` inside a `gh` call.
  The exact denied path was not captured, so the write denial is a report to reproduce first: the
  policy allows writes under the current directory, and the denial may be a path outside it (a
  scratch or temp directory) or the hook rather than the sandbox.
- **Workaround:** Run the write on the host, or capture output to `$TMPDIR` and read it with the
  Read tool; write loops as a script file.
- **Proposed change:** Reproduce in a fresh tool-made worktree with one sandboxed write to a tracked
  path and one to `.artifacts/`, and record which is refused and by what. If the sandbox, add the
  worktree root to the write allowlist in `.rulesync/permissions.jsonc` (the Developer's approval,
  since it widens what a sandboxed shell may write); if the hook, have its refusal name the
  accepted form for loops and variables, as it does for pipes.
- **Dependencies:** None.
- **Acceptance:** In a fresh tool-made worktree a sandboxed `./agent fmt <file>` writes the file,
  and a `for` loop over `git` output is either accepted or refused with the accepted form named.
- **Source:** CI completion slices C2, C3, E and F, 2026-10-06.
