# Report - Current Instruction Inventory

## Files And Surfaces Reviewed

- `AGENTS.md`
- `packages/AGENTS.md`
- `Apps/Test Apps/AGENTS.md`
- `agents/skills/tao-dev/*/SKILL.md` (20 project skills)
- `agents/agent-types/*.toml`
- `.codex/rules/default.rules`
- `.codex/config.toml`
- `.codex/skills`, `.claude/skills`, and `.codex/agents` symlinks
- `packages/dev/dev-src/commands/audit-instructions.ts`

`./agent audit-instructions --json` scanned 25 instruction files and reported no findings.

## AGENTS Files

### Root `AGENTS.md`

Current responsibilities:

- Defines Tao as a UI-app language compiling to Expo/React Native.
- Establishes Ro as language/product authority.
- Defines command routing: `direnv allow`, `./agent`, `./agent tao`, `./agent just`, `bun` over `node`.
- Defines Git/index safety, including never staging/unstaging/stashing/resetting without explicit current permission.
- Routes agents to nested instructions and skills.
- Gives broad autonomy and quality rules.
- Maps repo packages.
- Defines final validation and commit/merge message conventions.

Best classification:

- Universal root context should keep command routing, Git/index safety, inspect-first autonomy, skill/nested-instruction routing, final validation, and a small repo map.
- Root should not carry detailed package code conventions beyond routing to `packages/AGENTS.md`.

### `packages/AGENTS.md`

Current responsibilities:

- Owns cross-package implementation rules.
- Defines feature-sliced file naming.
- Defines parser/validator/compiler/runtime ownership.
- Defines `Switch`, shared wrappers, `Context`/`Options`, `HCI`, `CLI`, `FS.resolvePath`, multiline text, direct predicate passing.
- Defines export/import conventions, grouped modules, subfolders for concept families, stale export removal, and test runner imports from `@shared/test`.

Best classification:

- Context-specific to `packages/`.
- It should remain nested, but can be split further if package-specific rules keep growing.
- Rules that apply only to runtime codegen, dev automation, or parser scoping should route to narrower skills or future nested AGENTS files.

### `Apps/Test Apps/AGENTS.md`

Current responsibilities:

- Defines Test Apps as positive examples for implemented behavior.
- Requires each app folder to include `<App Name>.tao` and `<App Name>.test.tao`.
- Defines the `Apps/Test Apps/README.md` contract sections.
- Says to update the app's `README.md` entry first when app scope changes.

Best classification:

- Context-specific to Test Apps and should stay nested.
- It is a good example of succinct local context.

## Project Skills

### Instruction And Skill Maintenance

- `agent-instructions`: owns where instructions belong, how to write them, and how to maintain them.
- `working-with-skills`: owns skill source layout, `.codex/skills` symlink, frontmatter, authoring, and renaming.
- `stale-repo-check`: owns stale-code/docs/instruction searches after renames or workflow changes.

Classification:

- Context-specific workflow skills. Keep out of root except routing.
- `agent-instructions` and `working-with-skills` overlap around skill placement and could be cross-linked more explicitly.

### Review Skills

- `architectural-review`: design/conformance review for package ownership, language coherence, and evolution path.
- `subagents-review`: standard adversarial multi-agent review.
- `subagents-review-stringent`: broader/deeper review gauntlet.
- `simple-subagents-review`: exactly two-reviewer lightweight pass.

Classification:

- Context-specific review workflows.
- These skills are long because they encode orchestration. They should stay skills, but much of the command detail could move into `./agent review` help/reference files once stable.
- Consider collapsing `simple-subagents-review` into a mode of `subagents-review` if the visible skill list becomes too noisy.

### Project Lifecycle Skills

- `project-1-decide-next-project`
- `project-2-research-project`
- `project-3-write-project-plan`
- `project-4-review-project-plan`
- `project-5-implement-project`
- `project-6-review-implementation`
- `project-7-merge-feature-branch`

Classification:

- Context-specific lifecycle workflow.
- The seven-skill split makes each loaded body narrow, but the always-visible skills list is noisy.
- Recommend replacing them with one `project-lifecycle` skill whose description preserves phase triggers and whose body routes to reference sections or separate docs, if Ro accepts retiring explicit `$project-N-...` skill names.

