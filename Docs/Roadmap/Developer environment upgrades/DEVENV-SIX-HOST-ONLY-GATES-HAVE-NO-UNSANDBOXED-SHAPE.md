# DEVENV-SIX-HOST-ONLY-GATES-HAVE-NO-UNSANDBOXED-SHAPE — Six host-only gates have no unsandboxed shape

- **Status:** Candidate
- **Section:** External
- **Area:** Permissions
- **Impact:** The landing route's local complement names nine host-only gates, each to be run as
  `./agent unsandboxed <gate>`. Six of them are not admitted by the wrapper, so an agent landing a
  feature branch can prove only `studio-smoke`, `studio-proof-real-app` and `studio-canary` locally
  and has to hand the other six to the Developer or leave them unproved.
- **Evidence:** 2026-10-06, landing `feat/verification-timing-weights`: `./agent unsandboxed
  studio-smoke-simulated-user`, `keyboard-navigation-smoke`, `studio-dialog-browser`,
  `studio-agent-browser`, `studio-network-simulation` and `studio-smoke-native` each exit 2 with
  `<gate> is not in agentHostCommands in .rulesync/permissions.jsonc`. The `Justfile` has a recipe
  for every one of them and `VERIFY_FULL_GATES` lists them; hosted `Verify` skips them with
  `--skip-unsandboxed`, so nothing proves them on the route as written.
- **Workaround:** The Developer runs the six from a terminal (`just <gate>`), or an authorized
  `./agent unsandboxed verify-full` runs them along with everything CI already proved.
- **Proposed change:** Add the six recipe names to `agentHostCommands` in
  `.rulesync/permissions.jsonc`, or add one named `host-gates` operation that runs exactly the
  catalog's `requiresUnsandboxed` and `requiresMacOS` gates, so the complement is one command and
  the list cannot drift from the catalog. Either is a change to what `unsandboxed` may run and
  needs the Developer's approval.
- **Acceptance:** Every gate the hosted-verification reference lists as the local complement runs
  through `./agent unsandboxed`, or the reference names the one operation that runs them all.
- **Source:** 2026-10-06 verification-speed slice A landing.
