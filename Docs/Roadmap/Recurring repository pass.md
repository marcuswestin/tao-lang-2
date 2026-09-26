# Recurring repository pass

This document is the current handoff between repository-wide passes. It records only what the most
recent pass covered, what it did not cover, and what the next pass should consider. Replace those
notes after each completed pass; Git history is the longer record.

## Current status

- **Reviewed through:** `e94c3e1a480a8efaffdf359cf6e3f43f6653c527` on local `main` (2026-09-25). The prior review integrated as `d296b239`; the [September 2026 repository review](<September 2026 repository review.md>) now disposes that landing and the 41 later first-parent landings. Three read-only specialist reviews and an independent challenge checked current behavior. The present pass branch carries two focused repairs; `./agent verify` and finalization passed, while landing remains unauthorized.
- **Outcome:** Query search combined words from separate `(search)` fields, and a stamped installed Expo host reused missing packages. Both have focused before/after regressions and repairs on the pass branch. The Developer deferred explicit prerelease installation and WordFlower outline export choices until after MVP. The original Git-only computer inventory found 16 reclaimable, 15 live, and five unclassified registered worktrees; follow-up found Codex tasks attached to two Git-reclaimable trees. `reclaim` now reports local task links and treats known attachments as live, while unknown provider associations still need an app check. A clean 39.2 GiB worktree contains 31.3 GiB of older host-test artifacts, and two unregistered worktree directories have broken or reused Git pointers. Tao cache roots and OS temp entries have grown; no owner-unknown or active state was deleted. Temporary-state creation and cleanup code was excluded at the Developer's request because another task owns it.
- **Security and host follow-up:** `bun audit` still reports one moderate `uuid` record with no affected caller demonstrated through its installed `xcode` parent; the pinned Nixpkgs patch lags later fixes without a Linux closure. The [dependency advisory follow-up](<Dependency advisory follow-up.md>) retains both owners and the September 28 review date. Real HNReader Studio smoke passed, but the new-emulator exit-log path, packaged installation, signing, distribution, and external-service acceptance were not exercised. Official sources describe Codex cloud's reference Ubuntu-based container and Claude Code cloud's Ubuntu 24.04 x86_64 VM; neither publishes the exact hosted image digest.

## Consider next time

- Start after `e94c3e1a` or a newer first-parent boundary established during landing. Leave the
  explicit-prerelease and WordFlower-outline product choices until after MVP.
  Check the [emulator log repair](<Developer environment upgrades/Archive/DEVENV-EMULATOR-EXIT-LOG-CAN-REPORT-PRIOR-LAUNCH.md>)
  under a real **new** emulator launch when one is available.
- Keep the read-only worktree and computer-file inventory, but leave temporary-state creation and
  cleanup implementation with its current owner. Check Codex, Claude, and Cursor task associations
  before treating a `reclaimable` checkout as disposable; preserve live and owner-unknown roots,
  including the broken-pointer directories, until ownership is established. The
  [open developer-environment index](<Developer environment upgrades.md>) still needs a small,
  owner-aware shortlist; `DEVENV-094` needs a quiet-machine admission experiment and `DEVENV-055`
  its native-host proof.
- Test Claude Code cloud readiness locally in an isolated Ubuntu 24.04 x86_64 environment with a
  fresh checkout, four CPUs, 16 GiB RAM, and a 30 GiB disk. First prove the repository's worktree
  session setup and `./agent setup`; then run portable check, test, and verify workflows. Keep a
  cached toolchain layer and a fresh checkout per run to expose missing per-session setup. Account
  separately for the hosted network proxy, Bun registry behavior, and macOS native lanes that a
  local Linux environment cannot reproduce. The local Docker daemon was unavailable at this pass;
  no container proof was claimed.
- Recheck `uuid`, Appium pins, and Nixpkgs using the
  [advisory register](<Dependency advisory follow-up.md>) and current primary sources. Use host,
  Linux, device, installed-binary, and public-distribution evidence only for the acceptance each
  actually exercises. Include [`bun audit`](https://bun.sh/docs/pm/cli/audit) and inspect any
  `devenv.lock` change against the [Nixpkgs tracker](https://tracker.security.nixos.org/).

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
