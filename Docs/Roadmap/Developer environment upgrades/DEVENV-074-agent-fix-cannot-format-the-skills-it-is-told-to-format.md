# DEVENV-074 — `./agent fix` cannot format the skills it is told to format

- **Status:** Candidate
- **Section:** External
- **Area:** Sandbox policy
- **Impact:** Claude Code's Bash sandbox denies writes under `agents/skills/`, which is also where
  every project skill lives. Editing a skill and running the repository's own formatter therefore
  fails on the file the change is about, and the failure names an OS error rather than a policy, so
  it reads as a broken formatter. Every instruction-editing task pays it.
- **Evidence:** After adding `agents/skills/delegation/SKILL.md`, `./agent fix` exited 1 with
  `Error writing file '…/agents/skills/delegation/SKILL.md': Operation not permitted (os error 1)`
  and `Had 1 error formatting.`; the same command outside the sandbox formatted the file and
  reported `Formatted 1 file. 0 fixed, 124 unchanged`.
- **Workaround:** Run `dprint check <file>` to see the formatting diff and apply it with the edit
  tool, or have the Developer run `./agent fix` from a normal terminal. There is no named agent host
  operation for general formatting.
- **Proposed change:** Decide which the policy means. If skills are protected against shell writes
  on purpose, `fix` should say so — detect the denial on a known-protected path and print the
  unsandboxed retry — rather than surfacing `os error 1`. If the protection is incidental, exempt
  the repository's own formatter, whose writes are reviewable in the diff either way.
- **Dependencies:** None.
- **Acceptance:** Editing a project skill and running `./agent fix` either succeeds, or fails with a
  message naming the sandbox and the command to rerun.
- **Source:** 2026-09-17 subagent delegation branch.
