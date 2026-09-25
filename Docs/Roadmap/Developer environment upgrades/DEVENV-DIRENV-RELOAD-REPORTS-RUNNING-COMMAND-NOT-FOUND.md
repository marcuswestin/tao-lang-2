# DEVENV-DIRENV-RELOAD-REPORTS-RUNNING-COMMAND-NOT-FOUND — direnv reload reports Running command not found

- **Status:** Candidate
- **Section:** External
- **Area:** devenv and direnv shell loading
- **Impact:** A direnv reload can print `.envrc:66: Running: command not found` even while the environment loads, so a developer cannot tell whether a shell hook or a generated export is broken.
- **Evidence:** The message appeared after `gh` joined `devenv.nix` during A9 work. The repository `.envrc` has eight lines; `devenv direnvrc` generates the longer script, whose current line 66 is an `NIX_BUILD_TOP` cleanup condition and contains no `Running` command. In two 2026-09-25 worktrees, `direnv exec` reported that `.envrc` was blocked and `direnv allow` could not write under `~/.local/share/direnv/allow` (`operation not permitted`). The first worktree's `devenv direnv-export` was also rejected by the task tool's localhost network rule. In the second, `devenv direnvrc` printed a script with no `Running:` command and `devenv.nix` had no `Running:` shell line. A live reload could not be reached, so the original message and any repository-owned cause remain unconfirmed.
- **Workaround:** The original environment loaded despite the message; in a normal terminal, allow the worktree and reload direnv. No workaround for the message itself is known.
- **Proposed change:** In a host shell, capture a new reload's output and the generated `direnvrc` version, then identify whether `Running:` reaches the evaluated `direnv-export` output or another sourced hook. Send diagnostic text to stderr at its source or correct the shell quoting, and add a focused regression check if the fault is repository-owned.
- **Dependencies:** A host shell that can write direnv's allowlist and evaluate devenv.
- **Acceptance:** A reload after the `gh` addition exits cleanly without `.envrc:66: Running: command not found`, and the expected tools are present.
- **Source:** 2026-09-25 A9 follow-up handoff and diagnosis attempt.
