# DEVENV-088 — `merge-with-main`'s preflight cannot reach `origin` from inside the sandbox

- **Status:** In progress
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

  2026-09-19, the landing half: the unsandboxed retry that rescues the dry run does not rescue the
  landing. `just merge-with-main` with the sandbox off is refused by the Claude Code auto-mode
  classifier before it runs (`Blocked by classifier`), and sandboxed it fails on the same
  `git ls-remote` as the dry run. So on a branch Ro has asked an agent to land, both routes are shut:
  the agent can prove the branch is landable and cannot land it. `./dev merge-with-main --dry-run`
  unsandboxed still passes its whole preflight, so what is denied is the mutation, not the query.
- **Workaround:** Run the dry run unsandboxed to confirm the branch, and run `finalize` unsandboxed
  too — or fetch `origin` first — so its containment check reads a current `main`. Then have Ro run
  `just merge-with-main` in their own terminal.
- **Proposed change:** Either exclude `./dev merge-with-main *` from the sandbox, which is defensible
  because the plain command is already the landing command and pushing still stops for Ro, or have
  the preflight report a failed remote query as an environment failure that names the sandbox and the
  unsandboxed retry, rather than as a bare command failure. Note that the sandbox exclusion alone
  does not make the command reachable from a Claude Code agent: the classifier denial is independent
  of `.rulesync/permissions.jsonc` and has to be settled in the harness settings, or the instruction
  that an agent carries work "all the way to that command" has to say plainly that Ro runs it.
- **Change made:** `merge-with-main` now reuses the capability classifier's sandbox-denial judgment
  for its remote query and reports a host-environment failure naming both the sandbox and the
  unsandboxed retry. The broader `./dev merge-with-main *` sandbox exclusion remains open for Ro.
- **Dependencies:** `.rulesync/permissions.jsonc` owns the sandbox policy. DEVENV-068 owns the
  general case of a child process denied an operation the shell may perform; DEVENV-087 owns the
  argument-order gap in the same rule.
- **Acceptance:** `./dev merge-with-main --dry-run` either completes inside a sandboxed shell, or
  fails with a message that names the sandbox as the cause and the unsandboxed retry as the recovery.
- **Source:** 2026-09-19 review-findings round on `feat/work-based-test-timeouts`.
