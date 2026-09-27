# Recurring repository pass

This document is the current handoff between repository-wide passes. It records only what the most
recent pass covered, what it did not cover, and what the next pass should consider. Replace those
notes after each completed pass; Git history is the longer record.

## Current status

- **Reviewed through:** `0e3f6a9bc5d63042e2eb4a60d6c1be78986d12fe` (2026-09-27), the 41 first-parent landings after `e94c3e1a`. The [September 27 repository health review](<September 27 repository health review.md>) records every disposition. The prior pass landed as `c85bcec5`; this pass is still in progress on `feat/repository-health-2026-09-27`.
- **Repairs:** Reference retry selection, enum defaults, handled cancellation of suspended asks, Studio Feed MIME dispatch and mount lifetime, mutation evidence isolation, and invocation-owned failure summaries. Fresh vanilla acceptance exposed global Bun fallback executables and a nonterminal collected receipt; runtime/workflow repairs passed fresh vanilla and prepared-Xcode acceptance on `84e7da1b`. Authenticated local-only custody is pending a Developer decision; optional data-field consistency is repaired with Tao roundtrip coverage and awaits integration.
- **Health:** No machine deletion is justified by the current inventory: 29 registered worktrees are protected/live and two unclassified; an unregistered broken-pointer root remains owner-unknown. Earlier large-root cleanup is observed, not claimed as this pass's work. Routing audit found no mismatch, but completed-task cost evidence is unavailable.
- **Acceptance:** Baseline vanilla scenarios completed, but the mandatory filesystem audit failed. Repaired vanilla and prepared-Xcode policy audits and terminal scenario receipts are accepted; headless HNReader Feed/edit/reopen acceptance also completed. Cold/cached Linux, optional-field integration and finalization remain pending. The [dependency advisory follow-up](<Dependency advisory follow-up.md>) records uuid, stream-json and Nixpkgs dispositions for September 28; no version or lockfile change was made.

## Consider next time

- Start after `0e3f6a9b` or a newer explicitly reviewed first-parent boundary. Carry forward any unfinished acceptance or semantic decisions from the current pass report; do not infer completion from its source-review boundary.
- Preserve active and owner-unknown worktrees and shared caches. Recheck task associations before reclamation. The previous temporary-state cleanup owner completed its work; future growth observations still need lifecycle and ownership evidence before deletion.
- Keep native ARM Linux, native amd64, actual hosted-cloud execution, prepared Xcode CLI acceptance, native builds, devices, signing and distribution as distinct evidence boundaries. A prepared base passing CLI scenarios does not establish native app acceptance.
- Recheck the advisory register on September 28. Explicit prerelease installation and WordFlower outline export remain deferred until after MVP. New-emulator exit-log acceptance, quiet-machine admission measurement and deferred human startup confirmation remain separate follow-ups.

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
