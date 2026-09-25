# Recurring repository pass

This document is the current handoff between repository-wide passes. It records only what the most
recent pass covered, what it did not cover, and what the next pass should consider. Replace those
notes after each completed pass; Git history is the longer record.

## Current status

- **Reviewed through:** `7af6064174487e54c17c0737b8f91dd8d3bd4275` on local `main` (2026-09-25). The [September 2026 repository review](<September 2026 repository review.md>) retains the historical 142-landing ledger through `ff4f017c` and separately disposes all 24 newer first-parent landings. Four read-only units and independent challenges checked repair integration and current behavior. The review branch has integrated this main tip; the locked landing gate and archive ref remain unproved.
- **Outcome:** The review branch carries the earlier fixes plus focused corrections for a host-test receipt interruption, a released-port test race, an inherited host marker, a false-green admission measurement, direct CocoaPods locale propagation, stale Android emulator exit logs, Studio publication recovery, standalone installer home paths, and the Claude model warning. Focused tests passed, including the host controls after a deliberate mutation failed. Current `main` still retains old host-test output; managed Jest identities and direct Jest lack aggregate bounds and do not follow `TAO_HOME`. Old shared and receipt-less state was preserved because ownership/liveness was not established. Emulator and Studio fixes have no real host acceptance in this pass.
- **Security follow-up:** The current Bun audit still reports one moderate `uuid` advisory with no affected caller found in its installed `xcode` parent; the [dependency advisory follow-up](<Dependency advisory follow-up.md>) keeps its owner and September 28 review date. The pinned Nixpkgs input still needs upstream-patch comparison and Linux closure. Standalone and Companion release downloads need an authenticity decision and signing inputs before public distribution.

## Consider next time

- Shortlist developer-environment work from the generated [open index](<Developer environment upgrades.md>).
  Check each entry's evidence, impact, dependencies, acceptance, and live branch owner against
  current `main` and the [archive](<Developer environment upgrades archive.md>); reproduce candidates,
  defer owned or blocked work, and take only a few high-impact items with achievable acceptance checks.
- Start after `7af60641` or the newer first-parent boundary established during landing. Check the
  [emulator log repair](<Developer environment upgrades/Archive/DEVENV-EMULATOR-EXIT-LOG-CAN-REPORT-PRIOR-LAUNCH.md>)
  under real host use when available.
- Recheck `uuid`, the Appium transitive pins, and Linux Nixpkgs in
  [Dependency advisory follow-up](<Dependency advisory follow-up.md>). Use real host or device evidence
  before claiming native, Cloud, signing, distribution, or installed-binary acceptance.
- Re-measure identity count, bytes, file count, age, and leases in Tao's configured cache root
  (`TAO_HOME/cache`, `$XDG_CACHE_HOME/tao`, or `~/.cache/tao`), legacy `$TMPDIR/jest_dx` and
  `$TMPDIR/tao-test-runs`, and `.artifacts/host-testing` across relevant worktrees. Give every
  owner-unknown root an explicit disposition and preserve active state. Check that routine runs
  retire inactive identities without touching legacy roots that lack ownership evidence.
- Recheck that `TAO_HOME` moves managed caches without creating new login-home cache state.
  The installed Claude Code 2.1.267 needs an approved host update to
  run configured Opus 5.5 standard and deep profiles; the shared Bun 1.3.13 profile needs its
  already tracked reload before standalone-binary acceptance.
- Include a quick dependency-advisory check in every security review. Inspect dependency changes
  against primary sources: run [`bun audit`](https://bun.sh/docs/pm/cli/audit) for the Bun graph and
  inspect `devenv.lock` changes against the [Nixpkgs security tracker](https://tracker.security.nixos.org/)
  and affected upstream notices. Add other dependency systems when they appear. Recheck the Appium
  transitive pins when Base Driver permits `morgan@1.12.0` and run installed-link health after lock changes.

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
   remove another live run's files or rely solely on a one-time purge. Include a read-only grouped
   inventory of the largest active projects' worktrees, caches, and Tao-named OS temp roots: report
   total bytes, file count, oldest age, known owner, and change from the previous pass per project
   and root class. Identify temporary roots that can affect boot-time cleanup by file count as well
   as bytes. Keep another project's cleanup with that project's owner; do not turn this inventory
   into a machine-wide deletion command.
5. Check model routing: run `./agent model-audit`, then compare the delegation routing table with
   official model availability, harness precedence, and current input, cache-read, cache-write, and
   output pricing. Weigh completed-task cost and review quality before recommending a tier change,
   since an API-equivalent estimate is not a plan or subscription bill; the change itself is the
   Developer's choice, never a silent switch.
6. Verify evidence, reject or deduplicate unsupported findings, and distinguish repository defects
   from host or external acceptance that was not exercised. For each unresolved dependency advisory,
   keep a short live record of its disposition, owner, review-by date, and primary evidence; close
   it explicitly when resolved.
7. When the approved work is complete, replace **Current status** and **Consider next time** with the
   new reviewed-through commit, a brief account of what actually ran, material omissions, the outcome,
   and only the few notes that would help the next orchestrator.

Keep this document short. Commit history and the repository's owning specifications, roadmaps, and
backlogs provide detail when a later pass needs it.
