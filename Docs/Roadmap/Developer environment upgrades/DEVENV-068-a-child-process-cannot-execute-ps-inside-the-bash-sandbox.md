# DEVENV-068 — A child process cannot execute `ps` inside the Bash sandbox

- **Status:** Candidate
- **Area:** Sandbox
- **Impact:** Repository code that lists processes through a subprocess sees nothing in a sandboxed lane,
  so a lane cannot find a leftover process it needs to stop, and the code path that would do it cannot
  be exercised there. This was one of the three causes in DEVENV-067.
- **Evidence:** `Platform.spawnSync('ps', { args: ['-axo', 'pid=,ppid=,lstart=,command='] })` returns
  `status: undefined` with `error: EPERM: operation not permitted, posix_spawn 'ps'`, and the same for
  `/bin/ps`, while the identical `ps` invocation typed into the sandboxed shell succeeds: the Seatbelt
  policy denies the exec to the child, not the shape of the command. `AGENTS.md` already blesses that
  exact fixed `ps` shape for an agent to run directly. Consequently `processTable()` in
  `packages/shared/shared-src/ProcessTree.ts` returns an empty list in a sandboxed lane, which makes the
  non-Darwin branch of `descendantProcesses` unusable and untestable there; on Darwin the libproc path
  (`/usr/lib/libproc.dylib` through `bun:ffi`) supplies both child PIDs and process-start identity,
  which is the stronger reason it is primary.
- **Workaround:** Rely on the Darwin libproc path, and run a process-listing probe directly in the shell
  rather than through repository code.
- **Proposed change:** Either allow `/bin/ps` for child processes in `.rulesync/permissions.jsonc`'s
  sandbox policy, or document `processTable` as a non-Darwin-only path so no lane depends on it here.
- **Dependencies:** `.rulesync/permissions.jsonc` owns the sandbox policy. DEVENV-030 and DEVENV-060 own
  the adjacent host process-visibility constraints.
- **Acceptance:** Either a sandboxed lane's `processTable()` returns the real table, or the code and its
  tests state that the non-Darwin branch is out of scope on this host and nothing in a lane relies on it.
- **Source:** 2026-09-17 process-teardown implementation.
