# DEVENV-FINALIZE-HIDES-PROGRESS-IN-A-SECOND-LOG — Finalize hides progress in a second log

- **Status:** Candidate
- **Section:** Deferred
- **Area:** Verification lanes and command output
- **Impact:** A long `./agent unsandboxed finalize` shows little live progress on its own output; the step-by-step lane lives in a nested log the agent must locate and tail, so a slow phase looks like a hang.
- **Evidence:** On 2026-10-04, `feat/closed-stdin-epipe-race` ran `finalize`, whose own output named one log while the verification phases were written to a second, nested lane log.
- **Workaround:** Read the nested lane log named in the finalize log.
- **Proposed change:** Have `finalize` relay each nested phase's announce line (name, start, result) to its own output, per the AGENTS.md rule that commands over two seconds print concise steps.
- **Dependencies:** `verification-lanes` owns the lane output contract.
- **Acceptance:** A `finalize` run prints every phase start and result on its own output, and a test pins that relay.
- **Source:** Closed-stdin EPIPE fix, `feat/closed-stdin-epipe-race`, 2026-10-04.
