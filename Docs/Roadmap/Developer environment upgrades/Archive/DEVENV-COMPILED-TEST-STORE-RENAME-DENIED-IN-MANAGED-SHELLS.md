# DEVENV-COMPILED-TEST-STORE-RENAME-DENIED-IN-MANAGED-SHELLS — Compiled test store rename is denied in managed shells

- **Status:** Resolved
- **Section:** External
- **Area:** Tao test compiler, generated artifacts, verification
- **Impact:** A full verification can fail most Tao runtime and CLI test cases before execution,
  so an integrated branch cannot be proved in a managed task after the compiled test store lands.
- **Evidence:** On 2026-09-22, after merging `a7a0fc0d` into
  `feat/studio-companion-slice-3`, `./agent verify` failed `runtime-jest` and a CLI tutorial test
  at Tao test app compilation. A focused rerun with temporary local diagnostics showed
  `EPERM: operation not permitted, rename` from a generated
  `packages/apps/expo-host/_gen_tao-app-test/tao-test-plan/run-*/app-*/_gen_tao-app` directory
  into sibling `tao-test-plan/.compiled/<content-hash>`. The same focused command through a reviewed
  host invocation still failed. The temporary diagnostics were reverted and the worktree was clean.
  In `feat/landing-smoke`, even an empty directory created in the managed worktree could not be
  renamed or removed, while the same rename succeeded under the host temp directory. A regression
  test failed on the worktree rename before the fix, then passed with a worktree-keyed temp store.
  Runtime-Jest, the CLI tutorial test, and a Tao datasource journey passed after relocation and
  workspace dependency linking; a complete managed `./agent verify` passed. A focused worker test
  proved that a rename denial now reports its operation and paths as a host failure.
- **Workaround:** None required after the fix.
- **Proposed change:** Implemented: keep content-addressed compiled apps in a stable temp root
  keyed by runtime package path, link the package's `node_modules` for generated imports, and clean
  that root with the checkout. Classify rename permission failures with their operation and paths.
- **Dependencies:** The content-addressed store introduced by `a7a0fc0d`.
- **Acceptance:** `./agent verify` completes in a managed shell with the compiled test store
  active, and a Tao test compilation failure names the filesystem operation and path involved.
- **Source:** Companion Slice 3 integration verification on 2026-09-22.
- **Archived:** 2026-09-22
