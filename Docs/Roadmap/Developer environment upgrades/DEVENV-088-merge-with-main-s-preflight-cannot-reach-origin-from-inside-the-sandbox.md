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

  2026-09-20, after standardizing the machine on HTTPS, `git ls-remote --exit-code origin
  refs/heads/main` reaches the GitHub CLI credential helper and then fails with
  `failed to load config: open ~/.config/gh/config.yml: operation not permitted`. An explicitly
  reviewed host retry fails the same way because the credential path is a non-escalatable deny.
  HTTPS removes the SSH-agent and `known_hosts` dependency, but it cannot by itself give a
  repository process access to account credentials.
- **Workaround:** Run the dry run unsandboxed to confirm the branch, and run `finalize` unsandboxed
  too — or fetch `origin` first — so its containment check reads a current `main`. Then have Ro run
  `just merge-with-main` in their own terminal.
- **Proposed change:** Keep account credentials denied to repository processes. Give agents a narrow,
  host-owned landing capability that validates this repository, the expected old and new refs, and
  the finalized tree before it performs GitHub operations without returning a credential. Do not
  solve this by allowing `~/.config/gh`: once `gh` can read that configuration, a repository process
  can ask it to print the account token. Do not run the mutable `./dev merge-with-main` entrypoint
  wholesale outside the sandbox for the same reason.
- **Change made:** `merge-with-main` reports the sandbox denial with its recovery. `just github-setup`
  now standardizes the global URL rewrites, GitHub CLI protocol and credential helper, this checkout's
  stored origin, and a live remote probe. It also installs a bundled per-user LaunchAgent outside
  repository-writable paths. The service is registered for this repository's canonical Git object
  store and fixed HTTPS remote; it disables hooks and global/system Git configuration, fetches remote
  objects into the registered store, validates the proposed squash parent and finalized tree, and
  atomically updates main, the merged archive, and any feature-branch deletion under explicit leases.
  Its loopback-only protocol returns refs and verdicts only, never credentials or an arbitrary command
  surface. `finalize` and `merge-with-main` prefer it automatically and retain direct Git only for
  ordinary human shells. `./agent doctor` reports HTTPS/helper drift and a missing broker.
- **Dependencies:** `.rulesync/permissions.jsonc` owns the sandbox policy. DEVENV-068 owns the
  general case of a child process denied an operation the shell may perform; DEVENV-087 owns the
  argument-order gap in the same rule.
- **Acceptance:** `just github-setup` leaves the effective and stored origin on HTTPS with the GitHub
  CLI credential helper and a running landing broker, and `./agent doctor` reports that state.
  `./dev merge-with-main --dry-run` completes inside a sandboxed shell through the broker. A test
  proves the landing workflow performs no direct remote Git operation when the broker is available;
  live resolution additionally requires installing the service and landing this branch from a
  sandboxed task without exposing the GitHub credential or executing repository code outside it.
- **Source:** 2026-09-19 review-findings round on `feat/work-based-test-timeouts`.
