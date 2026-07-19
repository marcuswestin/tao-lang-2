# Report - Current Instruction Inventory

## Reset Result

The minimal agent-context reset is implemented on `feat/minimal-agent-context`.

| Surface                               |    Before |     After |
| ------------------------------------- | --------: | --------: |
| Root instructions                     |  82 lines |  32 lines |
| Nested instructions, including Claude |  97 lines |  26 lines |
| Visible project skills                |        20 |         7 |
| Skill bodies                          | 874 lines | 146 lines |
| Skill references                      |  32 lines |  16 lines |
| Custom agent profiles                 |  38 lines |  28 lines |

## Current Structure

- `AGENTS.md`: Tao identity, Ro's authority, command routing, autonomy, Git/index safety, nested routing, and final validation.
- `packages/AGENTS.md`: language-pipeline ownership, AST and dispatch boundaries, generated runtime boundaries, shared wrappers, exports, and behavioral testing.
- `Apps/Test Apps/AGENTS.md`: positive executable examples and README-owned app scope.
- `.claude/CLAUDE.md`: root instruction include.
- `agents/skills/`: canonical source for seven conditional Tao workflows and domain guides; `.codex/skills` and `.claude/skills` point here.
- `agents/agent-types/`: canonical source for two read-only reviewer profiles; `.codex/agents` points here.
- `./agent review`: self-contained review planning, prompts, execution, and artifacts under `.artifacts/reviews/`.
- Direct shell access and `./agent` workflows operate inside each agent platform's sandbox and approval boundary; there is no repo-local executable-command allowlist. Shared workflow definitions and human developer commands remain in `Justfile`.

The repo-local Codex config defines only a Tao permission profile that extends `:workspace` while denying `.env*` files. User-level model, personality, service-tier, approval-policy, and automatic-review settings remain authoritative.

## Removed Context

- Duplicate skill-authoring guidance and overlapping review, refactor, stale-check, and lifecycle workflow skills.
- The seven-step skill list and long merge command cookbook, replaced by one compact lifecycle skill.
- Duplicate skill and agent-profile copies; platform discovery paths are symlinks to the root canonical source.
- The literal-pattern instruction audit command, registration, help, and tests.
- Repeated Git safety, validation, reviewer reconciliation, roadmap, Kitchen Sink, and test-app mechanics.

## Validation Results

- Active stale-name, obsolete-path, and removed-command searches are clean; archived documents remain historical.
- Fresh Codex prompt inspection loads the compact root instructions and all seven skill descriptions through `.codex/skills`, with no removed skill names.
- Prompt inspection from `packages/dev` and `Apps/Test Apps` loads the root plus the correct nested instructions and no unrelated nested file.
- A fresh trigger-classification run maps all seven representative requests to the intended skill and maps an unrelated JavaScript question to no project skill.
- Fresh read-only spawns of `reviewer` and `architectural-reviewer` return their expected smoke markers.
- `.claude/CLAUDE.md` and `.claude/skills/project-lifecycle/SKILL.md` resolve through the retained Claude surfaces to `agents/skills/`.
- Codex configuration loads the repo's `tao-workspace` profile while retaining user-level model and approval settings.
- Focused dev automation tests pass: 63 tests, 0 failures.
- `./agent verify` passes.
