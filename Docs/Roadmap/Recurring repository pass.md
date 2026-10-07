# Recurring repository pass

This document is the current handoff between repository-wide passes. It records only what the most
recent pass covered, what it did not cover, and what the next pass should consider. Replace those
notes after each completed pass; Git history is the longer record.

## Current status

- **Reviewed through:** `fe7a4da74` (2026-10-07): the five first-parent landings after `a198e71b6`, apart from the morning pass `c4b48ea1b`. The [October 7 afternoon repository health review](<October 7 afternoon repository health review.md>) records the findings, their dispositions, and the limits of the evidence. The fixes are on `feat/repository-pass-2026-10-07-b`.
- **Repairs:**
  - Hosted Verify again runs `_dprint-check` and `_tao-check`. It had run neither since `9c128d74d` skipped the fixers.
  - repo-lint rejects duplicate MVP roadmap item IDs. The three existing duplicates are renumbered A31–A33.
  - The native-binding manifest error prints its regeneration hint once.
  - `tao test` cleans up its Jest resource directory when a run fails.
- **Health:** The machine had just been cleaned, so worktree and cache totals fell from about 250 GiB to under 10 GiB, and process records from 920 to 2. Tracked blobs are 42.6 MB. The routing audit found no mismatch. Haiku 5.5's price fell to a tenth.
- **Acceptance:** Not established. Every macOS Tart check fails at provisioning from this host account, which is uid 503 where provisioning needs 501. The Ubuntu check needs Docker raised to 16 GB. `performance-check` was inconclusive: language check timings ran slightly over budget while Spotlight indexed the machine.

## Consider next time

- Start after `fe7a4da74`, or after a newer first-parent boundary that has been explicitly reviewed.
- Decisions left to the Developer in the two October 7 reviews:
  - `app-dev --ios` changed what it downloads and installs without telling the Developer. Its offline fallback (E1) and an ownership check for `processes stop` are open too (U1).
  - `argsPolicy` for the operations that lack one (October 7 U1/U2).
  - `land-fix`: gates before push, or requiring `Verify (host)` (L1).
  - Test-process survivors and the idle bound (T2, T4).
  - Docker memory.
  - The six remote heads already contained in `main`, and the six stale branches.
  - The QA renderer-hash scope (Q7, Q8).
  - Dead features and duplicate tooling (K2–K4).
  - Unused dependencies and lagging majors.
  - Package README audience (D3), `packages/AGENTS.md` over budget (D4), and configuration-list layout (F2).
  - A Sonnet row in the routing table.
- Before the macOS isolation checks, settle `DEVENV-TART-PROVISIONING-REQUIRES-HOST-UID-501`, or run them from a uid-501 account. The vanilla base is cached.
- Recheck the six tutorial QA observations and regenerate the QA dashboard once Q7 is decided.
- Watch hosted Chrome startup. The next `DevToolsActivePort` timeout carries `fe7a4da74`'s stall snapshot; read it before changing the timeout.
- Keep each evidence boundary distinct: ARM64 Linux, native amd64, hosted cloud, the installed CLI, native builds, devices, signing and distribution. Explicit prerelease installation and WordFlower outline export stay deferred until after MVP.

## Periodic isolation checks

Run `./agent unsandboxed performance-check` against the pass's committed HEAD as a separate,
sequential host proof. It reserves the machine's test capacity and checks host conditions while
measuring language operations and real Studio saves, including an HNReader editor padding edit.
Keep its summary and per-edit phase samples with the pass evidence. Busy or unavailable host
evidence is inconclusive; repeat the unchanged code after contention clears. Ordinary verification
retains deterministic repeated-work regressions, while this periodic proof enforces timing budgets.

