# DEVENV-FULL-HOST-VERIFICATION-LACKS-A-NAMED-OPERATION — Full host verification lacks a named operation

- **Status:** Resolved
- **Section:** External
- **Area:** Agent verification command reach
- **Impact:** A managed shell can run full sandbox verification and listed browser smokes, but cannot
  run the complete host lane or its native smoke/canary without a separate permitted operation.
- **Evidence:** On 2026-10-01, `./agent help` and `.rulesync/permissions.jsonc` list host `studio-smoke`
  and `studio-proof-real-app`, but not `verify-full`, `studio-smoke-native`, or `studio-canary`.
  `HostCommandPolicy` requires a listed token prefix. The listed `studio-smoke` invokes its Justfile
  recipe, which forwards one explicit file and run id without the native flag. `GateCatalog`
  marks both native gates as requiring an unsandboxed shell. This is command/configuration evidence;
  no permission bypass or unlisted host invocation was attempted.
- **Workaround:** None needed: use `./agent unsandboxed verify-full` for the complete host lane.
- **Proposed change:** Implemented on `feat/test-responsibility` with the Developer's 2026-10-04
  approval. Added only `verify-full` to the canonical host list, regenerated both harnesses' rules,
  and updated help and host-skip recovery. Standalone native smoke/canary operations remain unlisted.
- **Dependencies:** Approval supplied on 2026-10-04; no dependency or lockfile changes.
- **Acceptance:** A managed task can invoke the approved full/native host lane through its named
  wrapper; existing lane leases, cleanup, failure policy, and evidence boundaries are preserved.
  The existing host-command policy suite passes all eight tests, accepting `verify-full --no-cache`
  while rejecting unlisted sibling operations and verifying generated per-operation rules. Full
  host verification on the preceding tree passed on 2026-10-03; authorized landing verifies the
  registration change under its lock.
- **Source:** 2026-10-01 test responsibility audit verification.
- **Archived:** 2026-10-04
