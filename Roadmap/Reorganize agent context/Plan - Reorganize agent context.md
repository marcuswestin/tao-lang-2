# Plan - Reorganize Agent Context

## Goal

Reduce always-loaded agent context while preserving the conventions that prevent real mistakes.

The desired shape is:

- root `AGENTS.md`: only universal safety, command, routing, and validation rules.
- nested `AGENTS.md`: local invariants that should apply to nearly every edit under that subtree.
- skills: conditional workflows and domain knowledge.
- automation: mechanical checks, command orchestration, and review setup.
- roadmap/docs: plans, decisions, and non-executable research.

## Baseline And Targets

Current measured baseline:

- root `AGENTS.md`: 82 lines.
- visible Tao project skills under `agents/skills/tao-dev`: 20 `SKILL.md` entries.
- discovery paths:
  - `.codex/skills -> ../agents/skills`
  - `.claude/skills -> ../agents/skills/tao-dev`
  - `.codex/agents/*.toml -> ../../agents/agent-types/*.toml`

Targets for the first migration:

- root `AGENTS.md` is shorter and reads as repo-wide behavior plus routing, not package or workflow detail.
- visible Tao project skills drop from 20 to 14 if the seven lifecycle skills become one `project-lifecycle` skill.
- visible Tao project skills drop to 13 if `simple-subagents-review` is also folded into `subagents-review`, while `subagents-review-stringent` remains separate.
- routing remains reliable for explicit lifecycle tasks and review tasks after consolidation.

## Proposed Structure

### Root `AGENTS.md`

Keep:

- Tao identity and Ro authority.
- command routing through `./agent`.
- Git/index safety.
- peer-worktree safety.
- inspect-first autonomy.
- routing table to nested AGENTS and skills.
- final validation rule.
- compact repo map.

Move or reduce:

- broad quality details that duplicate `packages/AGENTS.md`.
- any package-specific examples.
- long skill explanations; keep only trigger routing.

Target: root `AGENTS.md` should answer "how do I behave anywhere in this repo?" not "how do I write every kind of code?"

### `packages/AGENTS.md`

Keep:

- feature-sliced pipeline rules.
- validator/compiler/runtime ownership.
- `Switch` usage.
- shared wrappers and `HCI`.
- `FS.resolvePath` path convention.
- import/export surface conventions.
- package test wrapper rule.

Consider splitting later:

- `packages/dev/AGENTS.md`: dev automation output, `./agent`, TUI, Justfile command behavior.
- `packages/runtime/AGENTS.md`: runtime package boundaries and Jest/Expo constraints.
- `packages/runtime/TaoRuntime-src/AGENTS.md`: `TR` runtime facade and generated-code contract.
- `packages/parser/AGENTS.md`: Langium wrapper/scoping imports, if scoping rules keep appearing outside the skill.
- `packages/tao-cli/AGENTS.md`: Tao CLI `HCI`, `InPlaceFiles`, file discovery, and command error behavior.

Do not split until a subtree has enough stable rules to justify another always-loaded local file.

### `Apps/AGENTS.md`

Add only if app rules grow beyond Test Apps.

Possible ownership:

- Kitchen Sink is executable showcase coverage and should only include implemented behavior.
- Test Apps are positive examples with `Purpose.md` contracts.
- app behavior tests should live in Tao where possible.

If added, keep `Apps/Test Apps/AGENTS.md` as the more specific file.

### `agents/AGENTS.md`

Add a nested instruction file for agent assets.

Own:

- canonical source is `agents/`.
- `.codex/skills -> ../agents/skills` is a Codex skill discovery symlink.
- `.claude/skills -> ../agents/skills/tao-dev` is a Claude skill discovery symlink.
- `.codex/agents/*.toml -> ../../agents/agent-types/*.toml` are Codex agent-type discovery symlinks.
- project skills live under `agents/skills/tao-dev/`.
- agent types live under `agents/agent-types/`.
- do not vendor generic skill bundles into `agents/skills` unless Ro asks.

