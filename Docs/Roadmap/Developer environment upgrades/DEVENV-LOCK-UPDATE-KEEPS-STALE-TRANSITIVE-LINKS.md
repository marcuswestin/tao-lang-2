# DEVENV-LOCK-UPDATE-KEEPS-STALE-TRANSITIVE-LINKS — Setup can retain an old transitive package link

- **Status:** Candidate
- **Section:** External
- **Area:** Dependency installation, verification
- **Impact:** A worktree can report a current dependency tree while executing a transitive version
  older than `bun.lock`. Tests in that worktree then do not exercise the graph a fresh install would
  resolve, and an advisory can remain exploitable locally after its lockfile fix.
- **Evidence:** On 2026-09-21 in `feat/recurring-repository-pass`, `bun.lock` resolved
  `@expo/plist/@xmldom/xmldom` to `0.8.15` and root `@xmldom/xmldom` to `0.9.12`. After
  `./agent setup` exited successfully and refreshed `.artifacts/build/agent-dev/dev-deps.stamp`,
  `node_modules/.bun/@expo+plist@0.8.1/node_modules/@xmldom/xmldom` still linked to
  `@xmldom+xmldom@0.8.13`, even though the `0.8.15` package directory was present. The installed
  Expo link was stale against the frozen graph.
- **Workaround:** Verify advisory conclusions against `bun.lock` and use a fresh worktree for
  runtime acceptance of the changed graph; no in-place managed-shell repair was established.
- **Proposed change:** Make dependency health compare installed package links against relevant
  locked transitive versions after a lockfile change. Have `./agent setup` repair or clearly report
  mismatches rather than stamping a stale tree current; keep protected-path recovery explicit.
- **Dependencies:** DEVENV-091 covers a different undetected missing-link failure.
- **Acceptance:** A deliberately stale transitive link causes `./agent setup` or `./agent doctor`
  to name the lockfile mismatch and a working repair, and a fresh dependency install resolves both
  `@xmldom/xmldom` lines to their pinned versions.
- **Source:** 2026-09-21 recurring repository pass dependency remediation.
