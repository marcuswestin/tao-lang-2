# DEVENV-044 — Typecheck gate runs 19 projects serially on the legacy compiler

- **Status:** Resolved
- **Area:** Verification performance
- **Impact:** `_typecheck` is the longest verify gate after `_test` (27.7s in the latest lane, 17.2s
  uncontended) although the work parallelizes and a native compiler is released.
- **Evidence:** 2026-09-04, linked worktree, after `_parser-gen`: `bunx tsc --build packages/*/tsconfig.json`
  17.2s wall (24.7s CPU); one `tsc -p --noEmit` per package concurrently 5.8s wall; `tsgo -p --noEmit`
  (`@typescript/native-preview` 7.0.0-dev) concurrently 1.3s wall, exit 0 and zero diagnostics for all
  19 projects. TypeScript 7.0.2 is npm `latest`; `rg` finds no `typescript` API import under `packages/`;
  every project already sets `rootDir`, `types`, and `moduleResolution: bundler`.
- **Workaround:** None; the gate is correct, only serial.
- **Proposed change:** Install TypeScript 7 under the `typescript-native` npm alias and run
  `_typecheck` and the runtime-toolchain generated-app typecheck through it, leaving `typescript` 5.9
  in place for the editor's tsserver and `bunx tsc`. Done on `feat/dev-speed-optimization-cbf7e5`:
  `just _typecheck` 1.7s uncontended; TypeScript 7 also passes the generated runtime app with the
  test's exact tsconfig.
- **Dependencies:** TypeScript 7 ships no programmatic API until 7.1, so `typescript` cannot move to 7
  while `.vscode/settings.json` points the editor at `node_modules/typescript/lib`; revisit when 7.1
  ships and fold the alias back into one dependency.
- **Acceptance:** `./agent verify` green with `_typecheck` under 5s uncontended; `just check` membership
  unchanged. Met 2026-09-04: `_typecheck` 2.2s inside a green, contended `verify` (33.9s lane).
- **Source:** 2026-09-04 development-speed review.
