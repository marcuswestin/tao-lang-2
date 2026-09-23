# Recurring repository pass

This document is the current handoff between repository-wide passes. It records only what the most
recent pass covered, what it did not cover, and what the next pass should consider. Replace those
notes after each completed pass; Git history is the longer record.

## Current status

- **Reviewed through:** `ff4f017ceb100c39c7d55bec8c228ef967097be4` on `main` (2026-09-22). The [September 2026 repository review](<September 2026 repository review.md>) accounts for all 142 first-parent landings in the September 7–22 window: 7 in the independent earlier audit, 74 in the Developer-accepted catch-up handoff through `5e352643`, and 61 reviewed in this pass. Its commit ledger, ranked candidate list, findings, and limits are the detailed evidence.
- **Outcome:** The [September review](<September 2026 repository review.md>) found four P1 and several P2/P3 issues. This branch now carries focused fixes for the confirmed repository defects and a bounded host-test artifact lifecycle; they are not yet landed on `main`. A real Clockwork `prepare` run proved requested output stays inspectable, while ordinary successful proof builds are removed by the new lifecycle. Older unmarked run directories in another worktree and the Jest cache remain outside this branch's cleanup boundary.
- **Security follow-up:** The frozen Bun graph still reports one moderate `uuid` advisory; the existing [dependency advisory follow-up](<Dependency advisory follow-up.md>) owns its review date and call-site analysis. The pinned Nixpkgs input still needs upstream/security comparison and a Linux closure/host acceptance run.

## Consider next time

- Start after `ff4f017ceb100c39c7d55bec8c228ef967097be4`. Check whether this branch's repair commits landed, then review them and the remaining unreviewed commits. Re-measure host-test output after normal runs and preserve active worktree state.
- Recheck the remaining `uuid` and Linux Nixpkgs items in [Dependency advisory follow-up](<Dependency advisory follow-up.md>). Use real host or device evidence before claiming native, Cloud, signing, distribution, or installed-binary acceptance.
- Inspect where repository tools and agent workflows create temporary state, then measure size and age across worktrees and relevant machine-wide locations. For material buildup, trace ownership and design bounded cleanup during ordinary operations, including failed and interrupted runs. Preserve active state and avoid a one-time purge as the only remedy.
- Include a quick dependency-advisory check in every security review. Inspect dependency changes and research current advisories or security releases from primary sources:
  - For the Bun/npm graph recorded by `package.json` files and `bun.lock`, run [`bun audit`](https://bun.sh/docs/pm/cli/audit) and investigate relevant reported or skipped packages against their official advisories.
  - For inputs recorded by `devenv.lock`, inspect changed inputs, the [Nixpkgs security tracker](https://tracker.security.nixos.org/), and the affected upstream projects' official security notices.
  - If the repository gains another dependency system, identify its official audit command or advisory source during planning and add it here only if future passes will need it.

## Run a pass

1. Create a dedicated worktree and branch from current `main`. Read this document, inspect the
   commits after the recorded boundary, and read the current documents governing the affected
   areas. Account for what the previous pass covered, omitted, and suggested next.
2. Propose a concise high-level pass to the Developer before starting it. Name the checks worth doing now, why
   they are useful, their commit/package/seam scope, how subagents would divide the work, intentional
   overlap, and what the pass would leave out. Wait for the Developer's comments or approval.
3. After approval, orchestrate the pass with focused subagents. Review assignments may overlap
   commits or paths when different specialties need the same evidence. Keep assessment subagents
   read-only until their findings have been checked and reconciled; use a later implementation phase
   for any accepted fixes included in the approved pass.
4. Check temporary-state growth: identify creation sites and retention rules, measure worktree and
   machine-wide accumulation, and distinguish active state from abandoned output. For each material
   source, specify and verify a bounded cleanup path in normal agent operations; preserve live runs.
5. Verify evidence, reject or deduplicate unsupported findings, and distinguish repository defects
   from host or external acceptance that was not exercised. For each unresolved dependency advisory,
   keep a short live record of its disposition, owner, review-by date, and primary evidence; close
   it explicitly when resolved.
6. When the approved work is complete, replace **Current status** and **Consider next time** with the
   new reviewed-through commit, a brief account of what actually ran, material omissions, the outcome,
   and only the few notes that would help the next orchestrator.

Keep this document short. Commit history and the repository's owning specifications, roadmaps, and
backlogs provide detail when a later pass needs it.
