# DEVENV-CLOSED-STDIN-PIPE-TEST-FLAKES-UNDER-LOAD — The closed-stdin-pipe test fails `verify-changed` under load

- **Status:** Candidate
- **Section:** External
- **Area:** `packages/shared` process output, `verify-changed`.
- **Impact:** A per-commit gate fails on a change that never touched `packages/shared`, and the rerun costs a full lane.
- **Evidence:** On 2026-09-29, `verify-changed` failed `process output ownership > handles a closed stdin pipe without crashing the parent` with `EPIPE: broken pipe, write` thrown from `sink.write(chunk)` at `packages/shared/shared-src/Platform.ts:280`, reached through `CLI.ts:351`, while load peaked near 48 on 18 CPUs. The same file passed 8 of 8 when run alone a minute later, and the previous `verify-changed` on this branch passed it.
- **Workaround:** Rerun the file with `./agent test packages/shared/shared-tests/process-output.test.ts`, then rerun the lane.
- **Proposed change:** Have the stdin `Writable` in `Platform.ts` treat `EPIPE` from a sink whose child already closed stdin as the documented closed-pipe outcome, rather than depending on which of exit and write lands first.
- **Dependencies:** None.
- **Acceptance:** The test passes across repeated runs under a concurrent `verify` load.
- **Source:** Studio preview latency, `feat/studio-preview-latency-next`, 2026-09-29.
