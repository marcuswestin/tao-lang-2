# DEVENV-STUDIO-STOP-MISSING-FROM-HOST-COMMANDS — An approved Studio stop has no host command

- **Status:** Resolved
- **Area:** Studio lifecycle, host command front door
- **Impact:** A live Studio session can block landing's launch smoke, but the task cannot stop that
  session through the supported command front door even after explicit Developer authorization.
- **Evidence:** On 2026-09-26, landing `feat/studio-space-drag-pan` failed because the HNReader project
  was owned by Studio PID 96366. After approval to stop it, `kill -TERM 96366` returned
  `operation not permitted` in the managed shell. `./agent help` exposed process inspection but no
  Studio stop operation. The Developer stopped the session in their terminal; the next landing passed.
  Branch `feat/studio-canvas-navigation` adds bounded `studio-ps` and `studio-stop` host operations.
  Subprocess tests prove selector forwarding, rejection before dispatch, and lifecycle failure exit
  propagation; lifecycle regressions cover owned-process draining, PID reuse, escalation and ambiguous
  selection. The Developer regenerated protected permissions with `./agent setup`; exact configuration
  parity passes. The existing task retains its startup permission set, so live host invocation awaits a
  fresh task; no Developer launch was stopped to validate this change.
- **Workaround:** Start a fresh task to load newly generated host command rules.
- **Proposed change:** Implemented `./agent unsandboxed studio-ps [--json]` and
  `./agent unsandboxed studio-stop [--launch <id> | --all] [--json]`, with bounded argument validation
  before dispatch to the existing ownership-aware lifecycle. Stopping a Developer session still needs
  explicit authorization.
- **Dependencies:** The process-ownership lifecycle described by archived DEVENV-016.
- **Acceptance:** An explicitly authorized stop targets an identified launch, refuses stale identity,
  drains its owned processes, and allows a blocked launch smoke to proceed without manual intervention.
- **Source:** Studio gesture task, landing log `2026-09-26T17-26-28-768Z-36780.log` and successful retry
  `2026-09-26T17-36-42-835Z-89334.log` under `.artifacts/logs/agent/land/`.
- **Archived:** 2026-09-26
