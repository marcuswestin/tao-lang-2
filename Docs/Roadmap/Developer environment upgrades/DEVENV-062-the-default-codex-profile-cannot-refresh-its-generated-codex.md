# DEVENV-062 — The default Codex profile cannot refresh its generated Codex configuration

- **Status:** Candidate
- **Area:** Agent configuration
- **Impact:** Canonical `.rulesync` changes can leave `.codex/config.toml` or
  `.codex/rules/tao.rules` stale even though `./agent setup` and `just _agent-config` otherwise
  succeed, so generated-parity tests fail after the documented regeneration command.
- **Evidence:** During the 2026-09-16 verification-foundation work, both commands reported the Codex
  outputs as not writable under the default Codex workspace profile; an escalated retry retained the
  same protection boundary.
- **Workaround:** Regenerate from a host/profile allowed to update the generated `.codex` outputs,
  then run `codex-config-generation.test.ts` to prove exact parity.
- **Proposed change:** Provide a repository-owned regeneration path that can replace the generated
  Codex files without granting general writes to mutable harness configuration, or document the
  required host/profile transition in the canonical setup workflow.
- **Dependencies:** `.rulesync/permissions.jsonc`, `.rulesync/profiles.jsonc`, and
  `packages/dev/dev-src/agent-config/CodexConfigGenerator.ts`.
- **Acceptance:** Starting from deliberately stale generated Codex files, the documented setup command
  refreshes them and the exact-parity test passes in the default supported Codex workflow.
- **Source:** 2026-09-16 September remediation Wave 1.
