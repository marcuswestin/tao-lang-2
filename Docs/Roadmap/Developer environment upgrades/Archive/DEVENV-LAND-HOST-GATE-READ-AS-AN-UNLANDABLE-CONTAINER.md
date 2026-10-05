# DEVENV-LAND-HOST-GATE-READ-AS-AN-UNLANDABLE-CONTAINER — Land host gate read as an unlandable container

- **Status:** Resolved
- **Section:** Deferred
- **Area:** Landing host gate and agent capabilities
- **Impact:** An agent in a hosted Linux container concluded it could never land and handed landing back to the Developer, when the only missing capability was a stopped Watchman it could start itself.
- **Evidence:** On 2026-10-04, `./agent unsandboxed land` on `feat/closed-stdin-epipe-race` refused with "Landing needs a host-capable unsandboxed shell … Do not retry the host gate inside this sandbox." although `./agent capabilities` reported "no sandbox detected". The error named only `Watchman socket` with its probe output, not its remedy, and `./agent capabilities` listed Nix, Docker, CoreSimulator and Hutch as unavailable without saying none of them blocks landing on Linux. `./agent unsandboxed watchman start` alone cleared the gate.
- **Workaround:** Run `./agent capabilities`, apply the remedy of each probe landing requires, and retry.
- **Proposed change:** The land error names each blocking capability with its remedy and mentions a sandbox only when one is detected; `land` starts Watchman itself when it is the only missing capability and probes again; `./agent capabilities` tags each probe as required or not required to land on the host platform.
- **Dependencies:** Settled on `feat/tao-install-offer` (`doctor/LandingHost.ts`, `AgentCapabilitiesCommand.ts`).
- **Acceptance:** `agent-capabilities.test.ts` covers the Watchman start and re-probe, no start when another capability is missing or when the start fails, the sandbox-aware message, and the per-platform tags.
- **Source:** Closed-stdin EPIPE fix landing, `feat/closed-stdin-epipe-race`, 2026-10-04.
- **Archived:** 2026-10-04
