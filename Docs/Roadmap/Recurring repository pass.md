# Recurring repository pass

This document is the current handoff between repository-wide passes. It records only what the most
recent pass covered, what it did not cover, and what the next pass should consider. Replace those
notes after each completed pass; Git history is the longer record.

## Current status

- **Reviewed through:** `39aac77ca3d4f95b4cb774bdfe586bcbc2fa2864` (2026-09-28), the 12 first-parent landings after `0e3f6a9b`. The [September 28 repository health review](<September 28 repository health review.md>) records the dispositions and evidence boundaries. The reviewed repairs are on `feat/repository-pass-2026-09-28`; the repository gate passed, and landing remains separate.
- **Repairs:** Corrected the InstantDB data contract, watchOS numeric text and Xcode selection, screenshot provenance, unique run identity and timeline concurrency, and GUI lease coverage for retries and standalone native Studio commands. An ownership-checked Linux interrupted-run recovery mode has focused mock evidence; real recovery awaits approval for the expanded host-command argument.
- **Health:** Worktree parents changed substantially, but `./agent worktree-status` found no automatic reclaim candidate; an active temporary checkout and all shared caches were preserved. Cache lifecycle bounds exist. Routing audit found no mismatch, while completed-task cost and the due shell-prefix/output-source measures remain unavailable. The [dependency advisory follow-up](<Dependency advisory follow-up.md>) keeps all three items open with new review dates.
- **Acceptance:** Fresh vanilla and prepared-Xcode Tart clones of committed `39aac77c` passed installed CLI scenarios and filesystem audits, then cleaned up their run resources. An execution-tool sandbox denial killed the ARM64 Linux runner; a later inspection found its cold guest exited 0, but cold receipt collection and cached acceptance are unproved. Its exact labelled guest/base remain for authorized recovery. Native amd64, hosted cloud, native app/device, signing and distribution were not exercised.

## Consider next time

- Start after `39aac77c` or a newer explicitly reviewed first-parent boundary. Carry forward this pass's outstanding Linux recovery/acceptance and integration evidence; source review alone does not close them.
- Preserve active and owner-unknown worktrees, shared caches, and the exact labelled Linux guest until terminal evidence is collected and its recovery is approved. Recheck task associations before any reclaim.
- Keep ARM64 Linux, native amd64, hosted cloud, installed CLI, native builds, devices, signing and distribution as distinct evidence boundaries. Recheck the three open dependency items on their recorded dates.
- Explicit prerelease installation and WordFlower outline export remain deferred until after MVP. New-emulator exit-log acceptance, quiet-machine admission measurement and deferred human startup confirmation remain separate follow-ups.

## Periodic isolation checks

Keep these explicit periodic host checks, outside ordinary verification runs. Follow the existing
[installed CLI and prepared-base commands](<../MVP Roadmap/Plan - Standalone Tao CLI.md#follow-up-order-decided-2026-09-26>)
and [contributor verification workflow](<Developer environment upgrades/DEVENV-CLOUD-AGENT-EXECUTIONS-LACK-PORTABLE-BOOTSTRAP.md#local-reproduction-and-cloud-proof>):

- Run installed CLI acceptance in a fresh vanilla Tart clone, including its mandatory filesystem
  audit. Exercise a fresh clone of the prepared Xcode base separately; this qualifies that
  environment and installed CLI behavior, not native app builds or simulator launches.
- Run both cold and cached Ubuntu contributor verification against the intended committed HEAD.
  Record bootstrap and repository verification separately from actual hosted-cloud compatibility.
- Inspect failures and fix repository-owned defects within the approved pass scope, then rerun
  the affected checks. Record external blockers and every unrun check explicitly.
- Inspect retained clones, containers, image caches, and cleanup behavior. Distinguish reusable
  vanilla/Xcode bases and toolchain caches from disposable run results. Preserve active resources,
  unrelated resources, and evidence still needed for debugging; confirm activity and mounted-disk
  state before cleanup. Record tested commits, image identities, timings, evidence paths, cleanup
  outcomes, and each retained resource's owner, purpose, and cleanup condition.

For now, designate exactly one isolation-test agent in the approved pass plan, with ownership
across all worktrees on the account. That agent runs vanilla, prepared Xcode, and Linux checks
sequentially, completing evidence collection and resource accounting before starting the next.
Other worktrees must defer isolation runs until the owner explicitly hands off or finishes.
This is manual coordination, not a scheduler or a parallel-execution facility: Tart's existing
account-wide lease rejects a competing run rather than queuing it; the Linux runner has no
equivalent cross-worktree guard. If ownership is unclear or a competing run is found, stop and
resolve ownership with the Developer; never infer an idle account from an absent Tart lease or
force-release a lease. The procedure depends on all participants observing the single-owner rule.

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
   for any accepted fixes included in the approved pass. Assign the periodic isolation checks above
   to one owner; do not fan them out across those subagents or worktrees.
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
