# DEVENV-FULL-HOST-VERIFICATION-LACKS-A-NAMED-OPERATION — Full host verification lacks a named operation

- **Status:** Candidate
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
- **Workaround:** Run `./agent verify-full --no-cache` from an ordinary developer terminal. Listed
  browser smokes provide only their own acceptance evidence.
- **Proposed change:** Decide and authorize a bounded named host verification operation, or a named
  native-smoke/canary pair, with matching help and command-policy coverage.
- **Dependencies:** Explicit approval for any permission-reach change; excluded from the test
  responsibility audit implementation.
- **Acceptance:** A managed task can invoke the approved full/native host lane through its named
  wrapper; existing lane leases, cleanup, failure policy, and evidence boundaries are preserved.
- **Source:** 2026-10-01 test responsibility audit verification.
