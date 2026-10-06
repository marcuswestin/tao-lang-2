# DEVENV-068 — A child process cannot execute `ps` inside the Bash sandbox

- **Status:** Candidate
- **Section:** External
- **Area:** Sandbox
- **Impact:** Repository code that lists processes through a subprocess sees nothing in a sandboxed lane,
  so a lane cannot find a leftover process it needs to stop, and the code path that would do it cannot
  be exercised there. This was one of the three causes in DEVENV-067.
- **Evidence:** `Platform.spawnSync('ps', { args: ['-axo', 'pid=,ppid=,lstart=,command='] })` returns
  `status: undefined` with `error: EPERM: operation not permitted, posix_spawn 'ps'`, and the same for
  `/bin/ps`, while the identical `ps` invocation typed into the sandboxed shell succeeds: the Seatbelt
  policy denies the exec to the child, not the shape of the command. At the time, `AGENTS.md` allowed
  that fixed `ps` shape directly; agents now use `./agent unsandboxed processes list`. Consequently `processTable()` in
  `packages/shared/shared-src/ProcessTree.ts` returns an empty list in a sandboxed lane, which makes the
  non-Darwin branch of `descendantProcesses` unusable and untestable there; on Darwin the libproc path
  (`/usr/lib/libproc.dylib` through `bun:ffi`) supplies both child PIDs and process-start identity,
  which is the stronger reason it is primary.
- **Workaround:** Rely on the Darwin libproc path; an agent can inspect the host process table with
  `./agent unsandboxed processes list` instead of invoking `ps` directly.
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
  count) and never suppress its stderr before trusting silence. The current named process probe
  performs the whole-table command on the host. This does **not** apply to the
  landing lock: that lock is held by a worktree and is deliberately never liveness-checked, and
  scoped holds use `Platform.processIsAlive` rather than a `ps` subprocess — see `DEVENV-114`.
- **Dependencies:** `.rulesync/permissions.jsonc` owns the sandbox policy. DEVENV-030 and DEVENV-060 own
  the adjacent host process-visibility constraints.
- **Related observation (2026-10-05):** An isolated `verify-full` host run on
  `feat/native-photos-files` failed `ProcessTree.stopTree` while checking an already-signalled
  process group: `Platform.signalProcess(-pid, 0)` reported `EPERM`. The unchanged focused
  process-supervision suite subsequently passed all 15 tests; the next full run passed the shared
  suite too. These results do not establish the intermittent denial's cause. Retain the failure
  rather than interpreting denied inspection as successful cleanup. The failed run is
  `2026-10-05T10-50-49-443Z-16725-33770580`; its shared log identifies the exact teardown.
  A source audit found a separate error-versus-empty risk in the Darwin enumeration path:
  Apple's [`proc_listpids` wrapper](https://github.com/apple-oss-distributions/xnu/blob/main/libsyscall/wrappers/libproc/libproc.c)
  returns zero on syscall failure, while `ProcessTreeDarwin` rejects only negative results.
  Before replacing group signal-zero probes with enumeration, prove that zero means an empty
  group rather than a failed inspection. A native wrapper that resets and captures thread-local
  errno immediately around the libproc call is the recommended investigation; separate JavaScript
  FFI calls have no documented saved-errno guarantee. Preserve zombie identities, uncertain-identity
  errors and bundled Node-helper behavior. No fallback, permission change or inspection weakening
  was introduced in the native bridge work.
- **Related observation (2026-10-06):** `feat/test-process-termination` stopped `verify-changed` at five
  `project-dev-session.test.ts` assertions expecting a version-2 identity record and receiving version 1.
  The unchanged focused file reproduced all five failures. `ProjectDevSession.acquire` still uses
  `ProcessTree.processTable`, whose Darwin implementation launches `ps`; a direct bounded probe was
  denied with `operation not permitted: ps`. The named host capability probe reported process-table
  access available. Retain this as a sandbox verification limitation, not proof of successful full
  verification or a reason to weaken identity inspection. Logs:
  `.artifacts/logs/verify-changed/2026-10-06T17-35-43-839Z-65220-22a913f9/shared_4.log`,
  `.artifacts/logs/agent/test-file/2026-10-06T17-36-14-969Z-71871.log`, and
  `.artifacts/logs/agent/capabilities/2026-10-06T17-41-04-678Z-32576.log`.
  The session acquisition dependency is now removed: the shared runtime exposes the current
  parent PID, and acquisition reads both exact kernel identities directly. The focused file
  passes all nine cases, including a denied process-table fixture and the existing orphan
  confirmation, PID-reuse and refusal checks. This preserves the conservative legacy fallback
  when exact identity inspection fails. Log:
  `.artifacts/logs/agent/test-file/2026-10-06T18-15-41-071Z-2831.log`.
  This fixes one repository dependency; it does not establish general subprocess or signal access.
  The same session could inspect the start identity of its failed wrapper, but an exact-PID
  `Platform.signalProcess(pid, 'SIGTERM')` returned `kill() failed: EPERM: Operation not permitted`.
  Its test children were independently absent; stopping that wrapper required the Developer's
  terminal. Do not interpret failed signalling as completed cleanup.
- **Acceptance:** Either a sandboxed lane's `processTable()` returns the real table, or the code and its
  tests state that the non-Darwin branch is out of scope on this host and nothing in a lane relies on it.
- **Source:** 2026-09-17 process-teardown implementation.
