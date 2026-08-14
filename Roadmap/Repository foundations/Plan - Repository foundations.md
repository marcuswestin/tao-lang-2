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
- The dev command removals are intentional user-visible subtraction directed by Ro. Package naming and
  exports are user-visible developer surfaces; preserve compatibility where it does not preserve the
  old dependency leak.

## Slices

1. **Repository workflow and parallel delivery.** Fold in the verified Git-workflow skill, add a
   reusable parallel-implementation skill, and make `./agent` bootstrap a missing linked-worktree
   devenv profile from the primary checkout when possible. Keep Worktrunk's blocking setup as the
   normal path and print a precise fallback when no pinned profile exists.
2. **Developer package subtraction and ownership.** Delete AI review, usage accounting, artifacts,
   merge preflight, and their tests/help. Retain repo lint. Reorganize the survivors into agent CLI,
   repository test-running, and Expo dev-loop concerns; remove stale dependencies and state the two
   binary boundaries.
3. **Runtime package boundary.** Keep `tao-runtime` as the publishable generated-code runtime with no
   toolchain imports. Move app generation, Expo/Jest scaffolding, and runtime integration tests into a
   private toolchain package. Move Tao stdlib sources into their own package and resolve its root from
   that package, with an explicit override, rather than from the Git repository root.
4. **Reusable language sessions.** Keep caller-owned validator/compiler sessions, add lazy process-wide
   one-shot sessions, explicit invalidation, failed-initialization retry, and safe serialization. Leave
   the workspace/LSP-owned lifetime unchanged.
5. **Measurement.** Add a repeatable harness for cold and warm parse, validate, compile, and format
   paths. Record fixture size, iterations, environment, and median/tail timings without adding a CI
   budget or enforcement gate. Recorded result: `Performance baseline.md`.
6. **Integration.** Reconcile package aliases, manifests, lockfile, Just recipes, generated-app paths,
   command help, and active roadmap state. Search for every removed path and command before closure.

## Validation and commits

- Run focused tests and type checks at each ownership boundary.
- Review package dependency direction, published manifests, session concurrency, command removals, and
  bootstrap failure behavior independently.
- Run `./agent verify` before each stabilized implementation commit and at branch completion. Prefer a
  green cross-workstream checkpoint over delaying parallel progress for perfect commit granularity.
- Exit only with the performance numbers recorded, 14/14 suites green, no stale active references,
  and a clean named feature branch.
