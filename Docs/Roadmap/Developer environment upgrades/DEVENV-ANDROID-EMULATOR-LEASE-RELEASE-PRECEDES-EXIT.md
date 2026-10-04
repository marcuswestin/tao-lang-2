# DEVENV-ANDROID-EMULATOR-LEASE-RELEASE-PRECEDES-EXIT — Android emulator lease release precedes confirmed exit

- **Status:** Candidate
- **Section:** External
- **Area:** Owned Android emulator cleanup in `app-dev`.
- **Impact:** A failed stop or startup may leave an emulator running after its resource leases become
  available to another development session. An abrupt parent cancellation reproduced a live orphan
  on 2026-10-01 before durable startup ownership was implemented.
- **Evidence:** Decided 2026-10-04: remaining host acceptance and recovery work is deferred until
  post-MVP; completed source changes are being committed and landed with ordinary verification.
  Keep this entry open and preserve retained ownership. An absent process never substitutes for
  missing descendant or shutdown proof. The execution handoff owns the safe resume sequence.
  Final pause preparation emulator34, Controller46 and Faults80 pass, with independent rereview
  clear and integrated check8/0/0 including typecheck. Borrowing17/recovery22 also pass. Producer
  refresh/death admission and fence-aware borrowing are implemented; their new host cases remain
  deferred. The retained sentinel cleanup was rejected before dispatch under the pause scope.
  Current disposition: implementation landed as `20bbeff06b95`, with current-main full landing
  verification passed. The Developer explicitly authorized scoped retained-resource cleanup after
  landing; this supersedes the earlier approval boundary only. Borrowing/lifecycle/abrupt-exit,
  parallel/combined and quarantine acceptance, the queued-stop regression and startup-generation
  diagnostic remain post-MVP. Unknown legacy ownership remains quarantined; public Android scope
  stays beyond release 5. Original ledgers and fixed named recovery determine cleanup authority.
  Authorized original-invocation cleanup first exposes valid `lsof -Fp` descriptor fields rejected
  by its PID-only parser. The fixed probe now uses `-t +w`, preserving warnings and strict identity
  checks;29 focused source cases/typecheck pass and independent review is clear. Retry
  `18-41-50-255Z-17710` ends retained/unproved on unknown descendants. Known sentinel70463 and
  actor61520 close and both listeners/emulator5582 disappear, but AVD/INI/project and original
  console fence remain. Foreign historical serial lease/retention bytes stay unchanged. No complete
  cleanup verdict or historical ownership adoption follows from that partial result.
  Fresh quiet Android lifecycle `bb7ab550` proves three real workspace additions
  across reload/restart and complete primary owned driver/target cleanup, with private AVD/project
  and physical pair independently absent. Overall acceptance remains incomplete: its borrowing
  sentinel chooses5582 despite an existing retained serial fence, and correctly refused production
  allocation leaves the invocation-owned sentinel/console generation retained. Historical serial
  ownership stays untouched. The fixed allocation/recovery repair and ancestry-only producer
  refresh/death-checkpoint have source proof above. Repeated same-generation screenshots overwrote
  earlier paths; the preservation repair passes54 focused cases and review, with target proof deferred.
  Earlier source boundary: permanent physical refusal, durable session refusal,
  exact crash reconstruction, foreign-checkout refusal, saved driver uncertainty and proved AVD
  reuse pass84 focused cases after six causal guard mutations and exact restoration. Two independent
  ownership rereviews are clear. Integrated check passes8/0/0 including types; final documentation
  gate follows. This validates prospective refusal, not timely descendant publication or a fresh
  controlled-death checkpoint; that producer work remains separate. Historical671 retains its
  original unsealed pair and missing child identity. Missing legacy receipt storage cannot be
  associated with an untyped physical owner by names or failure text.
  The mobile fixture now scopes editable input, uses the authored Add tag and requires the created
  row inside the workspaces region. Three fixture cases and grant8 pass after a scope-omission
  mutation wrongly accepts a no-op Add through its typed draft. Actual row/lifecycle remains open.
  Earlier measured boundary: abrupt invocation671476ea refuses unrecorded member3877
  in original emulator group134, preserving its exact physical pair/private AVD/project. The
  failure currently lacks a durable ownership-refusal latch in both public and physical custody.
  Later PID/group absence cannot erase that capture uncertainty. Independent design requires
  atomic complete-pair permanent refusal before public receipt publication, conservative legacy
  recovery guards, and ancestry-only bounded producer/death-injection publication. Source repair
  is in progress; no unknown process is adopted or signalled, and original assets remain retained.
  Companion lifecycle invocationsd500f983 and192b6cb4 prove app identity and complete owned
  shutdown/private collection but fail fixture input/control lookup. Scoped editable input and
  authored Add tag regressions now pass with causal mutations; real row/lifecycle remains open.
  Earlier chronology follows: `AgentAndroidEmulator.ts` lines121–157 on2026-09-30 sends SIGTERM after an ADB
  stop failure, a stop timeout, or a startup exception, then releases the serial and AVD leases
  without awaiting that termination. The successful ADB path polls for exit, but its timeout fallback
  does not. The Chrome runner already uses bounded termination and waits for process close.
  On 2026-10-01 cleanup was changed to await authoritative process close and captured descendant
  identities after bounded ADB, TERM, and KILL stages. Unproved shutdown retains both fences under
  a rotated generation; uncertain identity is quarantined. Generation-checked `android recover`
  cannot clear active peers or uncertain descendants. Focused failure and retention tests provide
  source evidence. The host run booted `Tao_Agent_Pixel_1` headlessly and opened the app, but abrupt
  cancellation left `emulator-5554` running with stale parent leases. Startup now publishes a durable
  quarantined AVD intent before spawn, then verified child identities before declaring readiness.
  Death between spawn and identity publication remains quarantined rather than automatically
  recoverable; ownership cannot be reconstructed from an AVD name or recycled serial.
  On 2026-10-02 `android devices` reported no attached emulator, so the pre-fix orphan is no
  longer present. A new owned loop was not started while the harness could not stop its host
  processes through terminal input or sandbox signals.
  The Developer approved managed `dev-loop` controls to remove that terminal-control dependency.
  The new operation is present in generated configuration but remains sandboxed in the current task.
  Existing finite mobile journeys acquire the same exclusive device resource as a dev loop; they
  cannot attach to a live loop without an explicit ownership-sharing mechanism. Preserve that fence.
  On 2026-10-03 the managed status command succeeded. Holder-issued assertion-only mobile grants,
  explicit attachment to the mounted runtime, cancellation/drain and target-aware interrupted
  recovery have focused source evidence and independent review, including durable driver
  resource retention, finite startup and strict recovery death proof. Closed host cases now own separate
  fixtures for escalation, abrupt exit, publication quarantine, recovery, parallelism and borrowing;
  their review specifically fences each destructive continuation against generation changes.
  A first real private lifecycle attempt refused before allocation because its controller callback
  intentionally passed default operations as undefined; private worker default resolution is now
  repaired and reviewed. Its failed session and project remain retained pending proved public
  recovery. Subsequent invocation `91e46cf5-dc14-475a-b86b-74d850550ce7` booted a private
  headless `emulator-5580`, dispatched the managed Expo Go runtime and created its Appium session.
  Initial identity lookup failed before input because the marker selector overescaped a literal dot.
  The corrected selector passes19 focused source tests, integrated typecheck and independent review;
  the old-selector mutation fails10 assertions. Actual interaction still requires a fresh retry.
  Driver, emulator, services, controller, private AVD and disposable projection cleanup were proved;
  five primary peers and the two pre-existing legacy Android reservations were preserved.
  Retry `243f7882-3cbb-44ae-9e45-703133aa0db0` hit the three-minute emulator boot limit under
  host load above100 on18 CPUs. Session `7ea399a5-b7a7-446a-9e5c-402e7d62245d` retained its
  private AVD/serial ownership snapshot and project after public stop refused complete cleanup. Recorded
  controller/emulator/netsimd identities are absent in named probes, but that and empty ADB do not
  prove safe resource release. Preserve generation `62169-11545446-4da1-4b2d-b4cc-016ce3a0786c`
  and the private asset ledger; no interaction evidence resulted. Current owners are absent. Source
  diagnosis finds successful internal startup cleanup can release reservations without publishing
  released device facts. The future publication repair passes28 focused checks, integrated typecheck
  and independent review, including six durable callback regressions and three caught/restored
  guard mutations. Released facts require proved shutdown and successful generation-fenced cleanup
  before output disposal. Historical absence cannot replace missing durable proof.
  Third invocation `dc724624-7471-4ec5-a451-e171f9e95d52` reached ready and dispatched Expo Go,
  but driver creation published no session UUID. The generic retention error masked the original
  cause. Appium and its captured ADB child are absent; the controller/emulator, unknown driver
  identity, device and ports4894/8269/9183 remain fenced. Its project and private AVD are retained.
  No identity/input acceptance occurred. The finite acceptance parent still references the live
  private helper; future source changes must detach that handle only after scoped capture cutoff,
  preserving quarantine and explicit incomplete evidence. Stop the affected lane; never infer a
  driver shutdown failure merely from unknown session identity or force target cleanup.
  Latest handoff: reviewed fixed-five-second paired cleanup proved complete real escalation
  in `5c34a3f5-b3a7-4d1f-bdc1-77c53f644aa0` and generation-checked recovery in
  `e74e3ad9-a385-41f6-8f16-5bbdebe22adb`, with private AVD deletion and independent
  captured-process absence. The first quarantine `a27a6445` remains historically failed at
  outer classification despite lower proof; its intentional two-fence policy is now source
  reviewed. Fresh `9fe36192-e68a-4259-8792-1c13b575db66` refused unknown recovery, then failed
  group inspection (`Could not send 0 to process -40294.`). Its actual errno is unrecorded;
  captured IDs are absent but both5584 launch-intent fences/private AVD remain retained.
  The future local bounded inspection/diagnostic/liveness repair passes26 focused cases, integrated
  types and independent rereview. Missing identity requires negative PID liveness before group
  proof; persistent uncertainty retains the exact pair and bounded diagnostic. The repaired guard
  mutants fail and were restored. This does not grant historical recovery.
  Abrupt-controller case `60ea14d1-bc39-46f8-911a-5b08805bb594`, session
  `8f382a4c-f1bc-4061-8049-3c6b6a5e5a24`, loop generation
  `7e135b6b-a20e-4a96-a837-713305cc88e3`, reached ready with complete provenance and genuinely
  killed its captured holder. Public stop refused twice. All5 recorded parent/controller/target/
  service IDs are independently absent, while group/device closure is unproved. Keep device
  generation `57495-c9bff5ab-2e01-4a87-9f65-e207e87a7def`, serial5586, its private AVD and
  external project `tao-managed-loop-project-myZ4BI`. Public non-launching state remains
  interrupted/retained. Stop further affected allocations; no PID/name/age/ADB-absence release.
  Shared liveness classification must accept only ESRCH as absence; unexpected inspection errors
  remain errors. Final validation and retained owners are recorded in the
  [execution handoff](<../Managed development loops - Execution plan.md>).
