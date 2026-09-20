# DEVENV-062 — The documented setup command cannot refresh generated harness configuration

- **Status:** Candidate
- **Area:** Agent configuration
- **Impact:** Canonical `.rulesync` changes can leave a generated harness file stale even though
  `./agent setup` and `just _agent-config` otherwise succeed, so `AgentConfigFreshness` fails after
  the documented regeneration command. Each harness protects its own generated configuration from
  the shell it gives its agents, which is exactly the shell an agent runs setup from.
- **Evidence:** During the 2026-09-16 verification-foundation work, both commands reported the Codex
  outputs as not writable under the default Codex workspace profile; an escalated retry retained the
  same protection boundary. The Claude side is the same shape: on 2026-09-20 a `.rulesync/permissions.jsonc`
  change left `./agent setup` printing `EPERM: operation not permitted, open .claude/settings.json`
  followed by `Skipped claudecode agent config`, because the Bash sandbox denies that path; the run
  still exited 0, so only the freshness gate would have caught the stale file.
- **Workaround:** Regenerate from a host, profile, or unsandboxed shell allowed to update the
  generated outputs, then run `codex-config-generation.test.ts` and the freshness gate to prove exact
  parity. An agent that edits `.rulesync/` should expect to need that second run.
- **Proposed change:** Provide a repository-owned regeneration path that can replace the generated
  harness files without granting general writes to mutable harness configuration, and make `./agent
  setup` exit non-zero, rather than 0, when it skipped a generated file it was asked to write.
- **Dependencies:** `.rulesync/permissions.jsonc`, `.rulesync/profiles.jsonc`,
  `packages/dev/dev-src/agent-config/CodexConfigGenerator.ts`, and
  `packages/dev/dev-src/agent-config/AgentConfigFreshness.ts`.
- **Acceptance:** Starting from deliberately stale generated harness files, the documented setup
  command refreshes them — or fails loudly naming what it could not write — and the exact-parity and
  freshness gates pass in each harness's default supported workflow.
- **Source:** 2026-09-16 September remediation Wave 1; widened to the Claude harness 2026-09-20.
