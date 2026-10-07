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
- **Host inspection follow-up (2026-10-06):** A passing Studio launch smoke test in
  `.artifacts/logs/verify-complement/2026-10-06T19-25-40-697Z-77059-d294c94c/studio-smoke.log`
  failed its outer cleanup inspection. The native descendant query returned zero bytes for an
  enumerated PID while its liveness probe succeeded. Bounded error details now preserve the
  inspection kind, requested owner, failing PID, returned size, backend and probe status.
  The wrapper returned failure promptly and stopped its known children; this does not establish
  the native failure's cause. The inspector now rechecks an incomplete enumerated identity up to
  three times and validates its parent relationship before accepting a descendant. Persistent
  unreadability, denied liveness probes and changed ownership still fail inspection. Focused
  fixtures cover transient reads, permanent failures, exact identities and the shared helper
  failure envelope; current host acceptance remains required.
- **Identity and retry follow-up (2026-10-06):** The next Studio complement again passed the inner
  launch test but failed cleanup with `identity-unreadable`, zero returned bytes and `probeStatus: live`:
  `.artifacts/logs/verify-complement/2026-10-06T19-42-16-038Z-70048-2c40ccd5/studio-smoke.log`.
  Three immediate native retries did not establish an exact identity. Retries now yield five
  milliseconds between incomplete reads, for at most ten milliseconds on enumeration and fifteen
  on a direct query. This is a bounded race mitigation, not a diagnosis of the original failure.
  Direct identity queries also verify a zombie-aware record or an `ESRCH` result before returning
  absence; unreadable live records can no longer bypass exact-identity joins. Confirmed zombies
  still count as stopped for direct queries, while enumeration retains their identities. The
  focused native fixture suite passes 41 cases, including permanent uncertainty and the shared
  helper envelope. Final host acceptance remains unproved.
- **Related observation (2026-10-06):** On `feat/tutorial-first-hour` at `eb1c7f95a`, sandboxed
  `verify-changed` stopped at five `project-dev-session.test.ts` assertions: `markParentReused`
  expected owner record version 2 but received 1. The unchanged focused test reproduced all five
  failures. At that head, `ProjectDevSession.acquire` obtained its parent through `ProcessTree.processTable()`;
  that Darwin path invoked `ps` and threw on unsuccessful inspection, which `acquire`
  catches before safely falling back to a v1 record. The denied-table cause is inferred from this
  path and the existing finding; these runs did not retain the swallowed inspection error. Logs:
  `.artifacts/logs/verify-changed/2026-10-06T17-20-10-490Z-11437-d3570906/shared_4.log` and
  `.artifacts/logs/dev-test/2026-10-06T17-21-07-315Z-26657-543be1e4/shared.log`.
  The broad lane skipped 555 checks after this failure. No permissions or ownership policy changed.
- **Acceptance:** Either a sandboxed lane's `processTable()` returns the real table, or the code and its
  tests state that the non-Darwin branch is out of scope on this host and nothing in a lane relies on it.
- **Reviewed recovery (2026-10-06):** After explicit approval, a fresh start-time probe matched the
  task's old wrapper, but sandboxed TERM still returned `operation not permitted`. The new named
  `processes stop` host operation requires the exact kernel start identity and an isolated process
  group with no children; it refuses changed identity, uncertain inspection and other group members.
  TERM precedes KILL, with a fixed wait budget and final group-absence check. That operation stopped
  the reviewed wrapper and its pending tool session returned. This adds a guarded recovery path,
  rather than establishing general sandbox signal access. A reparented full-record zombie also no
  longer triggers a live parent-change error; exact identities remain recorded and live mismatches
  still fail. The focused native suite passes 42 cases; mutation tests reject removal of the zombie
  exception and PID-reuse guard. The native transient-read failures still need host acceptance.
- **Polling and group-join follow-up (2026-10-06):** Repeated ownership polls were synchronously
  retrying already exited retained PIDs and recursively rewalking attached subtrees. A direct
  incomplete read now returns immediately only when `ESRCH` proves absence; live and denied
  observations retain the fixed retries and failure envelope. Ordinary polls walk attached trees
  once, while cancellation and escalation still rewalk live retained owners for late forks.
  Darwin group joins also inspect full kernel records after a successful signal probe, so an
  unreaped zombie-only group does not keep a wrapper pending. Unreadable live members still fail.
  Deterministic work-count, escaped-child, cancellation, zombie-only group and denied-read fixtures
  cover these paths, with mutations rejecting removal of the early-absence and final-owner checks.
  Complete final host verification remains required.