- **Workaround:** Use the printed generation with `./agent unsandboxed android recover --avd <name>
  --generation <id>` for retained, identifiable owned processes. Quarantined ownership requires
  investigation; do not force-release it from age or ADB absence.
  The invocation-private fault allocator and independent cleanup review now pass source checks.
  Quiet escalation invocation `caa89a08-4c3d-426b-923e-8e279add7763` used a distinct private AVD
  and console pair5582–5583 alongside retained5580. It recorded actual owned TERM/KILL and released
  both target fences; its captured emulator identity is independently absent and peers preserved.
  The case still failed acceptance because suspension preceded ADB serial proof, so its deliberate
  graceful-stop rejection was never observed. Fault ordering is being corrected; this attempt is
  not a full escalation pass. Its private AVD asset ledger remains owned pending safe cleanup proof.
  Corrected ordering invocation `c77e098a-9ae9-43d5-b753-d917779cded7` proved intentional owned
  ADB kill rejection, actual TERM/KILL and target-generation release. Its asset collector refused
  an immediate stale `emulator-5582 offline` entry; later named inventory showed5582 absent and
  captured root24064 absent. Cleanup remains incomplete: the private AVD exists under the
  checkout's configured `.android/avd`, and deletion generation
  `23805-b77dd5ab-98f4-4005-83e5-e883eb56b771` remains retained. A future fixed five-second
  read-only serial-absence window must hold fresh AVD and serial cleanup leases, recheck
  generation/kernel/group/listener evidence and atomically admit deletion under both owners.
  Persistent offline or changed ownership still refuses; no historical fence or asset is adopted.
  Reviewed paired collector source20 allocator/39 fault cases passes; restored mutants prove
  deadline, offline, pair admission, closure, listener and diagnostic-stderr guards. Quiet
  escalation `5c34a3f5-b3a7-4d1f-bdc1-77c53f644aa0`, log `2026-10-03T22-41-57-932Z-63178`, now passes:
  owned ADB rejection, actual TERM/KILL, target release, fresh paired deletion and complete private
  AVD removal. Both historical uncertain AVDs and retained5580 are preserved. Captured holder,
  emulator and deletion child IDs are independently absent; named AVD inventory preserves peers.
  Quiet recovery `e74e3ad9-a385-41f6-8f16-5bbdebe22adb` passes rotated retention, stale-generation
  refusal, withheld closure proof, exact-generation real recovery and private-AVD deletion.
  Its three captured IDs are independently absent and baseline peers preserved. Quarantine
  `a27a6445-67a0-4093-b3b5-fd2e0406ba2d` proves safe refusal and captured-child rollback, but its
  outer classification incorrectly treats expected launch-intent retention as failure. Correct
  only that fixed-case disposition; historical report and generation
  `86559-786fc398-dc5c-4616-9b53-e36259852c7c` remain retained, with private AVD/5582 fences.
  All3 captured IDs are absent; unpublished ownership still cannot be adopted or force-released.
- **Proposed change:** Share a bounded owned-process stop helper across failed startup and normal
  teardown, confirm exit after TERM/KILL escalation, and preserve ownership if stop cannot be proven.
  Keep borrowed devices untouched.
- **Dependencies:** None.
- **Acceptance:** Source tests cover failed startup, bounded escalation, borrowed devices, retained
  ownership, PID reuse, stale recovery generations, and parallel reservations. Still open: real
  ordinary graceful shutdown; complete abrupt-parent-exit recovery after the measured refusal;
  complete quarantine child-group proof; concurrent sessions and port reuse; screenshot/input acceptance; and safe reconciliation of
  uncertain ownership. The pre-fix orphan's absence is confirmed by the later ADB inventory.
- **Source:** Quiet development workflow and skill discovery audit, `dev/ro`, 2026-09-30.
