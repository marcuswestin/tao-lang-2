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
- **Since recorded (2026-09-19):** the second half is done and the cost of not doing it was measured.
  `StudioDeviceTrustStore` judged a lock owner's liveness by shelling out to `ps -o lstart= -p <pid>`;
  the denial sent it down a fallback that kept working and silently dropped the start-time comparison
  protecting against a reused PID. It reads `ProcessTree` now, and `environment-recovery` states that
  repository code reads process facts that way rather than through `ps`. The per-PID `ps` shape is
  allowed for direct diagnostic use, which does not address this entry: the denial here is on the
  exec of `ps` by a child process, not on the shape of the command.
- **Correction (2026-09-19):** the direct shell `ps` is **not** reliably allowed either, which the
  evidence above assumes and which `AGENTS.md` depends on. During one landing session the blessed
  fixed shape `ps -axo pid=,ppid=,lstart=,command=` returned `operation not permitted: ps` in the
  agent's own shell, and `ps -p <pid>` did the same, while the identical commands had succeeded
  minutes earlier in that session and succeeded again when re-run unsandboxed. The denial is
  intermittent rather than a stable child-versus-shell property. The hazard is that the common
  spelling `ps … 2>/dev/null | rg <pid>` renders a denial as empty output — byte-identical to "that
  process is gone" — so an agent judging a lock owner's liveness can conclude the opposite of the
  truth. Until this is fixed, prove the tool works (`ps -axo pid= | wc -l` returning a plausible
  count) and never suppress its stderr before trusting silence. This does **not** apply to the
  landing lock: that lock is held by a worktree and is deliberately never liveness-checked, and
  scoped holds use `Platform.processIsAlive` rather than a `ps` subprocess — see `DEVENV-114`.
- **Dependencies:** `.rulesync/permissions.jsonc` owns the sandbox policy. DEVENV-030 and DEVENV-060 own
  the adjacent host process-visibility constraints.
- **Acceptance:** Either a sandboxed lane's `processTable()` returns the real table, or the code and its
  tests state that the non-Darwin branch is out of scope on this host and nothing in a lane relies on it.
- **Source:** 2026-09-17 process-teardown implementation.
