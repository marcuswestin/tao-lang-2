# DEVENV-RESOURCES-REGISTER-DIRECTORY-PRINTS-THE-WHOLE-INVENTORY — Registering a directory prints the whole resource inventory

- **Status:** Candidate
- **Section:** External
- **Area:** `./agent resources --register-directory … --json`.
- **Impact:** The command the git-workflow skill requires for every external directory prints about 350 KB of unrelated inventory JSON, which floods an agent's context or must be discarded unread, hiding whether the registration itself succeeded.
- **Evidence:** On 2026-10-06, two `--register-directory --json` calls printed 347.6 KB and 377.8 KB: every process and worktree entry on the machine, not the one registration.
- **Workaround:** Redirect the output to a file and read the exit status.
- **Proposed change:** With `--register-directory`, print only the registration record (or a one-line confirmation without `--json`).
- **Dependencies:** None.
- **Acceptance:** Registering a directory prints its own record and nothing else.
- **Source:** First merge-queue landing, `feat/repo-transfer-urls`, 2026-10-06.
