# DEVENV-ACCOUNT-TEST-READS-PARTIAL-READINESS-JSON — Account test reads partial readiness JSON

- **Status:** Resolved
- **Section:** External
- **Area:** Test reliability, account reference server process fixtures
- **Impact:** A broad verification lane can fail in an unchanged account-server test while its
  child process is still publishing its readiness file.
- **Evidence:** On 2026-09-26, `verify-changed` on `feat/native-binding-poc` failed in
  `Local account reference authority > enforces one composite membership and one receipt across separate server processes`.
  `childServer` in `packages/services/account-server/account-server-tests/account-server.test.ts`
  waited for `FS.isFile(ready)` and immediately called `FS.readJson(ready)`, which raised
  `SyntaxError: JSON Parse error: Unexpected EOF`. The child fixture `fixtures/server-process.ts`
  publishes with `FS.writeJson`; file existence does not establish that the write has completed.
  The lane recorded three concurrent Tao lanes and peak load 47.7 on 18 CPUs. The same test file
  passed alone without code changes (1.7 s suite time). Task logs:
  `.artifacts/logs/verify-changed/2026-09-26T17-46-24-564Z-9164-4dacd66b/services_account-server_3.log`
  and `.artifacts/logs/dev-test/2026-09-26T17-48-34-728Z-29229-49a337b3/services_account-server.log`.
  Recurred during integrated shell verification in
  `.artifacts/logs/verify-changed/2026-09-26T22-15-08-627Z-69493-42c92b2c/services_account-server_3.log`.
  Fixed on `feat/native-binding-poc`: both publishers use `publishAccountServerReadiness`, which
  finishes writing a unique sibling before renaming it. A deterministic partial-write regression
  failed with direct publication and passes after the repair; it covers replacement and cleanup
  after write/rename failures. Existing multi-process and real launcher tests also pass.
- **Workaround:** Rerun the affected file, then complete the required broad verification. A passing
  retry does not fix the readiness race.
- **Proposed change:** Publish readiness through the account server's common staged-write and
  atomic-rename helper only after the complete JSON payload is available.
- **Dependencies:** None.
- **Acceptance:** A deterministic regression delays publication and proves the parent cannot observe
  partial JSON; cross-process account tests also pass in repeated broad lanes.
- **Source:** Native binding package extraction verification, 2026-09-26.
- **Archived:** 2026-09-26
