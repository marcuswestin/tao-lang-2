# DEVENV-LOCK-UPDATE-KEEPS-STALE-TRANSITIVE-LINKS — Setup can retain an old transitive package link

- **Status:** Resolved
- **Area:** Dependency installation, verification
- **Impact:** A worktree can report a current dependency tree while executing a transitive version
  older than `bun.lock`. Tests in that worktree then do not exercise the graph a fresh install would
  resolve, and an advisory can remain exploitable locally after its lockfile fix.
- **Evidence:** On 2026-09-21 in `feat/recurring-repository-pass-september-catchup`, `bun.lock` resolved
  `@expo/plist/@xmldom/xmldom` to `0.8.15` and root `@xmldom/xmldom` to `0.9.12`. After
  `./agent setup` exited successfully and refreshed `.artifacts/build/agent-dev/dev-deps.stamp`,
  `node_modules/.bun/@expo+plist@0.8.1/node_modules/@xmldom/xmldom` still linked to
  `@xmldom+xmldom@0.8.13`, even though the `0.8.15` package directory was present. The installed
  Expo link was stale against the frozen graph. A fresh detached checkout at `078d2905` installed
  Expo's `0.8.15` link and root `0.9.12` link with `./agent setup`; an Expo plist build/parse round
  trip passed there. That checkout was removed after the check. On
  `feat/dependency-advisory-health`, an isolated fixture test points Expo's installed link at a
  `0.8.13` package while `bun.lock` requires `0.8.15`; health names both versions and accepts the
  corrected link. Repeating the mismatch in this branch's real installed tree made dependency
  health fail with those versions; `./agent setup` repaired it and health then passed.
- **Workaround:** Before this fix, verify advisory conclusions against `bun.lock` and use a fresh
  worktree for runtime acceptance of the changed graph.
- **Proposed change:** `InstalledLockfile.ts` compares every installed nested link with its locked
  package name and version. Dependency health and doctor name a mismatch; `./agent setup` uses its
  existing frozen-install then forced-repair sequence when health fails. Protected-path recovery
  remains explicit.
- **Dependencies:** DEVENV-091 covers a different undetected missing-link failure.
- **Acceptance:** A deliberately stale transitive link causes `./agent setup` or `./agent doctor`
  to name the lockfile mismatch and a working repair, and a fresh dependency install resolves both
  `@xmldom/xmldom` lines to their pinned versions.
- **Source:** 2026-09-21 recurring repository pass dependency remediation.
- **Archived:** 2026-09-21
