# DEVENV-PROCESS-GROUP-PROBE-REJECTS-PS-SNAPSHOT — Process group probe rejects the system process snapshot

- **Status:** Candidate
- **Section:** External
- **Area:** Host process provenance and resource inspection
- **Impact:** The named process-group probe cannot establish descendant closure for retained
  process receipts. An absent recorded PID does not resolve the resource's unverified provenance.
- **Evidence:** On 2026-10-06, after the scenario QA batch and local verification finished,
  `./agent unsandboxed resources --json` retained unverified receipts in this checkout. Named
  `processes started` probes for PIDs 1917, 29340, 72350 and 37872 returned no start time.
  Independent `./agent unsandboxed processes group` probes for the same IDs all exited 1 with
  `FAIL  processes group received a malformed ps row.` The rejection originates in
  `packages/cli/agent-cli/agent-cli-src/cli/agent-host-dispatch.ts`; the failing row and root cause
  were not established. No uncertain process was stopped.
- **Workaround:** Preserve unverified receipts and resources. Individual PID absence is useful
  evidence but does not prove the state of descendants.
- **Proposed change:** Diagnose the rejected row using bounded, sanitized evidence and repair the
  process-snapshot parsing or platform contract at its owning boundary. Preserve numeric identity
  validation and the prohibition on cleanup without proven ownership.
- **Dependencies:** Approval for any intentional change to the named host operation's accepted
  behavior or reach.
- **Acceptance:** A regression reproduces the actual rejected row, malformed identity columns
  remain rejected, and the named probe reports a live owned group and an absent group correctly.
- **Source:** Final resource inspection on `feat/scenario-qa-discovery` at `55250e781`.
