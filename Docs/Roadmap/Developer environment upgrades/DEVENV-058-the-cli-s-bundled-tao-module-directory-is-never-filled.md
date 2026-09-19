# DEVENV-058 — The CLI's bundled `@tao/*` module directory is never filled

- **Status:** Candidate
- **Area:** Packaging
- **Impact:** `TaoAppModules.runtimeRoot()` resolves only because `packages/runtime` sits beside
  `packages/tao-cli` in this repository. A CLI copied anywhere else links a created project at
  nothing, so `tao create`'s `tsconfig.json` cannot resolve `@tao/runtime` and every sidecar import
  fails to typecheck.
- **Evidence:** 2026-09-12, `packages/tao-cli/modules/@tao/` holds only `.gitkeep`, and no `Justfile`
  recipe or `./dev` command copies the runtime into it. `runtimeRoot` falls through to
  `Errors.throwHostEnvironment` in that case.
- **Workaround:** Run the CLI from the monorepo, which is the only supported way to run it today.
- **Proposed change:** A packaging step that copies `packages/runtime` (and any other `@tao/*`
  TypeScript module a created project imports) into `packages/tao-cli/modules/@tao/` as real
  directories, alongside whatever recipe builds a distributable CLI. Note DEVENV-057: a directory
  symlink there breaks `GreenTree.hashTree`, so the step has to copy rather than link.
- **Dependencies:** DEVENV-057.
- **Acceptance:** A CLI tree with no sibling `packages/runtime` resolves `@tao/runtime` from its own
  carried module and links a created project at it; `cli-tests/app-modules.test.ts` already covers
  both halves of that fallback against a synthetic tree.
- **Source:** 2026-09-12 review of the `@tao/runtime` CLI module wiring.
