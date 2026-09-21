# Recurring repository pass

This document is the current handoff between repository-wide passes. It records only what the most
recent pass covered, what it did not cover, and what the next pass should consider. Replace those
notes after each completed pass; Git history is the longer record.

## Current status

- **Most recent full catch-up:** the September squash-merge audit reviewed `main` through
  `18505fafbb5b4cae20351c1e8ef5dfbdc805e499`. Its remediation and remaining external acceptance
  boundary are recorded in
  [`September squash-merge remediation.md`](<../Archive/Reports/September squash-merge remediation.md>).
- **Covered:** correctness and regression review of the first-parent squash merges through that
  commit, followed by independent verification and deduplication of proposed findings.
- **Not covered for the next pass:** commits after that boundary. The next orchestrator must inspect
  them before deciding which kinds of review or repository-health work are worthwhile. The prior
  pass does not establish current dependency security or external device, provider, signing, or
  distribution acceptance.

## Consider next time

- Start with the commits after the recorded boundary and the current repository documentation;
  choose checks because the changes make them useful, not because every category must run.
- Consider correctness and regressions, security, architecture and package boundaries, test and
  verification quality, documentation or roadmap drift, simplification, setup reproducibility, and
  release or external-platform concerns.
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
