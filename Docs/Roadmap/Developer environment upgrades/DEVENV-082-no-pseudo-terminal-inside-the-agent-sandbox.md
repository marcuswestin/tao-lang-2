# DEVENV-082 — No pseudo-terminal inside the agent sandbox

- **Status:** Candidate
- **Section:** External
- **Area:** Agent sandbox and workflow output
- **Impact:** Output that only exists on a terminal — the work-graph TUI, prefixed `lines` streaming,
  and now the colored verdict line — cannot be observed from a sandboxed shell at all, because every
  sandboxed command's stdout is a pipe. An agent can assert the plain path and must take the terminal
  path on trust, which is exactly where the escape codes it must not emit elsewhere would show up.
- **Evidence:** `script -q /dev/null ./dev gates _repo-lint --lane verdict-demo --output lines` fails
  with `script: openpty: Operation not permitted`; the identical command in an unsandboxed shell
  allocates the pty and renders `[32mverdict-demo: PASSED in 363ms[0m`.
- **Workaround:** A person can rerun the command from an ordinary terminal. An agent may use only a
  named `./agent unsandboxed` operation; an unlisted terminal probe needs a new approved operation.
- **Proposed change:** Either permit `openpty` in the sandbox policy, or give the work-graph commands
  a way to be told they are addressing a terminal — `resolveMode` already accepts an injected
  `outputIsTerminal`, so an env key beside `TAO_OUTPUT_MODE` would make the colored path reachable
  from a pipe for inspection without loosening the sandbox.
- **Dependencies:** None.
- **Acceptance:** A sandboxed command can produce and capture the terminal rendering of a lane, so
  the colored and plain paths are both provable without an unsandboxed shell.
- **Source:** 2026-09-19 verdict-line and `just clean` reporting work.
