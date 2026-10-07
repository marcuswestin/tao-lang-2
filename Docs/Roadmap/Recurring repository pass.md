# Recurring repository pass

This document is the current handoff between repository-wide passes. It records only what the most
recent pass covered, what it did not cover, and what the next pass should consider. Replace those
notes after each completed pass; Git history is the longer record.

## Current status

- **Reviewed through:** `a198e71b6` (2026-10-06), the 26 first-parent landings after `5d9330f85`, with all eleven standing health checks run for the first time. The [October 7 repository health review](<October 7 repository health review.md>) records findings, dispositions and evidence boundaries. Repairs landed from `feat/repository-pass-2026-10-07`.
- **Repairs:** `land-fix` lands one commit; `sync-main` and `open-pr` tell git errors and cancelled runs apart; QA dependency snapshots and their writer removed; QA capture stages the tutorial project and discovery reports what it skips; the tutorial's printed commands are tested as written; platform-dependent tests report skips; the formatter re-indents item-type actions; duplicate release, format, test and bridge commands removed. `CONTRIBUTING.md` gives one getting-started path; `contributor-macos-test` runs it in a fresh vanilla Tart clone, and both contributor guests end with a dev loop that must pick up a compiler edit; `contributor-linux-test` refuses a Docker VM too small for its guest.
- **Health:** Tracked blobs fell from 47.6 to 42.4 MB. Process records tripled to 920 behind R2's open prune rule. Worktrees: `~/.codex/worktrees` 124.5 GiB (down from 176), `tao-lang-2.worktrees` about 116 GiB. Routing audit found no mismatch.
- **Acceptance:** Not established. The macOS contributor run stalled 100 minutes in the Nix install until its VM crashed; Ubuntu passed cold but its cached `verify` ran Docker out of memory; Tart vanilla, Xcode and `performance-check` did not run.

## Consider next time

- Start after `a198e71b6` or a newer explicitly reviewed first-parent boundary.
- Developer decisions recorded in the health review: `land-fix` pre-push gates or requiring `Verify (host)` (L1, and C2 of October 6); an `argsPolicy` for the `remote` operations and the other unpolicied host operations (U1, U2); a prune rule for process records (R2 of October 6); worktree retention and the 8 reclaimable worktrees; the dead-feature candidates (K2, K3) and the language migration shims; the formatter's configuration-list layout (F2); the audience of package READMEs (D3); trimming `packages/AGENTS.md` (D4); removing three unused dependencies and the lagging majors; whether QA's renderer hash should cover all of `packages/` (Q7); a Sonnet row in the routing table.
- Run the isolation checks first, on a quiet machine whose Docker has at least 16 GB. Read the Nix install log on the retained clone `tao-contributor-1791348473-74633` before rerunning `contributor-macos-test`; a stall with no CPU suggests a permission or keychain dialog a headless VM cannot show.
- The six tutorial QA observations need a recheck on a current commit.
- Keep ARM64 Linux, native amd64, hosted cloud, installed CLI, native builds, devices, signing and distribution as distinct evidence boundaries. Explicit prerelease installation and WordFlower outline export remain deferred until after MVP.

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
