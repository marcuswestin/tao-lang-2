# Recurring repository pass

This document is the current handoff between repository-wide passes. It records only what the most
recent pass covered, what it did not cover, and what the next pass should consider. Replace those
notes after each completed pass; Git history is the longer record.

## Current status

- **Most recent catch-up:** the 2026-09-21 pass reviewed the 74 first-parent `main` commits after
  `18505fafbb5b4cae20351c1e8ef5dfbdc805e499`, through
  `5e3526439008882a2c15da3e1cbdc44b7976cc91`. The earlier remediation and its external
  acceptance boundary remain in
  [`September squash-merge remediation.md`](<../Archive/Reports/September squash-merge remediation.md>).
- **Covered:** changed language/CLI, Studio and native host control, developer automation, and
  verification seams; focused reproductions and tests for accepted defects; `bun audit` on the
  recorded lock graph; and the Nixpkgs tracker and upstream notices for pinned `devenv.lock` inputs.
- **Outcome and limits:** remediation on `feat/recurring-repository-pass-september-catchup` addresses the confirmed
  CLI false pass, Studio target routing and element identity, Appium input/close races, and developer
  workflow defects. The lock graph resolves Appium's `@xmldom/xmldom@0.9.12`, Expo's compatible
  `@xmldom/xmldom@0.8.15`, and `morgan@1.12.0`; 43 other Bun audit records predated this range.
  Subsequent [dependency advisory follow-up](<Dependency advisory follow-up.md>) on
  `feat/dependency-advisory-health` reduced those records to one and repaired the stale-link health
  check. The pinned Linux Nixpkgs input still needs an update and Linux acceptance. Agent-config
  recovery now resolves dprint plugins from installed local packages, including with a cold cache.
  This pass did not establish physical-device, real CloudKit,
  installed-binary OTA, signed Studio, or distribution acceptance. The later `2bc90866` package
  restructure was integrated for compatibility but has not had a repository-wide pass.

## Consider next time

- Start after `5e3526439008882a2c15da3e1cbdc44b7976cc91`, reading any new hook override log
  entries before revisiting the 2026-09-21 agent-governance changes. Choose checks from the changes
  and current risks rather than repeating every category.
- Recheck the Appium transitive pins when its Base Driver publishes `morgan@1.12.0`; remove the
  override when it can resolve without one. Follow the remaining `uuid` and Linux Nixpkgs items in
  [Dependency advisory follow-up](<Dependency advisory follow-up.md>), and use the installed-link
  health check after lock changes. Use real host or device evidence before claiming external
  acceptance.
- Include a quick dependency-advisory check in every security review. Inspect dependency changes and
  research current advisories or security releases from primary sources:
  - For the Bun/npm graph recorded by `package.json` files and `bun.lock`, run
    [`bun audit`](https://bun.sh/docs/pm/cli/audit) and investigate relevant reported or skipped
    packages against their official advisories.
  - For inputs recorded by `devenv.lock`, inspect changed inputs, the
    [Nixpkgs security tracker](https://tracker.security.nixos.org/), and the affected upstream
    projects' official security notices.
  - If the repository gains another dependency system, identify its official audit command or
    advisory source during planning and add it here only if future passes will need it.

## Run a pass

1. Create a dedicated worktree and branch from current `main`. Read this document, inspect the
   commits after the recorded boundary, and read the current documents governing the affected
   areas. Account for what the previous pass covered, omitted, and suggested next.
2. Propose a concise high-level pass to Ro before starting it. Name the checks worth doing now, why
   they are useful, their commit/package/seam scope, how subagents would divide the work, intentional
   overlap, and what the pass would leave out. Wait for Ro's comments or approval.
3. After approval, orchestrate the pass with focused subagents. Review assignments may overlap
   commits or paths when different specialties need the same evidence. Keep assessment subagents
   read-only until their findings have been checked and reconciled; use a later implementation phase
   for any accepted fixes included in the approved pass.
4. Verify evidence, reject or deduplicate unsupported findings, and distinguish repository defects
   from host or external acceptance that was not exercised.
5. When the approved work is complete, replace **Current status** and **Consider next time** with the
   new reviewed-through commit, a brief account of what actually ran, material omissions, the outcome,
   and only the few notes that would help the next orchestrator.

Keep this document short. Commit history and the repository's owning specifications, roadmaps, and
backlogs provide detail when a later pass needs it.
