# DEVENV-030 — Managed-shell command constraints

- **Status:** Closed
- **Area:** Host tooling
- **Impact:** Process substitution is denied, shell working-directory changes can persist within a tool
  session, and decorative separator commands can be interpreted unexpectedly.
- **Evidence:** Observed during companion and semantic-agent work; these are host execution semantics, not
  repository failures.
- **Workaround:** Use plain commands, explicit `workdir`, ordinary temporary files, and avoid decorative
  shell separators.
- **Proposed change:** Keep these constraints in harness-level command guidance rather than product code.
- **Dependencies:** External host policy.
- **Acceptance:** Repository automation does not depend on process substitution or inherited shell cwd.
- **Source:** 2026-09-03 companion and semantic-agent implementation briefings.
- **Archived:** 2026-09-19
