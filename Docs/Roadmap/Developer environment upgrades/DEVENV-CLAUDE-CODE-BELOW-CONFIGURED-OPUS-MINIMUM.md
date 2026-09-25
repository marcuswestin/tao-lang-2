# DEVENV-CLAUDE-CODE-BELOW-CONFIGURED-OPUS-MINIMUM — Claude Code is below the configured Opus minimum

- **Status:** Candidate
- **Section:** External
- **Area:** Agent delegation, host tooling
- **Impact:** Standard and deep Claude Code subagent profiles now select `opus`, which this repository
  maps to Opus 5.5. The installed CLI predates the documented minimum for that model, so those
  profiles cannot be counted as accepted on this host. A startup warning now names both tiers.
- **Evidence:** On 2026-09-25, `./agent doctor` measured Claude Code 2.1.267 and warned that the
  configured Opus 5.5 requires 2.1.280. `7f5f3e4a` routes standard profiles such as `scout`
  through `opus` as well as deep review. This is a measured version mismatch and an inferred
  subagent-runtime limit; no Claude subagent was launched for acceptance. The requirement and
  model precedence are documented in [Claude Code model configuration](https://code.claude.com/docs/en/model-config)
  and [subagents](https://code.claude.com/docs/en/sub-agents).
- **Workaround:** Use a supported Codex profile for repository delegation on this host until the
  Claude Code CLI is updated and a standard and deep profile are exercised.
- **Proposed change:** Update the installed Claude Code CLI through an approved host operation, then
  verify standard and deep profile selection and observed models. Do not change the repository's
  model routing to conceal the stale host installation.
- **Dependencies:** The host update is outside the listed `./agent unsandboxed` operations and
  needs the Developer's explicit approval or action.
- **Acceptance:** A named standard and deep Claude Code subagent each run on the updated host and
  report the expected observed model; `./agent doctor` no longer warns about the minimum.
- **Source:** September 2026 recurring repository review continuation, 2026-09-25.
