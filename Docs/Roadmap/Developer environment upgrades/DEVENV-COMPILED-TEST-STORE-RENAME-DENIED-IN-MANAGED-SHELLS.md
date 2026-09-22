# DEVENV-COMPILED-TEST-STORE-RENAME-DENIED-IN-MANAGED-SHELLS — Compiled test store rename is denied in managed shells

- **Status:** Candidate
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
- **Workaround:** Run verification from an independent ordinary host terminal if it permits the
  rename; that path has not yet been proved for this branch.
- **Proposed change:** Keep content-addressed compiled apps, but place or move their generated
  directories through a path the managed verification shell can write, without weakening the
  repository's permissions. Report the original filesystem error instead of reducing it to
  `Something went wrong while compiling Tao tests` when this operation fails.
- **Dependencies:** The content-addressed store introduced by `a7a0fc0d`.
- **Acceptance:** `./agent verify` completes in a managed shell with the compiled test store
  active, and a Tao test compilation failure names the filesystem operation and path involved.
- **Source:** Companion Slice 3 integration verification on 2026-09-22.
