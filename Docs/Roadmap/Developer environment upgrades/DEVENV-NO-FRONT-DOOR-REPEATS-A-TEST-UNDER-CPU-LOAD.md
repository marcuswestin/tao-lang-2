# DEVENV-NO-FRONT-DOOR-REPEATS-A-TEST-UNDER-CPU-LOAD — No front door repeats a test under CPU load

- **Status:** Candidate
- **Section:** Deferred
- **Area:** Test commands and flake reproduction
- **Impact:** Reproducing a contention-only flake means hand-built busy-loop shells and raw `bun test --rerun-each`, outside `./agent`; killing the loops by pattern can kill the agent's own shell.
- **Evidence:** On 2026-10-04, `feat/closed-stdin-epipe-race` reproduced the closed-stdin EPIPE flake in `process-output.test.ts` only with 8 `while :; do :; done` shells on 4 CPUs (155/200 failures; 28/200 unloaded). `pkill -f` on the loop pattern exited the calling shell (144).
- **Workaround:** Start the loops as owned background jobs, record their PIDs, and kill by PID.
- **Proposed change:** Add `./agent test-file <path> --repeat N [--load K]` that runs owned CPU burners for the duration, reports failures per repetition, and always reaps its burners.
- **Dependencies:** None.
- **Acceptance:** The command reproduces a deliberately contention-sensitive fixture under `--load`, passes it unloaded, and leaves no burner processes after success, failure, or interrupt.
- **Source:** Closed-stdin EPIPE fix, `feat/closed-stdin-epipe-race`, 2026-10-04.