This would let root `AGENTS.md` shrink its skill/symlink detail to a routing line.

Before relying on this file, verify nested `agents/AGENTS.md` context loads for edits through canonical `agents/...` paths and through symlinked `.codex/skills/...` and `.claude/skills/...` paths. If the harness does not resolve nested instructions by realpath, root `AGENTS.md` must keep an explicit route for skill edits.

### `Roadmap/AGENTS.md`

Add if roadmap editing keeps expanding.

Own:

- active task folders under `Roadmap/<Task>/`.
- archive whole completed task folders under `Roadmap/Archive/<Task>/`.
- keep `Roadmap.md` current and compact.
- put implementation detail in task docs, not root roadmap.
- leave archives historical unless explicitly asked or still active as instructions.

This would let root reduce roadmap archive detail.

## Skill Restructure

### Keep As Separate Skills

- `agent-instructions`
- `working-with-skills`
- `dev-automation`
- `runtime-codegen`
- `langium-scoping`
- `old-repo-porting`
- `refactor`
- `stale-repo-check`
- `architectural-review`
- `subagents-review`
- `commit-all-chunks`

These have clear triggers and materially different behavior.

### Recommended Consolidations

#### Project lifecycle

Recommend replacing seven visible skills:

- `project-1-decide-next-project`
- `project-2-research-project`
- `project-3-write-project-plan`
- `project-4-review-project-plan`
- `project-5-implement-project`
- `project-6-review-implementation`
- `project-7-merge-feature-branch`

with one visible `project-lifecycle` skill.

Shape:

- `SKILL.md` contains the trigger description, routing table, shared lifecycle rules, and "read only the phase section/reference you need."
- phase details move to `references/phase-1-decide.md`, `phase-2-research.md`, etc., or sections inside the same skill if reference loading is not reliable.

Trigger preservation:

- The consolidated skill description must enumerate the phase phrases: select/decide next project, research project, write project plan, review project plan, implement project, review implementation, and merge feature branch.
- The skill body starts with a phase routing table from user intent to the exact section or reference file to read.
- Update root routing, roadmap docs, and review prompts to use `project-lifecycle`.
- Do not keep old phase skills as long-term stub aliases unless the tool supports hidden aliases; visible stubs preserve the clutter this change is meant to remove.
- If Ro still wants explicit `$project-5-implement-project` invocation, treat that as a reason to keep the seven-skill split.

Prerequisite:

- Prove reference loading on one lower-risk consolidation before moving lifecycle details into `references/`. A good first test is folding `simple-subagents-review` into `subagents-review` with a mode reference.

Tradeoff:

- Fewer visible skills and less list clutter.
- Slightly more routing logic inside one skill.
- Existing explicit `$project-5-implement-project` habits either need to be retired or preserved by keeping the split.

#### Review modes

Recommend folding `simple-subagents-review` into `subagents-review` as a `simple` mode.

Recommend keeping `subagents-review-stringent` separate because "stringent", "deep", and "hard-mode" are strong triggers and materially different enough to deserve their own visible entry.

Shape:

- `subagents-review` owns `simple` and `standard` modes.
- `subagents-review-stringent` stays visible and can share references or automation with `subagents-review`.
- long orchestration details move to references or stay behind mode headings.

Tradeoff:

- One fewer visible skill without diluting the strongest review trigger.
- Shared review mechanics can move toward automation without erasing useful mode names.

### Move Long Mechanics Toward Automation

For review and lifecycle skills, prefer:

- skill says when and why.
- `./agent` command help knows exact command shape.
- automation writes artifact directories and manifests.
- generated prompts include only relevant instructions for subagents.

Do not duplicate long command recipes in multiple skills once the automation is reliable.

## Follow-Up: Reviewer Context Automation

