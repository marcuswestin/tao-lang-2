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
  Runtime-Jest, the CLI tutorial test, and a Tao datasource journey passed after relocation;
  a complete managed `./agent verify` passed. A focused worker test
  proved that a rename denial now reports its operation and paths as a host failure.
- **Workaround:** No longer needed for Tao test run roots.
- **Proposed change:** Done: the default Tao test run root is a stable host-temporary directory
  keyed by runtime package, while explicit fixture roots retain their isolated output path. Jest
  resolves workspace packages from the runtime package's installed links. The checkout clean command
  removes that temp root, and rename permission failures report their operation and paths.
- **Dependencies:** The content-addressed store introduced by `a7a0fc0d`.
- **Acceptance:** `./agent verify` completed in the managed shell on 2026-09-22 with the
  compiled test store active and both Tao app shards passing. The CLI also exercised the
  HNReader, WordFlower, and Native Components journeys directly after moving the store.
- **Source:** Companion Slice 3 integration verification on 2026-09-22.
- **Archived:** 2026-09-22
