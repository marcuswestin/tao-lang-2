# DEVENV-101 — `_fix-dprint` cannot format a skill file inside the sandbox

- **Status:** Candidate
- **Section:** External
- **Area:** Verification lanes, agent sandbox
- **Impact:** An agent that writes an unformatted file under `agents/skills/` cannot get any verify
  lane green from a sandboxed shell. `_fix-dprint` fails to rewrite the file, and every gate behind
  it is skipped, so the run reads as nine cascading failures rather than one table to realign.
- **Evidence:** 2026-09-19, `./agent verify-changed` after adding
  `agents/skills/simplify-repo/references/instructions-and-docs.md` with a misaligned table:
  `Error writing file '…/instructions-and-docs.md': Operation not permitted (os error 1)`, then
  `1 passed, 1 failed, 9 skipped`. The harness edit tool may write `agents/skills/`; Bash may not,
  which `dev-automation` and `git-workflow` both record.
- **Workaround:** Run `dprint check <file>` sandboxed to see the wanted text and apply it with the
  edit tool, or have the Developer run `./agent fix` from a normal terminal.
- **Proposed change:** When `_fix-dprint` hits a write denial, print the file and the `dprint check`
  diff and say which of the two recoveries applies, instead of failing as a generic formatter
  error. Separately, let the gates that do not read the unformatted file run rather than skip.
- **Dependencies:** None.
- **Acceptance:** A sandboxed lane with one unformatted skill file names that file, shows the diff,
  and states the recovery in its first-failure block.
- **Source:** 2026-09-19 repository simplification planning session.
