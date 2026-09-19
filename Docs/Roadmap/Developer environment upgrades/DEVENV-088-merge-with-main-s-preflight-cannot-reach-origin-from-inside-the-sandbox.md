# DEVENV-088 — `merge-with-main`'s preflight cannot reach `origin` from inside the sandbox

- **Status:** Candidate
- **Area:** Sandbox
- **Impact:** `./dev merge-with-main --dry-run` — the command an agent is supposed to run to check that
  a branch is landable — fails inside a sandboxed shell on its own remote query, so a branch cannot be
  confirmed ready without an unsandboxed shell. The failure names the git command rather than the
  sandbox, which reads as a broken remote rather than a denied one.
- **Evidence:** `./dev merge-with-main --dry-run` prints
  `Command failed: git ls-remote --heads origin refs/heads/main refs/heads/<branch> refs/heads/merged/<branch>`
  and nothing else. The same invocation with the sandbox off completes the whole preflight. This is
  not the argument-order gap DEVENV-087 fixed: `git ls-remote --heads origin *` is present in both
  `permission.bash` and `claudecode.sandbox.excludedCommands`, and it matches. The exclusion lifts the
  sandbox for a _top-level_ bash command that matches the pattern; here the top-level command is
  `./dev merge-with-main --dry-run`, and the `ls-remote` runs as its grandchild, which inherits the
  sandbox and its egress allowlist. It is the same shape as DEVENV-068 — a child process denied what
  the shell is allowed — with the network rather than `exec` as the denied operation.
  `./agent finalize` has the same denial and degrades rather than failing: it reports
  `origin was unreachable; read the local main branch at <sha> instead` as a `PASS`, then decides
  `main ... is already contained in this branch` from that local ref. That is a stale-`main`
  judgment presented as a passing check — a landing finalize called ready can still be refused by
  `merge-with-main`'s preflight, which does reach the remote.
- **Workaround:** Run the dry run unsandboxed. Run `finalize` unsandboxed too, or fetch `origin`
  first, so its containment check reads a current `main`.
- **Proposed change:** Either exclude `./dev merge-with-main *` from the sandbox, which is defensible
  because the plain command is already the landing command and pushing still stops for Ro, or have
  the preflight report a failed remote query as an environment failure that names the sandbox and the
  unsandboxed retry, rather than as a bare command failure.
- **Dependencies:** `.rulesync/permissions.jsonc` owns the sandbox policy. DEVENV-068 owns the
  general case of a child process denied an operation the shell may perform; DEVENV-087 owns the
  argument-order gap in the same rule.
- **Acceptance:** `./dev merge-with-main --dry-run` either completes inside a sandboxed shell, or
  fails with a message that names the sandbox as the cause and the unsandboxed retry as the recovery.
- **Source:** 2026-09-19 review-findings round on `feat/work-based-test-timeouts`.