- **Final review follow-up (2026-10-06):** An empty native group enumeration after a successful
  signal probe is rechecked. Only `ESRCH` establishes absence; a still-signalable group or denied
  probe reports the group, native routine, returned bytes and probe status. The fully identified
  zombie-only case requires two matching observations of exact identities. A second enumeration
  also discovers children forked after their listed parent exited. Deterministic live, denied,
  absent, late-fork and changed-zombie fixtures cover those races.
- **Retained host evidence (2026-10-06):** The final-source complement under concurrent iteration
  failed after the launch assertions passed: `proc_pidinfo` returned zero bytes for a PID whose
  signal probe still succeeded. The report preserved the PID, native routine and live probe status,
  and the wrapper stopped survivors before returning. The same unchanged launch check then passed
  separately in 49.7 seconds; direct native audits found both run roots, the reported PID and groups
  absent. This does not establish why the first observation was unreadable. Its log remains at
  `.artifacts/logs/verify-complement/2026-10-06T21-36-44-146Z-52210-94cdcad6/studio-smoke.log`.
  Complete host proof must be renewed after integrating main.
- **Personal-branch landing observation (2026-10-07):** At `9eaf7923393f`, the authorized local
  landing passed its cheap checks but `verify-full` stopped after the receipt-inputs test passed
  its assertions. Descendant inspection returned zero bytes from `proc_pidinfo` for PID 35334,
  while the signal probe reported it live; root PID 33894 was the requested owner. Log:
  `.artifacts/logs/verify-full/2026-10-07T16-51-51-588Z-19444-1faa93f1/language_project-tooling_receipt-inputs.log`.
  The unchanged exact test then passed in isolation, including wrapper cleanup, in 9.2 seconds:
  `.artifacts/logs/dev-test/2026-10-07T16-54-52-379Z-35576-fd26f194/language_project-tooling_receipt-inputs.log`.
  This does not establish the cause of the native unreadability or replace complete landing proof.
  The next full landing attempt at `d4107b6c9` failed the same inspection in a different suite:
  `ProjectConcurrentWriters.integration.test.ts` passed all assertions before PID 61075 returned
  zero bytes while still signalable (requested root PID 60660). Log:
  `.artifacts/logs/verify-full/2026-10-07T16-56-27-873Z-37159-6ed6d689/language_project-tooling_1.log`.
  That unchanged exact test passed in isolation in 5.8 seconds:
  `.artifacts/logs/dev-test/2026-10-07T17-01-05-320Z-62074-a2d5bddb/language_project-tooling.log`.
  Later exact-PID probes found both reported PIDs absent and root 60660's group empty. Those
  observations do not retroactively prove that the failed inspection observed safe ownership.
  With the Developer's approval to diagnose and fix this blocker, failed `proc_pidinfo` reads now
  retain the immediate native errno in the bounded diagnostic envelope; successful liveness alone
  still cannot establish identity or safe cleanup. The 54 inspector fixtures pass, including native
  errno propagation through the shared failure envelope. Two bounded live child-exit probes did not
  reproduce the failure (62 Bun-parent reads and 523 Node-parent reads, zero failures); this does not
  establish its cause. The next complete landing run collects the missing native error if it recurs.
- **Denied identity follow-up (2026-10-07):** The next full landing run captured native `EPERM`
  after all 1,193 CLI assertions passed: PID 96340 returned zero full BSD record bytes while its
  signal probe succeeded (root 83565). Log:
  `.artifacts/logs/verify-full/2026-10-07T17-10-16-339Z-66710-6851a228/cli_dev-cli.log`.
  The unchanged CLI suite and wrapper passed separately in 125.6 seconds. The denial's precise
  policy and the target's status at that observation remain unproved. Apple exempts the shorter
  BSD record from the full record's same-user check. After an `EPERM`, a complete short record
  matching the requested PID and `SZOMB` now permits omitting that finished process without
  granting identity or signal authority. Live, partial, mismatched and denied short records still
  fail; process-group joins retain their full exact-identity and two-snapshot proof. Deterministic
  fixtures cover those boundaries, and removing the zombie-status guard makes the live-record
  refusal regression fail. Complete landing verification remains the final acceptance gate.
- **Source:** 2026-09-17 process-teardown implementation.
