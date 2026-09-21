# DEVENV-SUBAGENT-SHELL-CANNOT-START-A-STUDIO-SMOKE-LANE — A subagent's unsandboxed shell fails the Watchman preflight the orchestrator's shell passes

- **Status:** Candidate
- **Section:** External
- **Area:** Studio smoke lanes, delegation, sandbox
- **Impact:** A subagent told to prove a Studio fix in the browser cannot, so the smoke loop falls
  back to the orchestrating session and the delegation saves nothing. The subagent in question spent
  about seven minutes establishing that before it reported.
- **Evidence:** On 2026-09-21 in `feat/prioritize-post-hygiene-work-d3876a`,
  `./agent studio-smoke packages/dev/studio-smoke/studio-network-simulation.test.ts <run-id>` run by
  a standard-tier implementer subagent with the sandbox disabled failed before Chrome started with
  `HostEnvironmentError: …pinned Watchman is blocked from its macOS LaunchAgent by the current task`,
  raised by the Metro preflight in Studio's dev tooling (`StudioDev.ts` at the time, now under
  `packages/ides/studio-tooling/studio-tooling-src/`). The same command with the sandbox disabled
  ran 33 times from the orchestrating session the same afternoon, and an earlier implementer
  subagent in the same session ran it successfully more than ten times. Measured: the failure and
  the successes. Inferred: that the difference is the task context the later subagent's shell ran
  under, since nothing else about the command differed.
- **Workaround:** Have the subagent write the fix and its unit tests, and run the smoke loop from the
  orchestrating session.
- **Proposed change:** Make the preflight say which launch context it found and what would satisfy
  it, and establish why one subagent shell reaches the Watchman LaunchAgent and another does not. If
  the difference is inherent to how a harness spawns subagents, say so in the `delegation` skill so a
  brief never asks a subagent for a smoke lane it cannot start.
- **Dependencies:** None known.
- **Acceptance:** A subagent shell either starts a Studio smoke lane, or is refused by a message that
  names the cause and the session that can run it, and the `delegation` skill records which.
- **Source:** 2026-09-21 feature-slice session, empty Studio preview cell fix.
