# DEVENV-ACCOUNT-TEST-READS-PARTIAL-READINESS-JSON — Account test reads partial readiness JSON

- **Status:** Candidate
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
- **Workaround:** Rerun the affected file, then complete the required broad verification. A passing
  retry does not fix the readiness race.
- **Proposed change:** Publish readiness only after the entire JSON payload is available, using the
  shared atomic publication mechanism or an explicit complete-message channel.
- **Dependencies:** None.
- **Acceptance:** A deterministic regression delays publication and proves the parent cannot observe
  partial JSON; cross-process account tests also pass in repeated broad lanes.
- **Source:** Native binding package extraction verification, 2026-09-26.
