# DEVENV-APP-SIDECAR-TYPECHECK-ASSUMES-GENERATED-METADATA — App sidecar typecheck assumes generated metadata

- **Status:** Resolved
- **Section:** External
- **Area:** Test fixture setup
- **Impact:** A clean worktree's app-module integration test cannot resolve Native Bridge Tao imports
  until some earlier command happens to compile that app. Test order can hide the missing precondition.
- **Evidence:** On `feat/test-responsibility`, `verify-changed` failed with TS2307 for Clipboard and
  Haptics `Generated/Bindings.ts` importing `./Bindings.tao`. The same exact file failed alone.
  `./agent tao compile 'Apps/Test Apps/Native Bridge/App.tao'` generated ignored `Bindings.tao.ts`
  metadata without tracked changes; the focused file then passed. Logs:
  `.artifacts/logs/verify-changed/2026-10-01T18-40-16-504Z-43159-ee057e44/cli_tao-cli_3.log` and
  `.artifacts/logs/dev-test/2026-10-01T18-45-03-249Z-79512-e9f6a9b5/cli_tao-cli.log`.
- **Workaround:** Compile the maintained Native Bridge app before the sidecar typecheck.
- **Proposed change:** Make the integration test establish its generated-metadata precondition with
  the existing compile helper, then retain its real TypeScript check. Capture routine setup output.
- **Dependencies:** None; no dependency pins or generated-source formats need to change.
- **Acceptance:** With the task-created Native Bridge metadata absent, the focused integration test
  regenerates it and passes without a prior app compile; ordinary sidecar type failures still fail.
- **Resolution:** The test now compiles the maintained app into a test-owned runtime directory,
  captures setup output, and removes that directory in `finally`. With Clipboard, Haptics, and
  Vibration metadata absent, the focused file recreated all three and passed 6/6 on this branch.
- **Source:** 2026-10-01 test responsibility audit and fail-fast verification implementation.
- **Archived:** 2026-10-01