### Domain And Subsystem Skills

- `dev-automation`: `packages/dev`, `./agent`, `./dev`, `./tao`, and `Justfile`.
- `runtime-codegen`: generated app TypeScript, `TR`, `@runtime/TR`, and `packages/runtime/TaoRuntime-src`.
- `langium-scoping`: Langium scoping and reference-resolution work.
- `old-repo-porting`: use of `~/code/tao-lang` as reference material.
- `refactor`: focused simplification without behavior change.
- `commit-all-chunks`: commit-only workflow.

Classification:

- These should stay conditional skills.
- `runtime-codegen` could eventually become a nested `AGENTS.md` under `packages/runtime/TaoRuntime-src/` plus a smaller skill for generated-code workflow.
- `dev-automation` could become a nested `packages/dev/AGENTS.md` plus a smaller skill for command/workflow orchestration.

## Agent Types

### `agents/agent-types/reviewer.toml`

Defines a read-only adversarial reviewer focused on correctness, regressions, test gaps, stale instructions, changed code paths, direct callers, exports, tests, and edge cases.

Classification:

- Reusable subagent type.
- Good candidate for subagent-only context; the main agent should not need this body unless editing review automation.

### `agents/agent-types/architectural-reviewer.toml`

Defines a read-only architecture/design reviewer focused on tradeoffs, alternatives, package ownership, language coherence, and evolution.

Classification:

- Reusable subagent type.
- Good candidate for subagent-only context.

## Codex Local Config And Rules

### `.codex/rules/default.rules`

Allows the `./agent` command prefix and documents that Tao agents must use the repo-owned wrapper for executable commands.

Classification:

- Universal tool-level policy.
- Keep small and stable.

### `.codex/config.toml`

Configures granular approval policy and filesystem permissions, denying env files.

Classification:

- Tool/runtime config, not agent instruction prose.
- Keep out of AGENTS unless agents need to know a behavior.

### Symlinks

- `.codex/skills` points to `../agents/skills`.
- `.claude/skills` points to `../agents/skills/tao-dev`.
- `.codex/agents/*.toml` point to `agents/agent-types/*.toml`.

Classification:

- Discovery plumbing.
- Source of truth should stay under `agents/`.
- Any symlink audit must cover both Codex and Claude discovery paths, including the different link depths.

## Instruction Automation

### `audit-instructions`

Scans known AGENTS files, app instruction docs, and `agents/**/*.md`.

Current checks:

- warns against blanket clarification rules.
- warns against requiring plan mode.
- notes redundant instructions telling skills to read root `AGENTS.md`.

Classification:

- Mechanical enforcement belongs here.
- Keep this instruction-prose focused: AGENTS files, app docs, and `agents/**/*.md`.
- As new instruction conventions settle, add focused audit patterns rather than broad prose.
- Source-code checks such as native `switch (` or removed API references should live in ESLint, a dedicated code audit, or `just verify`, not this instruction auditor.

## Universal Rules

These should remain always visible:

- Use `./agent` for executable repo commands.
- Do not touch Git index/stage/stash/reset without explicit current permission.
- Treat peer changes as expected and preserve unrelated worktree state.
- Inspect live repo truth before acting.
- Read nested `AGENTS.md` before editing routed paths.
- Use the named skill when the task matches it.
- Ask Ro for language design, roadmap priority, destructive operations, or ambiguous product behavior.
- Run `./agent just verify` as final validation for code, instruction, or workflow changes unless Ro narrows validation.

## Context-Specific Rules

These should stay nested or skill-loaded:

- Package TypeScript conventions: `packages/AGENTS.md`.
- Test App purpose and scope rules: `Apps/Test Apps/AGENTS.md` and `Apps/Test Apps/README.md`.
- Runtime/generated-code rules: `runtime-codegen` now, possibly future runtime nested AGENTS.
- Dev automation details: `dev-automation` now, possibly future `packages/dev/AGENTS.md`.
- Langium scoping rules: `langium-scoping`.
- Old repo porting gotchas: `old-repo-porting`.
- Review orchestration: review skills and agent types.
- Project lifecycle: project lifecycle skills.
- Skill authoring: `working-with-skills` and `agent-instructions`.
