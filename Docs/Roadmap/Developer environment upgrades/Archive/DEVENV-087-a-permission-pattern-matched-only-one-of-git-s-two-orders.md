# DEVENV-087 — A permission pattern matched only one of git's two argument orders

- **Status:** Resolved
- **Area:** Sandbox
- **Impact:** `.rulesync/permissions.jsonc` allowed and unsandboxed `git ls-remote origin *`, which
  reads as "agents may query the remote". Git accepts its flags on either side of the remote name,
  and `merge-with-main`'s own preflight runs `git ls-remote --heads origin refs/heads/...` — where
  the flag precedes `origin` and the pattern cannot match. The landing command therefore failed
  inside the sandbox on its own remote query, against a rule that looked present and was not.
- **Evidence:** `./dev merge-with-main --dry-run` printed
  `Command failed: git ls-remote --heads origin refs/heads/main …`, and the command run directly
  reported `This proxy requires authentication, and this client did not offer an authentication
  method`. The same dry run succeeded unsandboxed. `git fetch origin main` worked throughout,
  because `git fetch origin *` matches the order that command happens to use.
- **Workaround:** run the command from an unsandboxed shell.
- **Change made:** both orders are allowed and excluded from the sandbox, with the reason recorded
  beside them.
- **Wider lesson:** a wildcard permission pattern encodes one argument order, and a tool that accepts
  several makes the rule look broader than it is. A pattern is worth checking against the exact
  argv the repository's own code builds, not against the shape a person would type.
- **Dependencies:** `.rulesync/permissions.jsonc` owns the rules; `./agent setup` regenerates the
  harness files from it.
- **Acceptance:** `./dev merge-with-main --dry-run` completes inside the sandbox.
- **Source:** 2026-09-19, landing the work-based test timeout branch.
- **Archived:** 2026-09-19
