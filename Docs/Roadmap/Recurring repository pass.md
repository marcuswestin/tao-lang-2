# Recurring repository pass

This document is the current handoff between repository-wide passes. It records only what the most
recent pass covered, what it did not cover, and what the next pass should consider. Replace those
notes after each completed pass; Git history is the longer record.

## Current status

- **Reviewed through:** `a996fc512826c18f214f4c873eca2a486cf2ea84` on local `main` (2026-09-25). The [September 2026 repository review](<September 2026 repository review.md>) retains the historical 142-landing ledger through `ff4f017c` and separately disposes all 21 newer first-parent landings. Four read-only units and independent challenges checked repair integration and current behavior. The review branch has integrated this main tip; the locked landing gate and archive ref remain unproved.
- **Outcome:** The review branch carries the earlier fixes plus focused corrections for a host-test receipt interruption, a released-port test race, an inherited host marker, a false-green admission measurement, and direct CocoaPods locale propagation. Focused tests passed, including the host controls after a deliberate mutation failed. Current `main` still retains old host-test output; two Jest entrypoints lack aggregate or direct-run bounds. The newer emulator-exit change can read an earlier launch's reason from its shared append-only log and needs a per-launch log after integration. Old shared and receipt-less state was preserved because ownership/liveness was not established.
- **Security follow-up:** The current Bun audit still reports one moderate `uuid` advisory with no affected caller found in its installed `xcode` parent; the [dependency advisory follow-up](<Dependency advisory follow-up.md>) keeps its owner and September 28 review date. The pinned Nixpkgs input still needs upstream-patch comparison and Linux closure. Standalone and Companion release downloads need an authenticity decision and signing inputs before public distribution.

## Consider next time

- Shortlist developer-environment work from the generated [open index](<Developer environment upgrades.md>).
  Check each entry's evidence, impact, dependencies, acceptance, and live branch owner against
  current `main` and the [archive](<Developer environment upgrades archive.md>); reproduce candidates,
  defer owned or blocked work, and take only a few high-impact items with achievable acceptance checks.
- Start after `a996fc51` or the newer first-parent boundary established during landing. Repair the
  [emulator exit-log defect](<Developer environment upgrades/DEVENV-EMULATOR-EXIT-LOG-CAN-REPORT-PRIOR-LAUNCH.md>)
  in this pass before landing; later passes should check whether its acceptance holds under real host use.
- Recheck `uuid`, the Appium transitive pins, and Linux Nixpkgs in
  [Dependency advisory follow-up](<Dependency advisory follow-up.md>). Use real host or device evidence
  before claiming native, Cloud, signing, distribution, or installed-binary acceptance.
- Re-measure identity count, bytes, file count, age, and leases in `~/.cache/tao/jest-transform-cache`,
  `~/.cache/tao/jest-standalone`, `$TMPDIR/jest_dx`, `$TMPDIR/tao-test-runs`, and `.artifacts/host-testing`
  across relevant worktrees. Give every owner-unknown root an explicit disposition. Bound managed
  identities and direct Jest with lease-aware normal-operation cleanup; preserve active state.
- Include a quick dependency-advisory check in every security review. Inspect dependency changes
  against primary sources: run [`bun audit`](https://bun.sh/docs/pm/cli/audit) for the Bun graph and
  inspect `devenv.lock` changes against the [Nixpkgs security tracker](https://tracker.security.nixos.org/)
  and affected upstream notices. Add other dependency systems when they appear.

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
4. Check temporary-state growth: identify creation sites and retention rules, measure significant
   worktree and machine-wide accumulation, and distinguish active state from abandoned output. For
   each material source, design and verify a bounded cleanup path in normal agent operations; do not
   remove another live run's files or rely solely on a one-time purge.
5. Verify evidence, reject or deduplicate unsupported findings, and distinguish repository defects
   from host or external acceptance that was not exercised. For each unresolved dependency advisory,
   keep a short live record of its disposition, owner, review-by date, and primary evidence; close
   it explicitly when resolved.
6. When the approved work is complete, replace **Current status** and **Consider next time** with the
   new reviewed-through commit, a brief account of what actually ran, material omissions, the outcome,
   and only the few notes that would help the next orchestrator.

Keep this document short. Commit history and the repository's owning specifications, roadmaps, and
backlogs provide detail when a later pass needs it.
