# Plan - Repository foundations

## Goal

Land the package and language-service seams that tranche 4 will otherwise have to create while it is
changing the same files. Preserve Tao source behavior and the generated `@runtime/TR` contract while
removing unused developer automation and recording a pre-tranche performance baseline.

Baseline at `6cfd88be`: 14 suites, 782 tests, 11.0s observed wall and 36.4s suite-sum in this worktree.
Implementation branch: `feat/repository-foundations`.

## Non-goals and decisions

- Do not build the separate CI enforcement gate or source-position diagnostic CLI.
- Do not assign broad validator diagnostic codes. The five live codes are quick-fix protocol handles;
  no current suppression, severity, documentation, or telemetry consumer justifies a public identity
  scheme. Revisit it with the IDE-polish contract.
- Do not restructure TR internals beyond what is required to make its package boundary independent.
- Keep generated TypeScript thin and keep its `@runtime/TR` import stable.
- Keep `tao-runtime` private and unversioned until a release task owns its public name, version,
  license payload, distribution format, and external-consumer contract.
- Keep standalone validator/compiler convenience calls fresh. Repeated callers explicitly own a
  reusable session; no hidden process-global language-service state is introduced.
- The dev command removals are intentional user-visible subtraction directed by Ro. Package naming and
  exports are user-visible developer surfaces; preserve compatibility where it does not preserve the
  old dependency leak.

## Slices

1. **Repository workflow and parallel delivery.** Fold in the verified Git-workflow skill, add a
   reusable parallel-implementation skill, and make `./agent` bootstrap a missing linked-worktree
   devenv profile from the primary checkout when possible. Keep Worktrunk's blocking setup as the
   normal path and print a precise fallback when no pinned profile exists. Use linked-worktree-only
   Bun copyfile installs and portable kernel-managed zsh locks.
2. **Developer package subtraction and ownership.** Delete AI review, usage accounting, artifacts,
   merge preflight, and their tests/help. Retain repo lint. Reorganize the survivors into agent CLI,
   repository test-running, and Expo dev-loop concerns; remove stale dependencies and state the two
   binary boundaries.
3. **Runtime package boundary.** Keep `tao-runtime` as an independently packageable but private
   generated-code runtime with no toolchain imports. Move app generation, Expo/Jest scaffolding, and
   runtime integration tests into a private toolchain package. Move Tao stdlib sources into their own
   package and resolve its root from that package, with an explicit override, rather than from the Git
   repository root. Validate the source payload by staging temporary release metadata for Bun's pack
   dry run; the checked-in manifest remains private and unversioned.
4. **Reusable language sessions.** Keep explicit caller-owned validator/compiler sessions with safe
   serialization and recovery after failures. Keep standalone one-shot calls fresh, and leave the
   workspace/LSP-owned lifetime unchanged.
5. **Measurement.** Add a repeatable harness for cold and warm parse, validate, compile, and format
   file workflows through the product-facing Workspace and Formatter APIs. Record fixture size,
   iterations, environment, and median/tail timings without adding a CI budget or enforcement gate.
   Recorded result: `Performance baseline.md`.
6. **Integration.** Reconcile package aliases, manifests, lockfile, Just recipes, generated-app paths,
   command help, and active roadmap state. Search for every removed path and command before closure.

## Validation and commits

- Run focused tests and type checks at each ownership boundary.
- Review package dependency direction, package manifests, session concurrency, command removals, and
  bootstrap failure behavior independently.
- Run `./agent verify` before each stabilized implementation commit and at branch completion. Prefer a
  green cross-workstream checkpoint over delaying parallel progress for perfect commit granularity.
- Exit only with the performance numbers recorded, all discovered suites green, no stale active references,
  and a clean named feature branch.

## Implementation result

The feature branch implementation is complete and committed. Final verification found 15 suites and
passed all 755 discovered tests; the separate benchmark-tool check passed its four tests. Independent
review removed unused process-global language sessions, redirected the performance baseline to actual
Workspace/file workflows, kept `tao-runtime` private pending a release contract, gated Bun's copyfile
backend to linked worktrees, and replaced the BSD-only bootstrap lock. The cleanup spike had already
completed the questioned validator traversal and oversized-test work before this branch. The remaining
action is to merge the verified branch into `main` before tranche 4 begins.