This is useful, but it is a separate automation project from the first instruction reorganization.

The first migration should only create the instruction structure that makes later generated context possible. The automation below should be promoted to its own roadmap task if Ro wants it next.

Main agent should load:

- root `AGENTS.md`
- nearest nested AGENTS for files it edits
- the one or two skills matching the task

Review subagents should load:

- a compact review contract
- relevant root safety and read-only rules
- changed-file-specific nested AGENTS snippets
- relevant skill excerpt for the review lens
- scoped diff or scope file

This avoids main-agent context bloat and lets specialized reviewers receive stricter, narrower instructions.

Potential automation improvement:

- `./agent review plan` can generate a `context.md` per reviewer containing only:
  - scope summary
  - changed files
  - relevant AGENTS snippets
  - relevant skill excerpt
  - lens-specific checklist

## Instruction Audit Improvements

Add audit patterns only after conventions settle.

Instruction-prose candidates for `audit-instructions`:

- Warn on project skills that tell agents to read root `AGENTS.md`.
- Warn on skill bodies that duplicate long `./agent review` command recipes once automation owns them.
- Warn on root `AGENTS.md` growing package-specific TypeScript rules.
- Warn when `.codex/skills`, `.claude/skills`, or `.codex/agents` discovery links stop pointing at canonical `agents/` sources.

Source-code candidates for ESLint, a dedicated code audit, or `just verify`, not `audit-instructions`:

- Warn on native `switch (` in repo TypeScript, with explicit allowlists for generated code or documented exceptions.
- Warn on references to removed code tools such as old glob/globby wrappers.

## Migration Steps

1. Capture before numbers: root `AGENTS.md` lines, visible Tao skill count, and current discovery links.
2. Verify whether nested `agents/AGENTS.md` would load through canonical and symlinked skill paths.
3. Add `agents/AGENTS.md` and move skill/symlink ownership out of root prose if step 2 proves it will load reliably; otherwise keep explicit root routing.
4. Add `Roadmap/AGENTS.md` only if Ro wants roadmap rules to be auto-loaded for roadmap edits.
5. Shorten root `AGENTS.md` to universal behavior plus routing.
6. Review `packages/AGENTS.md` after this patch lands; split only stable subtree rules into package-specific AGENTS files.
7. Prove skill reference loading by folding `simple-subagents-review` into `subagents-review`.
8. Consolidate project lifecycle skills into one `project-lifecycle` skill if Ro accepts retiring the old explicit phase skill names.
9. Move long review/lifecycle command mechanics into `./agent` help or generated context files only after the relevant automation is reliable.
10. Extend `audit-instructions` with settled instruction-prose checks only; route source-code checks to code lint/verify.
11. Run `./agent audit-instructions --strict` and `./agent just verify`.

## Acceptance Criteria

- Root `AGENTS.md` is shorter and contains only universal rules plus routing.
- Editing a package subtree still loads all rules needed for that subtree.
- Skill list is shorter or each remaining skill has a clearly distinct trigger.
- Discovery symlinks for Codex and Claude are covered by the canonical-source rule.
- Consolidated skills pass manual trigger spot-checks for the phrases they replace.
- If skill details move into references, a manual check proves the relevant reference is read before action.
- `./agent audit-instructions --strict` passes.
- `./agent just verify` passes.

## Open Decisions For Ro

- Does Ro approve consolidating the seven project lifecycle skills into one visible `project-lifecycle` skill, knowing old explicit `$project-N-...` skill names would be retired unless the split is kept?
- Does Ro approve folding `simple-subagents-review` into `subagents-review` while keeping `subagents-review-stringent` separate?
- Should `Roadmap/AGENTS.md` exist now, or is root routing plus project lifecycle skills enough?
- Should package-specific AGENTS files be added now for `packages/dev`, `packages/runtime`, and `packages/tao-cli`, or only after the current testing/dev-loop patch lands?