Keep these explicit periodic host checks, outside ordinary verification runs. Follow the existing
[installed CLI and prepared-base commands](<../MVP Roadmap/Plan - Standalone Tao CLI.md#follow-up-order-decided-2026-09-26>)
and [contributor verification workflow](<Developer environment upgrades/DEVENV-CLOUD-AGENT-EXECUTIONS-LACK-PORTABLE-BOOTSTRAP.md#local-reproduction-and-cloud-proof>):

- Run installed CLI acceptance in a fresh vanilla Tart clone, including its mandatory filesystem
  audit. Exercise a fresh clone of the prepared Xcode base separately; this qualifies that
  environment and installed CLI behavior, not native app builds or simulator launches.
- Run both cold and cached Ubuntu contributor verification against the intended committed HEAD.
  Record bootstrap and repository verification separately from actual hosted-cloud compatibility.
- Prove the contributor path from a clean machine on both macOS (a fresh vanilla Tart clone) and
  Ubuntu: following only the documented getting-started instructions, set up the repository, run
  its tests, start a development loop, make a language or toolchain change, and see it take effect.
  Record each step's time and friction, not just whether it passed.
- Inspect failures and fix repository-owned defects within the approved pass scope, then rerun
  the affected checks. Record external blockers and every unrun check explicitly.
- Inspect retained clones, containers, image caches, and cleanup behavior. Distinguish reusable
  vanilla/Xcode bases and toolchain caches from disposable run results. Preserve active resources,
  unrelated resources, and evidence still needed for debugging; confirm activity and mounted-disk
  state before cleanup. Record tested commits, image identities, timings, evidence paths, cleanup
  outcomes, and each retained resource's owner, purpose, and cleanup condition.

For now, designate exactly one isolation-test agent in the approved pass plan, with ownership
across all worktrees on the account. That agent runs vanilla, prepared Xcode, macOS contributor, and Linux checks
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
6. Run the standing health checks, reporting each against the previous pass's figures:
   - **Committed growth:** generated, evidence, or snapshot files entering Git, and repository
     object size; each needs an owner, a reader, and a retention rule.
   - **`main` and CI:** red runs on `main`, `land-fix` uses, Verify retries and cancellations, and
     the hosted Verify duration trend.
   - **Test suite:** skipped and early-returning tests, the slowest suites, flaky tests, and tests
     that assume a platform, user (non-root), or filesystem.
   - **Unsandboxed surface:** what `.rulesync/permissions.jsonc` and the `./agent unsandboxed`
     operations gained since the boundary, and whether each addition is still justified.
   - **Hook overrides:** `.artifacts/logs/hook-overrides.jsonl` across worktrees; tune any rule
     that is overridden routinely.
   - **Instruction and document drift:** skill and `AGENTS.md` budgets, broken links, specifications
     against `Decisions.md` and the implementation, and stale or already-done MVP Roadmap items.
   - **Dependency hygiene:** unused dependencies, duplicate versions, lagging major versions, and
     dead exports, beyond the advisory record.
   - **Branches and pull requests:** unmerged pushed branches, stale pull requests, and orphaned
     remote branches.
   - **Developer-environment ledger:** entry age, duplicates, and entries already fixed but not
     archived.
   - **Dead and duplicate features:** commands, flags, recipes, modules, and workflows that are
     unused, superseded, or near-duplicates of another way to do the same thing. Tao keeps as few
     ways to do something as stay ergonomic and discoverable; propose removals with their callers.
   - **Deferred findings:** close or re-defer each item from the previous **Consider next time**
     with evidence, rather than carrying it forward unexamined.
7. Verify evidence, reject or deduplicate unsupported findings, and distinguish repository defects
   from host or external acceptance that was not exercised. For each unresolved dependency advisory,
   keep a short live record of its disposition, owner, review-by date, and primary evidence; close
   it explicitly when resolved.
8. When the approved work is complete, replace **Current status** and **Consider next time** with the
   new reviewed-through commit, a brief account of what actually ran, material omissions, the outcome,
   and only the few notes that would help the next orchestrator.

Keep this document short. Commit history and the repository's owning specifications, roadmaps, and
backlogs provide detail when a later pass needs it.
