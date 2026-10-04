# Managed development loops — Implementation and acceptance execution plan

Prepared 2026-10-03 against `dev/ro` at `b13ddc54d`, in the shared primary checkout
`$HOME/code/tao-lang-2`. Status: **remaining acceptance deferred until post-MVP; prepare readiness and hold landing**.

## Developer stopping decision — 2026-10-04

Latest instruction: **prepare fully for landing and report readiness; do not land**. The resolved
main integration is committed as `a364e093f`, followed by subprocess entrypoint cleanup `9fcb6b9bb`
and the real exited-process lock fixture `ccadf7da8`. No current task landing has occurred; the
remote personal-branch archive reported by `landed` is the historical 2026-09-29 archive.

The first full landing verification stopped without pushing: macOS process enumeration included
zombies while its BSD identity query excluded them, and a lock fixture used an OS-invalid PID.
The query repair enables zombie lookup only for enumerated group/descendant snapshots, preserving
direct-query exit behavior, exact PID/start/group checks and refusal on uncertainty. Independent
review is clear; Darwin28, genuine orphan-group3 and lock96 source checks pass. The separate quiet
browser proof passes3/0 at `16-57-14-777Z-70546`, including previously failed cleanup. Full readiness
verification must cover the final committed tree. None of this resumes deferred special acceptance.

The next broad run passed the executed browser/native proofs and typecheck but exposed stale
source-test fixtures. Named wrapper entry3, strict target-fault fixtures26, retained reservation3
and synthetic native port leases6 now pass after fixture-only repairs; negative ownership and
visibility guards remain. Repeat full verification before claiming readiness.

The second readiness run stopped on an unused fixture import; removing it restores integrated
typecheck (`17-15-42-025Z-52586`). That run also exposed a scheduler-sensitive source fixture:
the Android TERM/KILL case observed authoritative close through a 10ms budget and correctly retained
its fences when the deadline expired under contention. Its test-local budget is now 1000ms, with
the same exact ADB/signals/concurrent-release assertions plus an explicit no-retention assertion.
The corrected emulator suite passes34 (`17-18-02-071Z-66761-8630f000`); production cleanup policy
is unchanged. The isolated complete HNReader browser retry passes3/0, including cleanup
(`17-17-10-034Z-61246`). Full verification must cover the final committed tree before readiness
is claimed. Landing and special acceptance remain held.

The Developer requested a pause at a good stopping point to preserve effort and tokens for other
work, and explicitly deferred all remaining managed-loop and isolated native acceptance until
post-MVP. The subsequent instruction authorizes committing the completed implementation in chunks
and landing it. Finish currently running source checks, repair source regressions required for
landing, review the coupled ownership changes, and use the ordinary landing verification. Do not
resume target launches, host faults, visible checks, dependency changes or machine-setting changes.
Older execution instructions below describe the resume catalog, not authorization to continue now.

Main integration for authorized landing incorporates `854427134`: project/module tooling refresh,
hidden generated contracts and the public `tao run` entrypoint. Managed selection and app-dev's
inner dispatch use `run`; the named app-dev operation retains its owned-device and quiet-UI wrapper.
Disposable acceptance projections carry the new project marker and app metadata. The merged
integrated check `16-36-15-932Z-78350-1d498e02` passes8/0/0 including typecheck; focused runtime22,
selection10, recovery18, named dispatch11 and landing60 pass. These are source integration evidence,
not renewed host acceptance. The Developer explicitly requested resolving the integration conflicts
and continuing the merge; the post-MVP acceptance stopping decision remains in force.

Pause preparation source evidence: the final integrated check
`16-10-43-794Z-25879-ae6a0c6d` passes8/0/0 including typecheck. The latest affected suites pass
emulator34, Controller46 and Faults80; borrowing17, recorded recovery22, literal-argument route2
and MachineResources19 also pass. Independent recovery review and targeted Android rereview are
clear. The repairs make fault admission synchronous, exclude physical producer identities from
legacy observation, reject cancelled queued mutation before refresh and serialize initial readiness.
Initial failed fixtures and typing diagnostics are historical failed runs, not current verdicts.
The per-attempt mobile artifact repair has54 source passes and clear review. Real-host use of these
latest revisions remains deferred. Dedicated queued-stop interleaving regression and new causal
mutation runs were not added at this stopping point. Android startup text can still show the
generation before the final refresh; authoritative receipt, reservation and owner use the refreshed
generation. Correct that diagnostic after MVP without weakening generation fencing.

The main implementation is present: persistent authenticated loops, finite acceptance tooling,
revocable mobile attachment, isolated native routes and detached-WDA registration. Real-host
evidence includes server/Chrome lifecycle, command refusals, native isolation/semantic interaction,
Xcode runner provenance, Android escalation/recovery and three Android workspace additions across
reload/restart. These results do not close the complete Android lifecycle, iOS lifecycle, Mac2
physical input, human focus/consent/coexistence or manual window acceptance.

Post-MVP resume order:

1. Reinspect this checkout, capability/permission state, original receipts and retained resources.
   Validate the new invocation-scoped sentinel recovery before using it; no host recovery result
   exists for this revision. A surviving recovery-owned AVD fence refuses further recovery rather
   than being adopted. Complete ownership uncertainty remains quarantined.
2. Finish Android borrowing/lifecycle and controlled abrupt-exit acceptance, then iOS startup and
   real interaction. Diagnose the original lower iOS launch failure without weakening custody.
3. Run the remaining quiet cases separately: `lifecycle-faults`, `android-parallel`, `ios-parallel`,
   `combined-lifecycle`, `combined-target-failure`, `mobile-interaction-faults` and
   `android-quarantine`. The last two can deliberately retain resources; record those outcomes.
4. Schedule visible/focus/consent/coexistence, Mac2 physical input and the three human Studio
   window checks with the Developer. The current pause covers visible work too; obtain a resume
   instruction before using earlier visibility authorization. Never reset native consent.
5. Reconcile every acceptance row and retained asset from measured evidence. Keep unified UI
   control deferred; preserve six public loop verbs, no default timer, target-specific visibility,
   authenticated control and borrowed-resource preservation.

Current retained resources are a cleanup obligation, not acceptance success. Invocation
`bb7ab550-7b1e-4215-96e0-84a1866bccf1` retains its sentinel
`70463/1791125799:515407`, console generation
`70463-d1c1dfdd-2349-416b-a07a-14621edbcae2`, private AVD
`Tao_Borrow_b67e9a7734b74217b4f530af4695ee4e`, and project
`/private/var/folders/ch/gy4zgxlx0zdcqqt9gllqprrc0000gn/T/tao-managed-loop-project-1IPFbw`.
The original finite actor remains live through sentinel output pipes (handle31055 at pause).
The proposed named invocation recovery was rejected before dispatch by automatic approval review:
signalling and deletion were outside the later pause's authorized host scope. No cleanup ran and
no alternate route was attempted. Explicit cleanup authorization is required when resuming.
Only original captured ownership, current generation, kernel/group/listener closure and exact
asset proof admit collection. Preserve historical serial generation
`86559-786fc398-dc5c-4616-9b53-e36259852c7c`; it belongs to another invocation.
Future file-backed sentinel output prevents this parent-lifetime coupling without claiming cleanup.

Historical Android `671476ea` still lacks descendant identity/closure and retains its pair, private
AVD and project `dlAIho`. Historical iOS `e73f1b30` retains simulator
`63467AFA-4498-4C7C-91A1-64F5038E24F4` and project `vOxLbz` after lower-launch inspection
refusal. Later process absence supplies neither missing proof. Original invocation asset ledgers
under `.artifacts/host-acceptance/managed-loops/`, native launch ledgers and the task-local
`.artifacts/managed-loop-retained-resources.md` record the complete earlier external directories,
owner generations and cleanup conditions. Preserve those local artifacts at the pause; do not
force-release resources or delete shared caches. A dedicated recurring repository pass is
recommended after landing because this work crosses runtime, host control and developer tooling.

## Autonomous continuation — 2026-10-04

The final integrated source check `14-47-39-588Z-23497-5802f26b` passes8/0/0 including typecheck.
Fresh quiet Android lifecycle invocation `bb7ab550-7b1e-4215-96e0-84a1866bccf1` proves three real
workspace additions on the dispatched Companion across initial interaction, reload and restart.
The primary session `6f1329e3-458c-411d-b595-85d9efe6fd1a` is stopped/proved/disposed with driver
cleanup proved and its physical generation released. Independent inventory corroborates original
main kernels absent, private AVD/project absent, pair absent, and protected peer identities unchanged.

The whole case remains **incomplete**: the borrowing sentinel selected listener-free5582 despite
an existing retained managed serial fence. The production borrower correctly refuses before device
publication. Only the new invocation-owned console fence and sentinel are retained; the historical
serial fence supplies no cleanup authority. The original finite actor remains live through retained
sentinel output pipes. Independent diagnosis calls for skipping fenced candidates and a fixed
invocation-scoped recovery route; existing named Android recovery requires an AVD fence and cannot
recover this console-only sentinel. No arbitrary PID signal, forced release or historical cleanup ran.

Repeated interactions in one generation also reused screenshot paths, overwriting the initial
attempt's pixels. Reported row assertions remain real-host evidence, but the original screenshots
cannot be reconstructed. The per-attempt artifact-directory repair passes 54 focused source cases
(fixture 4, grant 8, cleanup 11, diagnostics 20, startup 11), and independent review is clear. It preserves
actual controller files across two successes and an injected failure in the same generation.
This revision has not run on a real target. The latest restart screenshot from the prior revision
visibly contains its asserted workspace row. Android producer refresh and a fresh pre-death
checkpoint are being implemented as a separate slice; no new abrupt-exit injection is permitted
before its source and admission proof. A second exclusive slice implements the fixed recorded
invocation recovery route and fence-aware borrowing allocation. Shared gates wait for both freezes;
the earlier integrated verdict does not validate these still-changing sources.

Future retained sentinels must not keep the finite acceptance parent alive through piped output.
The prospective repair uses separate owned stdout/stderr files rather than closing a live child's
pipe, which could itself induce exit. Ending the observer supplies no target-cleanup proof. The
current invocation remains retained until supported recovery can prove its actual ownership and
shutdown, without signalling its parent merely to end the observation handle.

Current remaining work is ordinary quiet Android/iOS interaction and
follow-on fault/recovery/isolation acceptance; genuine in-flight boot/install/open-URL cancellation;
and human focus/consent/Mac2/window observations. Resource and backlog reconciliation follows the
measured results. No human verdict is inferred from source or quiet process evidence.

Latest source wave, 2026-10-04 14:03 UTC: Darwin25 and lower-launch18 pass, including the fixed
short-child kernel probe. That probe observes no natural failure and supplies no explanation for
historical e73. The narrowed mobile fixture3 and grant8 pass; the no-op Add case rejects despite
the searchable typed draft. Android physical/admission/public-recovery/standalone suites pass
17/6/34/5; custody4/5 fails a fixture that aliases controller and holder identities. Acceptance69
passes. Independent ownership review finds a production cross-checkout gap: the legacy custody
reader scans the current checkout, so another checkout's retained receipt can be missed. Recovery
must refuse foreign or unproved checkout custody before returning `none`. Source remains frozen
until both reviews finish, then the narrow production/fixture repairs precede renewed baselines,
serialized mutations and integrated checks. No new host allocation or historical cleanup has run.

Both ownership reviews are now closed and the same eight-file repair window is active. Additional
findings require a durable session refusal when physical refusal publication fails, driver-cleanup
retention to block standalone recovery, and exclusion of conclusively completed/released historical
AVD generations from current custody claims. Failed physical publication remains explicitly
unproved; successor owners must stay intact. Negative crash-context fixtures will check changed
session, loop/controller, original physical generation and resource snapshots. Unsealed legacy
physical records have no reliable managed-session association if their receipt storage is missing;
that evidence limit remains explicit, and names or failure text supply no cleanup authority.

The repaired Android suites now pass84/84. Integrated check initially finds one implicit callback
type and two readonly-array fixture mutations; narrow typing fixes pass custody22 again and
integrated check `14-25-53-647Z-13969-5e19205c` passes8/0/0, including typecheck. Acceptance69 also
passes against the review repairs. Android guard mutations are now released in one exclusive
window, with injected source operations only and byte-exact restoration after each omission.
Mobile and iOS mutation windows, ownership rereview and final host admission remain pending.

The mutation windows are now complete. Six Android omissions fail the expected refusal assertions;
after exact restoration all84 focused cases pass. Omitting the mobile row scope causes the no-op
Add promise to resolve through its searchable draft; that causal case is distinct from two changed
lookup-event expectations. Restored fixture3 and grant8 pass. Omitting eventual iOS closure facts,
inspector forwarding or the enumeration count fails the intended diagnostics; restored Darwin25
and lower-launch18 pass. All15 source/test hashes match their manifests. Both Android ownership
rereviews are clear, including failed physical publication, dual write failure, driver retention,
foreign custody and completed-generation reuse. The final documentation/index/check gate precedes
the fresh quiet Android lifecycle run. No host or historical resource operation occurred during
these source mutation windows, and no retrospective ownership proof is claimed.

Two prospective repairs after fresh host failures are now frozen: finite interrupted-recovery
group-drain observation/diagnostics, and fixed iOS downloader custody with durable private
ownership refusal. Focused source checks pass helper34, runtime57, Controller44, AppDev30,
Faults66 and Recovery34. All18 source/test hashes are verified. Controlled mutations separately
prove acknowledgement before durable publication when its await is removed, a false proved
cleanup when Store refusal normalization is removed, and loss of the original typed AppDev
refusal. Broad custody mutation runs also exposed fixture races/timeouts, recorded separately
from the dedicated causal assertion. Every mutant is restored. Independent downloader custody
rereview is clear, with real host timing still unproved. Recovery rereview found that the durable
refusal guard was bypassed when every device was skipped or the device list was empty. The repaired
authoritative read now precedes device classification, checks checkout/generation/controller, and
preserves original refusal facts. Three actual-Store regressions cover empty, released and ineligible
devices. The authority-omission mutation fails four cases and is restored before the final34 pass.
Focused recovery rereview is clear; renewed Acceptance69 passes. The first integrated check
passes seven nodes but finds three TypeScript narrowing errors in the iOS helper test fixture.
An explicit required-spec assertion repairs them, and helper34 passes again. Its first version
omitted the assertion helper's required message argument, producing one intermediate typing
failure; that argument is now supplied. The final16-file
manifest records this fixture-only typing repair. Renewed integrated check
`12-55-33-959Z-56251-01086b05` passes8/0/0 including typecheck; all18 final hashes remain unchanged.
Earlier W5 gates do not validate these new edits. Fresh non-launching status reports75
recorded sessions and none active.

The prospective Android root self-dismissal8, strict observer39, managed child capture Controller41
and AppDev28, Darwin complete-inspection19, and lower iOS launch-cancellation16 source regressions
pass with independent reviews clear. Private iOS helper22/runtime69, borrowing13 and target-fault26
source checks now pass. Actual-controller Faults39 passes (`09-42-20-236Z-22861-6dda2767`) after
correcting the producer's member list to include both original supervisor and worker.
Pending-publication cancellation is bounded, and a final-admission identity-check mutation is
killed and restored. The borrowing fixture now models external execution after the synchronous
acknowledgment instead of reentering the admission lock. Final review found fragmented control
frames were decoded prematurely; newline-complete parsing and two causal fragmented-frame tests
now pass, with the framing mutation killed and restored. Checked-flow typing and independent
owner-admission cancellation coverage are repaired. All10 iOS hashes are frozen and independently
reviewed clear. Integrated typecheck `09-42-19-855Z-22757` and static check
`09-43-23-688Z-29552` pass; static summary reports8 passed/0 failed/0 skipped. This is source
evidence, not mobile interaction or actual in-flight native cancellation acceptance.

The subsequent W5 source slice adds fixed private native-stop scenarios and execution observation.
Its audit found private native boot/bootstatus ignored managed cancellation; both now observe stop,
while cleanup shutdown/delete remains uncancelled. Focused helper24, runtime70, Faults66,
Acceptance67, target26 and borrowing13 checks pass. Three causal mutations are killed and restored.
These are source results: native command drain and simulator/bootstrap cleanup remain separate,
and missing bootstrap provenance retains ownership even if in-flight stop was observed.

Initial W5 integrated typecheck `10-47-34-210Z-12900` failed with13 typing diagnostics in three owned
files; static check `10-49-20-273Z-22798-8c499f85` also rejected two raw test error constructions.
The first independent frozen-source review confirmed the custody and stop-entry seams, but found that
the runner propagates retained boot cleanup or an inconclusive fast boot before reaching independently
scoped install/open-URL cases. Narrow typing/test fixes and per-scenario result aggregation now pass
Acceptance69 (`11-16-00-157Z-95894-cefc7113`), Faults66 (`11-19-09-892Z-13527-0d41a19e`) and
integrated typecheck `11-20-18-927Z-19239`. The repaired14-file manifest is frozen and verified.
Retained boot remains a failure; later unique scopes require proved original command drain,
complete command/driver provenance, exact retained fences and stable unrelated inventories.
Live/unreadable original kernels or unrelated churn refuse continuation. Two intermediate fixture
defects caused long waits/timeouts before the corrected complete suites passed; those failed runs
are not current validation. Independent rereview is clear; static check `11-21-53-797Z-28292-0612a0d5`
passes8/0/0 with the repaired14 source hashes unchanged. A late disposed controller awaiting journal
flush is not claimed absent merely from native command closure; any failed exit confirmation stays
reported. Captured command/group closure does not prove escaped daemon rollback or target effects.

Quiet command invocation `24224a71-bc42-41bf-bedd-a660fba5b395` proves the fixed owned kernel/group
diagnostic, prompt-free selection and complete owned cleanup. Its invalid command was refused and
session inventories were unchanged, but unrelated Chrome/Metro/Studio resources changed and a GUI
lease appeared during measurement. Fresh-baseline retry `94f1e58e-68e0-4f17-8099-c7a1c153c9e6`
again proves the diagnostic, selection and cleanup, plus five allocation-free refusal rows; another
unrelated Studio test process and port lease appeared during the following refusal. Both invocations
remain incomplete. Their disposable projections were removed; neither attempt proves that unrelated
activity was caused by the command. Fresh invocation `42d70b34-0830-45bd-9fda-e45e2908bfcd` now
passes the complete commands case after reviewed W5 source gates: owned diagnostic, selection,
all nine allocation-free refusal rows and complete cleanup. Independent named process/receipt and
filesystem checks confirm original owned kernels gone, session stopped/proved/disposed and both
projections absent. All11 primary peers/24 resources are preserved. Quiet Android lifecycle follows.

Three timed-out source workers also left six `/source-owned` in-memory controller receipts. Source
allocation paths prove no native target, child or device reservation. Fresh kernel probes find the
three workers absent; supported recovery disposes all three complete-provenance receipts. The three
uncertain receipts stay preserved; one supported recovery refusal is measured without forced release.
This is source-fixture recovery evidence, distinct from native host ownership or historical quarantines.

Earlier continuation checkpoints below remain historical and do not override these current verdicts.

Quiet Android lifecycle `84bf4d65-7f27-43ee-a348-1137180ea6df` reached readiness but refused the
mounted marker before any input. Its screenshot shows Data MVP rendered behind Expo's native
tutorial, and the accessible hierarchy exposes only the tutorial. Known driver cleanup, public
stop, original target-generation release and private AVD/project collection are proved; independent
kernel and filesystem checks corroborate cleanup. Android interaction remains open.

Quiet iOS recovery `0be47cec-e41d-43ea-b6a5-9565e7a621a0` passes injected shutdown-failure retention,
stale-generation refusal and exact-generation recovery/deletion. Independent checks find every
recorded command kernel absent and the invocation's simulator directory removed. Its ordinary
native actions have closed, drained command barriers; this is recovery evidence, not an in-flight
stop or target-effect cancellation verdict.

The following iOS lifecycle `cb64572b-3762-4bf6-b96c-1a6f4446485c` fails before readiness. Private
download preparation retains uncertain capture even though public stop subsequently reports
stopped/proved/disposed and the projection is removed. Private simulator
`AFEA050D-F7CD-400A-A107-74B3DB8288EE` remains retained; the private collector refuses missing
exact controller/command/minted-target proof. Fresh named kernel inventory finds the recorded
holder, bootstrap, native command and download/plutil identities absent. Current absence does
not supply missing closure provenance or authorize private asset collection. Diagnose this
cross-seam discrepancy before any further iOS lifecycle allocation.

Fresh quiet Android abrupt-exit `502b17f3-3a12-4895-b785-a08300f36a77` reaches ready and injects
death into its captured controller, but public recovery refuses complete descendant/device cleanup.
The original target pair generation, private AVD and project remain retained. Independent named
inventory finds the captured controller/emulator/Metro kernels absent; this does not itself release
the recorded target pair. Diagnose whether supported exact-generation recovery can complete before
another Android physical acceptance allocation. The complete abrupt-release/private-collection
acceptance item remains open.

The supported exact-session stop retry for Android502b17f3 subsequently reports stopped/proved,
controller disposal and release of the original target-pair generation, preserving historical
failures. Its private AVD/project remain retained; the ended runner has no supported collector
re-entry. Prospective recovery is being repaired to observe full group drain within the existing
finite cleanup budget and preserve refusal diagnostics, rather than silently checking groups once.

The existing named prerequisite build now succeeds:

```sh
./agent unsandboxed companion-host-build --platform android --abi arm64-v8a
```

It produces a compatible pinned Android Companion host in
`.artifacts/hosts/1.0.0-f05fbf78600c/android`. All10 tracked Companion/lockfile hashes are unchanged.
The build opens no device, retains reusable generated output and preserves the pre-existing shared
Gradle daemon/cache. This prerequisite is not a fully isolated acceptance invocation. Fresh owned
mobile acceptance must separately prove Companion selection, mounted identity, input and cleanup.

Fresh quiet Android lifecycle `d500f983-a67f-4410-9309-991a4a10a883` now proves Companion dispatch,
runtime/app/source identity and mounted marker verification; the screenshot exposes Data MVP
without Expo's tutorial. The first workspace text input fails in Appium's element value request,
so lifecycle and interaction remain incomplete. Driver deletion and public stop are proved,
the original physical pair is released, and independent kernel/filesystem checks find all captured
processes, private AVD and projection absent. Primary11 peers/25 resources are preserved.
Diagnose input without another Android allocation; the independent quiet iOS lane can proceed.

Quiet iOS lifecycle `e73f1b30-a638-4696-b7b6-48da553e4da7` records complete production held
create/boot/download/install barriers. Download captures its original supervisor/worker plus
natural `plutil` metadata child, then nativeClose0, outputClosed and original supervisor/group
drain. The later lower open-URL command refuses descendant inspection after release; its nested
Darwin backend cause is absent from the existing diagnostic. Sessionfef96bd7 remains
cleanup-failed/uncertain/retained, including original refusal facts; simulator63467AFA and
projectvOxLbz stay retained. Fresh kernel absence does not supply missing launch closure.

Fresh Android abrupt-exit `671476ea-b722-47b3-81f7-69903ec5f2cc` refuses an unrecorded member3877
in original emulator group134. Its public recovery and private collector remain incomplete,
retaining session29ea16dd's exact physical pair, private AVD and projectdlAIho. No signal or
adoption of that unknown member is authorized. Read-only diagnosis must resolve why publication
missed that member and whether durable provenance remains sufficient; complete abrupt acceptance
is still open. The new refusal diagnostics expose this specific boundary instead of a generic
cleanup error. Both invocations preserve primary11 peers; their measured baselines contain25 and27
resource owners respectively. Further affected physical allocations pause for diagnosis/repair.

The editable-descendant fixture repair passes its actual-controller source regression and grant8,
with the bare-tag mutation caught/restored and integrated check8/0/0. Fresh Android lifecycle
`192b6cb4-9de8-484b-99c4-b68741f30935` reaches its input action boundary, then fails Add workspace
lookup. The saved controller event journal locates that phase; no extra probe is required to locate
the failure. Android uppercases the rendered native Button title while retaining its authored tag.
The fixture now needs that fixed `addWorkspace` tag, and its regression must model uppercase title
plus nested/flattened editable layouts. Real created-row, reload/restart and borrowing evidence
remain open. Owned original kernels, private AVD, released physical pair and projectvY9mxF cleanup
are independently corroborated; this invocation adds no retained resources.

Independent custody design review identifies a durable cross-route refusal requirement: unknown
members must latch the public receipt and atomically generation-rotate the complete physical pair
with a monotonic refusal. Standalone recovery must refuse before shutdown; later empty groups
cannot clear it. Producer refresh remains ancestry-only, at bounded publication/status/lifecycle
boundaries, with a fresh durable death-injection checkpoint. These are implementation safety
requirements, not new product decisions. Legacy refusal and publication-crash treatment are being
specified before implementation; no unknown historical member is adopted or signalled.

The Add-tag repair is now frozen: two actual-controller fixtures model uppercase Android button
text and nested/flattened editable layouts, and grant8 passes. Restoring the old lowercase text
lookup fails both cases after successful input; the repair is restored. Integration/host evidence
for these latest bytes remains pending.

The next source wave implements permanent physical-pair/public refusal and conservative legacy
read guards, preserving ordinary known pending closure through newly emitted typed recovery-audit
evidence. Old failed/retained receipts cannot acquire that proof from later empty groups or failure
text. A separate diagnostic slice preserves bounded Darwin operation/backend failure fields and
original lower iOS command/output closure facts, plus a source-only actual-kernel short-child probe.
Neither slice changes native consent, visibility, the native command allowlist or runtime timers.
Both streams freeze before focused read-only validation; mutations are serialized. Independent
ownership review and integrated checks precede further physical acceptance allocation.

At 2026-10-04 13:44 UTC, the five-file iOS diagnostic slice has its first frozen manifest and
passes scoped formatting. Its focused tests and fixed source-child probe have not run. Android
physical/public recovery refusal remains under implementation. The final mobile selector hashes
match their frozen manifest; its independent review and a quiet-case catalog audit are in progress.
No further host allocation occurs until the ownership source wave is frozen and validated.

Independent selector review finds that the final global text lookup could accept the typed draft
even if Add created no row. The fixture is being narrowed to the authored `workspaces` region,
with a searchable draft and a no-op Add regression; its prior two-test freeze is superseded for
acceptance. Independent iOS diagnostic review finds an undeclared test assignment, which is being
removed before focused validation. Its extracted inspector/helper serialization tests do not yet
prove the complete outer backend envelope end to end, and no historical launch cause is inferred.

After the current source gates and recovery rereview, run quiet cases sequentially:
`android-lifecycle`, `android-abrupt-exit`, `ios-lifecycle`, then native-stage
`lifecycle-faults`. Successful ordinary mobile lanes permit the parallel, combined-target and
mobile-interaction fault cases. Run `android-quarantine` last because it deliberately retains
unknown launch-intent fences. Stop an affected lane on unexpected uncertainty or unrelated changes.
The mobile-interaction-faults case intentionally reports incomplete when injected holder death or
remote deletion refusal retains ownership. Its protective revocation/refusal rows are separate
measured results; retained teardown and projections remain unresolved, not a whole-case pass.
Fresh abrupt acceptance must prove complete released-pair publication and private AVD/project
collection; the original8f public recovery and fd normal-failure cleanup do not jointly prove that
new path. A fresh pass never authorizes historical60ea asset collection.

Latest continuation evidence: the original abrupt Android session
`8f382a4c-f1bc-4061-8049-3c6b6a5e5a24` now completes the supported generation-checked
`dev-loop stop` recovery. Public status preserves generation
`7e135b6b-a20e-4a96-a837-713305cc88e3` and historical failures, and records stopped,
proved cleanup, controller disposal and release of the original emulator5586 resource pair.
This closes that session's process/device recovery; its invocation-private AVD and project
still require separately proved collection. Other historical quarantines remain unchanged.

Prospective publication/secondary-diagnostic repairs pass27 focused tests and independent review.
The mobile visible-window repair passes Attach20 and Diagnostics20, with popup-guard mutations
killed and restored; final review and renewed integrated gates are being completed before host input.
The private two-process command-barrier engineering spike passes10 actual-child source tests.
It is not production integration or iOS acceptance: independently authenticated command/target
ownership, escaped-descendant limits and final collection still require review.

Renewed typecheck `08-14-20-590Z-61274` and static checks `08-14-29-579Z-62376` pass8/0/0 after
both independent repairs are clear. Quiet Android retry
`fd35221b-2cf5-4680-a691-8616bdcad7d6` still refuses mounted identity before any input: the captured
hierarchy remains tutorial-only despite the fixed multiwindow/invisible-element observer settings.
Its known driver session, controller, physical target, private AVD and projection all have proved
cleanup; independent process and filesystem observations corroborate removal. The release-metadata
repair is therefore host-proved for this failed interaction attempt. Source observation remains open.
Production iOS barrier integration and conservative Darwin group/descendant inspection are underway;
the fixed simctl command custody and separately minted target effects remain distinct proof boundaries.

The Developer requested completion of work that does not need human attention. The Oct3 stopping
conditions below remain historical evidence; prospective source repairs and independently reviewed
quiet diagnostics may proceed within the same authorized scope. Human focus, consent, Mac2 physical
window readiness and manual verdicts remain deferred. No commit, landing, dependency or machine-setting
change is included.

Named read-only capabilities, process, device and public-session inventories were refreshed. The
retained Android controller9629 is now absent and the old parent handle96790 is missing; emulator10411,
iOS helper77398, bootstrap62516 and private AC1C/A003 simulators remain. Unknown driver/group ownership
still prevents historical target/port/project release. Unrelated Chrome, both Metro processes, the
Developer's booted simulator and a development Studio now running in the studio-preview-speed checkout
remain protected. Updated local evidence is `.artifacts/managed-loop-continuation-2026-10-04.md`.

The existing AVD-free process-group source regression passes3/3; it does not reproduce the historical
host exception. A fixed self-owned diagnostic is implemented in the existing commands acceptance case
to capture live/post-exit signal0 results and bounded raw causes without another device, new case,
arbitrary PID input, recovery or nonzero signal. The closed21-case catalog remains unchanged.

Mobile startup diagnosis found a concrete budget mismatch: the managed POST/session request allows30s,
while the pinned WDA launcher allows60s and historical XCTest reports a70s Accessibility expectation.
Premature client cancellation is a supported inference, not proof that Accessibility would complete.
A prospective session-creation-only90s budget and bounded private transport diagnostics are implemented;
ordinary action/deletion budgets30s and the controller's finite interaction deadline120s stay intact.
Historical unknown sessions and preparation journals are not retroactively upgraded.

Mobile source tests pass WebDriver24, CleanupEvidence10 and Startup11, with independent review clear
and budget/response-stage mutants restored. Response-body timeout and external cancellation leave a
partially returned UUID unpublished, retain opening fences and attempt independent server cleanup.
The prospective iOS pre-walk capture retry passes69 focused tests after a deadline-reset mutant is
killed and restored; it waits outside the owner lock for at most1s, never walks descendants or signals
while identity is pending, and preserves immediate post-walk refusal. Independent retry review is
clear. Diagnostic review found source-injection fallback, descriptor-shaped overrides and post-reap
PID-reuse gaps; all are repaired, with final Diagnostic15/Acceptance63 tests passing after targeted
mutants are restored (`2026-10-04T07-28-29-408Z-96437` and `07-28-28-390Z-96436`). The fixed child now
uses repository runtime wrappers. The prior static lane passed seven nodes and rejected only raw
runtime access in the emitted child; that defect is repaired. Final independent rereview and renewed
integrated typecheck/static checks subsequently pass (`07-29-53-858Z-12469`, `07-29-57-608Z-12998`,
8/0/0); final independent diagnostic review is clear. Quiet commands host invocation
`500c4c67-cba1-45c7-835c-eba0a830f3b2` passes live/post-reap group probes, natural child exit,
owned server cleanup and preservation of8 primary peers/23 resources. This does not reproduce or
release historical emulator-group uncertainty.

Quiet Android invocation `57a8d02a-eef7-4c9c-9381-05be27e59b1d` reaches ready and opens a known driver
session. Its captured hierarchy contains only Expo's first-run developer tutorial, so mounted-source
identity is unproved and no input occurs. Driver/loop/device shutdown is proved, captured processes
are independently absent and its project is removed. Private AVD deletion refuses because a final
released-device summary overwrites the exact pair metadata; its new cleanup fence remains retained.
The prospective event-publication repair and identity-safe overlay diagnosis proceed without
contacting that retained asset.

Quiet iOS invocation `ae506eb9-f3b2-4bd0-beee-8fd572240613` mints and boots private target
`FB29D656-0B58-443B-869A-CAC08C5EB2D1`, then retains pre-walk boot-command uncertainty. Its secondary
retained publication drops holder/resources and masks the original error. The private simulator,
generation `83010-0cfc4ffc-d090-4eb7-8f25-1635e59a7a89` and project `YatbQu` remain protected.
No further mobile allocation proceeds until these newly measured seams are repaired and reviewed.

Hidden native canary `63acc303-81bc-40eb-a3f8-1550cdf8c5c5` passes all six machine capabilities and
owned teardown alongside development Studio. Its unrelated holder/helpers/launcher/backend retain
their prior recorded start times. This proves scoped process coexistence only; development state,
focus, visible interaction and human coexistence verdicts remain separate.

The current runner audit also finds W5 mobile boot/install/open-URL cancellation needs dedicated
in-flight host evidence; the generic pre-dispatch gates and driver-action faults do not prove those
stages. Extend fixed internal subcases within the existing catalog, preserving before-admission versus
in-flight evidence boundaries, before closing that acceptance row.

The formatter classification defect is repaired and independently reviewed: focused tests pass39/39,
and an actual bounded dprint refusal preserves exit20/output/log/file evidence while classifying
historical permission prose as a repository formatting failure. Its owning entry is archived with
evidence; an observed hook/tool-inventory mismatch is separately recorded as a Candidate.

## Execution evidence — 2026-10-03

### Oct3 acceptance handoff — historical

The bounded runner, managed mobile delegation/attachment, detached-WDA registration barrier,
Mac2 interaction assertions and isolated native routes are implemented. The settled design remains:
no default runtime timer; six public `dev-loop` verbs; target-specific visibility; authenticated
local control; a single physical-target release owner; preservation of borrowed resources; and
unified persistent UI control deferred until after MVP. Host reach now includes only the closed
21-case catalog and fixed isolated native routes, with no arbitrary PID, executable, endpoint or
fault arguments.

Named non-launching `dev-loop status --json` succeeds. Measured host passes cover command refusals,
server lifecycle and its complete fault case, foreground cancellation, quiet/visible Chrome,
native isolation and semantic interaction, real detached-WDA provenance, Android escalation and
Android generation-checked recovery. Each pass includes its own scoped cleanup evidence.

Acceptance is **partially complete**. Mobile driver ownership, abrupt Android recovery, private iOS
preparation and Mac2 window accessibility have reached required stopping conditions. No further
host allocations or physical input are admitted from this handoff. Current process absence does
not resolve a historical unpublished descendant, driver session or group. Human focus, consent,
coexistence and the three Studio window verdicts were not received. Visible permission is approved
for this session with notice before each check; it supplies no human verdict.

| Case or entrypoint                                               | Measured disposition                                                                                                                                      | Remaining condition                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `commands`                                                       | Fresh complete host pass `42d70b34` after reviewed W5 source gates; earlier `24224a71`/`94f1e58e` incomplete from concurrent peer changes                 | Closed for this invocation; independent kernel, public-receipt and filesystem cleanup corroborated.                                                                                                                                                    |
| `lifecycle`                                                      | Host pass `d61811ef`; launcher survival, reload/restart, stop                                                                                             | Closed for this invocation.                                                                                                                                                                                                                            |
| `lifecycle-faults`                                               | Host pass `71dafa2f`; all11 sessions/projections closed                                                                                                   | Closed; earlier uncertain attempts remain retained.                                                                                                                                                                                                    |
| Native boot/install/open-URL stop subcases in `lifecycle-faults` | W5 focused source checks pass; integrated typing/lint and independent-stage aggregation repairs pending; prior pre-dispatch faults are insufficient       | Require native execution before public stop, fresh original kernel/group/loop-generation observation at stop entry, separate resource-generation checks, cancellation/drain and independent cleanup. A command that exits before stop is inconclusive. |
| `foreground-compatibility`                                       | Host cancellation and owned cleanup pass `29d8f339`                                                                                                       | Closed for this invocation.                                                                                                                                                                                                                            |
| `chrome`                                                         | Host pass `800dca69`; genuine clicks, six captures, reload/restart/disconnect/cleanup                                                                     | Closed for this invocation.                                                                                                                                                                                                                            |
| `chrome-visible`                                                 | Host pass `34f42a19` with owned cleanup                                                                                                                   | Human focus observation remains open.                                                                                                                                                                                                                  |
| `combined-lifecycle`, `combined-target-failure`                  | Source coverage; complete multi-target host acceptance open                                                                                               | Resume only after mobile ownership lanes can safely run; source failure injection is not complete real combined-target proof.                                                                                                                          |
| `mobile-interaction`, `mobile-interaction-faults`                | Grants, attach, fencing and cancellation reviewed; no accepted mobile input                                                                               | Unknown Android/iOS driver startup and cleanup must be proved before another allocation or lifecycle-overlap check.                                                                                                                                    |
| `android-lifecycle`                                              | `91e46cf5`/`57a8d02a`/`fd35221b` dispatch but refuse mounted identity before input; latest `fd35221b` proves complete owned cleanup                       | Fresh quiet retry after reviewed self-dismissal/statusbar repair; actual marker/input/screenshots and borrowed-target behavior remain open. Historical unknown driver lane stays retained.                                                             |
| `android-visible`                                                | Not run                                                                                                                                                   | Human scheduling and safe target/driver readiness, then viewer/focus observation.                                                                                                                                                                      |
| `android-escalation`                                             | Host pass `5c34a3f5`; genuine ADB rejection, TERM/KILL and paired AVD cleanup                                                                             | Closed for this invocation; older caa/c77 assets remain retained.                                                                                                                                                                                      |
| `android-recovery`                                               | Host pass `e74e3ad9`; rotated/stale generation refusal and genuine exact-generation recovery                                                              | Closed for this invocation.                                                                                                                                                                                                                            |
| `android-quarantine`                                             | `a27a6445` lower proof passed; historical outer classification failed. `9fe36192` retained after group inspection threw                                   | Source inspection/diagnostic/liveness repair is reviewed; fixed owned group diagnostic has fresh host proof. Run this case last because unknown launch intent deliberately retains fences/assets. Historical quarantines stay preserved.               |
| `android-abrupt-exit`                                            | `60ea14d1` killed its captured controller; Oct4 supported public stop recovery proves original-generation process/device shutdown and controller disposal | Session `8f382a4c` is stopped with proved cleanup and released emulator5586. Private AVD/projection collection remains separately unproved; retain those assets.                                                                                       |
| `android-parallel`                                               | Source reservation/fixture isolation covered; host case open                                                                                              | Fresh two-project proof of distinct ports/state/reservations, borrowing and safe reuse requires cleared mobile lane.                                                                                                                                   |
| `ios-lifecycle`                                                  | `8a2dd132` reached SDK57 dispatch with complete preparation provenance; driver cleanup retained                                                           | No accepted marker/input; keep booted private target, driver/port fences and projection.                                                                                                                                                               |
| `ios-recovery`                                                   | `867632bd` failed but completely rolled back. `6f373c43` retained unreadable/live download-root uncertainty                                               | Preserve exact creation/target generations and booted simulator; no supported recovery for partially prepared unknown ownership.                                                                                                                       |
| `ios-visible`, `ios-parallel`                                    | Source coverage; host cases open                                                                                                                          | Safe device/driver readiness; separate projects and real reuse/shutdown/viewer-free and alongside-viewer evidence; visible checks need notice and observations.                                                                                        |
| `studio-canary`, hidden isolation, semantic host control         | Host pass `d4d40aeb`, `4c4aa6ac`, `8abf81d6`; quiet canary `63acc303` preserves original development Studio process identities                            | Development Studio state/content coexistence and human focus remain open; process preservation alone does not prove either.                                                                                                                            |
| Real Xcode registration probe                                    | Host pass `c11ce5a1`/`291bf663`; authenticated durable ownership before ACK; replay refused; zero backend/input; independent cleanup                      | Provenance engineering boundary closed; no consent or physical-input claim.                                                                                                                                                                            |
| Mac2 physical acceptance                                         | Source assertions/screenshots/fences reviewed; real retries stopped before accepted input                                                                 | Latest `703b22b4` has failed activation/state3 and menu-only hierarchy. Observe fresh owned Project window and normal consent/focus before another physical retry.                                                                                     |
| `studio-manual-checks`                                           | `8efebff2` proves preview and terminal cleanup                                                                                                            | Human Open Project → another window, Command-W → exactly one closure, last window → quit remain open.                                                                                                                                                  |
| Native consent/fresh prompt                                      | No fresh normal OS-prompt observation                                                                                                                     | Preserve consent. Deferred if existing consent prevents a natural prompt; no settings or policy change.                                                                                                                                                |

Fresh failures are not converted to passes by later source fixes:

1. Android quarantine `9fe36192-e68a-4259-8792-1c13b575db66`, log
   `2026-10-03T22-52-46-932Z-40005`, refused unknown recovery without signals, then failed
   `Could not send 0 to process -40294.` The actual errno was not retained in that historical
   receipt. Holder40090/helper40132/emulator40294 are independently absent. Private AVD and5584
   intent remain under generation `40132-23c93667-2474-4bf3-8c24-699ba849d374`; PID absence does
   not prove group or unpublished-descendant closure.
2. Android abrupt exit `60ea14d1-bc39-46f8-911a-5b08805bb594`, log
   `2026-10-03T22-55-41-216Z-57230`, session `8f382a4c-f1bc-4061-8049-3c6b6a5e5a24`, loop
   generation `7e135b6b-a20e-4a96-a837-713305cc88e3`, reached ready with complete provenance.
   Public stop twice refused complete group/device cleanup after the captured controller died.
   Parent57257/controller57375/emulator57495/sh59982/node60065 are independently absent, but
   device generation `57495-c9bff5ab-2e01-4a87-9f65-e207e87a7def`, serial5586, private AVD and
   `tao-managed-loop-project-myZ4BI` remain retained. Similar group-probe failure is a hypothesis;
   those receipts do not identify the failing group or errno.
3. Private iOS recovery `6f373c43-72d4-463a-ba5c-9ce5f19df4bc`, log
   `2026-10-03T22-56-25-579Z-62255`, minted `A003D662-E688-4398-853E-5D8696206702`. Create and
   boot actions closed; download capture recorded `root-unreadable`, positive PID liveness,
   no traversal and only its prior two identities. Holder62280/create62416/boot62503/download62774/
   descendant64272 are independently absent; captured bootstrap62516 remains live at its recorded
   start time. No install/shutdown/delete occurred. Retain creation generation
   `62280-f878407b-7e32-492c-9ccf-01410d1b9ae4` and target generation
   `62280-6dab7d4e-e490-4511-9baf-379b5311b216`. Independent diagnosis finds the guard behaved
   correctly; neither later absence nor a new helper can supply missing historical proof.

Shared PID liveness now accepts only ESRCH as absence; success/EPERM remain live, and unexpected
or uncoded failures throw with the original cause. Seven actual classifier and53 iOS runtime
regressions, affected AndroidRecovery2 and integrated types pass. Independent rereview is clear;
the old-classifier mutant failed both shared and all four real iOS closure-path tests before being
restored. The production iOS helper additionally retains all capture/closure exceptions and
unreadable/live bootstrap identities. Quarantine's final captured-descendant liveness gate passes26 focused cases, integrated types and
independent rereview. Missing identity requires negative PID liveness; failed observations retry
within unchanged finite deadlines, and persistent uncertainty retains bounded diagnostics and
exact fences. Five earlier guard mutations and the liveness-omission mutation failed their intended
assertions and were restored. No historical host receipt is upgraded by these source results.
The complete static verdict is recorded in `.artifacts/managed-loop-final-validation.md` after
all source, documents and generated indexes are frozen. The earlier eight-node run was rejected
because this document changed during its execution; it is not a green verdict. No full verify,
finalize, commit, landing, dependency or machine-setting change is included.

The consolidated remaining-resource receipt is
`.artifacts/managed-loop-retained-resources.md`; non-launching public state is recorded in
`.artifacts/managed-loop-final-status.json`. Nine external disposable project roots remain, plus
three private CoreSimulator directories and four protected signed-fixture Containers. Seven
private AVD directories remain inside this checkout's `.android/avd`. Each retained row records
its owner, proof condition and safe next action. Unrelated Chrome/Metro start times and the
Developer's booted iPhone were rechecked and preserved; legacy Android reservations are retained.

### Earlier measured stages — historical evidence

Lifecycle faults, quiet and visible Chrome interaction, native isolation/semantic interaction,
and real Xcode detached-WDA registration have host evidence. Mobile physical interaction,
Mac2 physical interaction, focus/consent, coexistence and the three human Studio window checks
remain open. The chronological evidence below includes superseded implementation diagnoses;
historical uncertainty is preserved rather than retrospectively upgraded.

The final iOS preparation repair passes29 runtime and39 integrated fault source cases,
with integrated typecheck and independent ownership review clear. It accepts the genuine
`Expo Go` executable basename while preserving containment/symlink refusal, and synchronously
publishes finite preparation children through the existing managed `onChild` seam. Combined
publication/output failures preserve the primary cause and retain ownership. This is source
evidence; it does not repair historical session `1cda6a87-19b3-4dde-a0db-20252ace4d29`.

Fresh quiet iOS invocation `8a2dd132-de88-4850-bd61-85cf2113c510`, log
`2026-10-03T22-29-11-932Z-69415`, installed SDK57.0.9 on minted simulator
`AC1C3640-BA58-477F-B538-EE6246365C49` and reached managed dispatch with complete provenance.
Session `cd6c93b3-e4f5-48d6-b60e-11155bf9131e`, generation
`cf23446d-5a8a-46bf-941e-ddfc88fc0c84`, then failed during driver startup/cleanup with
`Managed mobile cleanup did not finish within its finite grace period; fences remain retained.`
No driver UUID, accepted runtime-marker observation or input was proved. Public stop refused
target mutation. The booted private simulator, ports8945/9184, driver receipt and project
`tao-managed-loop-project-E1NPtT` remain retained. Eleven recorded process IDs are independently
absent; captured Xcode helper77398 remains live. That is partial closure evidence, never complete
driver/target closure. Primary peer identities remain preserved. Stop this interaction lane;
diagnose the primary startup/cancellation boundary before allocating another driver.

Warned input-free native invocation `703b22b4-79c9-4036-a32f-c44ec0c457a8`, log
`2026-10-03T22-25-53-618Z-48339`, passed its diagnostic test, with55 focused source cases
and reviewed copied-runner instrumentation. Its actual same-request counters were
`xml=0 hashes=0 resolved=0`; the expected application XML contained only a menu bar and no
window/WebView. WDA explicitly reported failed activation with application state3, Running
Background. Thus this run proves neither token-rebinding failure nor physical input acceptance.
No input occurred. Both receipts closed, and all21 captured process IDs are independently absent.
Stop physical Mac2 retries until the freshly launched owned Project window and normal focus/
consent state can be observed with the Developer. No binding, activation-loop or settings change
is justified by this evidence.

Android escalation invocation `c77e098a-9ae9-43d5-b753-d917779cded7`, log
`2026-10-03T22-21-33-852Z-23780`, proved deliberate rejection of its owned ADB kill request,
then actual TERM/KILL and target generation release. Cleanup correctly refused an immediate
stale `emulator-5582 offline` entry. Later named inventory showed5582 absent and captured
root24064 absent, but historical deletion remains unproved. Its private AVD directory exists
under this checkout's `.android/avd`, with cleanup generation
`23805-b77dd5ab-98f4-4005-83e5-e883eb56b771` retained. The proposed future fixed five-second
read-only observation window requires fresh exclusive AVD and serial cleanup leases; both
generations must be atomically checked before deletion and retained on uncertainty. Registry
acquisition/admission is outside that observation window. No historical asset is adopted or deleted.

The completed collector passes20 allocator and39 fault source cases, with restored mutations
and independent rereview clear, including refusal of diagnostic stderr. Fresh quiet escalation
`5c34a3f5-b3a7-4d1f-bdc1-77c53f644aa0`, log `2026-10-03T22-41-57-932Z-63178`, passes the real owned
ADB rejection, actual TERM/KILL, generation release and paired private-AVD deletion. Its asset
state is removed, deletion journal closed and unresolved resources empty. Independent named
probes found holder63203, emulator63408 and deletion child65809 absent; the exact AVD directory
is absent and named inventory preserves all historical and unrelated AVD names. This closes
escalation for this invocation, without closing ordinary graceful shutdown or historical cleanup.

Quiet Android recovery `e74e3ad9-a385-41f6-8f16-5bbdebe22adb`, log
`2026-10-03T22-44-37-631Z-78247`, also passes: withheld owned shutdown retained a rotated
generation, stale-generation recovery was refused before shutdown, failed proof preserved that
fence, and genuine recovery completed for the exact captured generation. Its private AVD was
removed and unresolved resources are empty; holder78284, emulator78586 and deletion child81608
are independently absent. Primary peers and historical fences were preserved.

Quarantine `a27a6445-67a0-4093-b3b5-fd2e0406ba2d`, log `2026-10-03T22-46-06-292Z-86427`, proved the
spawn-to-publication gap, killed only its captured holder, refused unknown-generation recovery
without signals and stopped only its independently captured emulator child. The lower proof
passed with its two launch-intent fences retained; the outer runner incorrectly classified any
retention as failure. That closed-catalog classification is under repair. Historical report stays
failed. Generation `86559-786fc398-dc5c-4616-9b53-e36259852c7c` owns its private AVD and5582 intent;
all3 captured process IDs are absent, but that does not close unpublished descendants. Its AVD
exists under checkout `.android/avd`; retain both fences, investigate only the recorded launch
intent, and never force-release from names, age or current ADB absence.

Independent mobile cancellation/private-cause rereview is clear after8 grant,20 diagnostic and
21 controller cases plus integrated typecheck. The iOS finite-capture review found additional
reachable bootstrap-liveness and thrown-inspection gaps. Repair missing-identity/live-PID refusal
across shutdown/restart/producer/collector gates, and latch inspection exceptions as uncertainty
even after later child/group closure. No iOS host retry is admitted until focused checks and
independent rereview clear these seams; historical evidence is not rewritten.

The complete static lane still needs a frozen-tree rerun: the earlier run passed all8 nodes but
rejected its verdict because this document changed during execution. No commit or landing.

Independent quiet iOS recovery invocation `867632bd-825a-4db5-bb77-7c95297e0ed2`, log
`2026-10-03T22-35-54-526Z-12171`, proved deliberately retained shutdown ownership and stale
generation refusal. It then failed with `Private iOS command changed root identity during
descendant capture.` The capture guard presently conflates a missing root after natural exit
with a present replacement; the historical artifact does not record that post-walk identity,
so this attempt cannot distinguish them. Rollback closed all6 finite action records, verified
shutdown and deleted its minted simulator `4F3D3C5C-A4CB-4CF8-9719-9A6323B50AC4`, with no unresolved
resources. Independent named probes found all10 captured command/holder/bootstrap IDs absent,
and the exact simulator directory is absent. The case remains failed, despite complete scoped
rollback. Review the finite command closure boundary before any retry; never adopt or signal
a replacement identity.

At21:00 the warned registration-only real Xcode probe passed4 tests/41 assertions (log
`2026-10-03T21-00-15-857Z-84901`). Original phase `c11ce5a1-31d5-46ed-99a4-6d29da361d8a`
proved the signed sandbox's channel denial. Exact-grant phase
`291bf663-3173-4990-aeea-19cacb8ece17` authenticated and durably captured the detached runner
before ACK, proved the exact socket/HID/signal signed profile, rejected replay, and made zero
backend HTTP/input calls. Both receipts are closed and private channels removed. Independent
named host probes found all90 captured build/helper/runner identities absent, including the
registered WDA runner. This closes launch-provenance engineering acceptance; Mac2 interaction
and human consent/focus remain separate. Historical failures below remain historical evidence.

Mac2 retry `49ac21d7-4772-48aa-a9cf-4c63c7a1bb7c`, log
`2026-10-03T21-02-41-300Z-10999`, registered WDA and created the driver session. App state was4
and the before screenshot was captured; initial `mac2-click-state` observation failed before any
input. The screenshot does not show Studio on the captured display; this alone cannot identify
the cause, another Space/window, or consent. Driver/server/native cleanup completed, both cleanup
receipts closed and private channel removed. Independent named probes found all51 WDA/build
captures plus the native root absent. Diagnose exact target lookup before another warned retry;
interaction and after screenshot remain unproved. No focus loop or unrelated-window changes.

The actual WDA log explicitly reports that its runner is not trusted for Accessibility and cannot
resolve WKWebView DOM IDs. The driver accepted the DOM-ID setting, but the pinned snapshot
guard returns no identifier without that separate trust. Preserve existing consent; no settings
change or repeated activation is a remedy. A fixed read-only native-source probe has been added
with explicit visible preflight, guarded reads, private bounded XML/summary and no input. Its
source gate passes50 cases and integrated typecheck. Warned read-only probe
`4167817f-7ffc-4437-9ef9-f967fa673cfd` (log `2026-10-03T21-22-58-474Z-71217`)
passed and captured32,631 bytes of private native XML, with app state4 before and after.
The exact fixture WebView and heading, waiting state and native text input were present;
DOM identifiers and the button label were empty. Fixture bounds lie outside the primary-display
screenshot. Driver/server/native receipts closed, the private channel was removed, and independent
named probes found all39 WDA/build captures plus the native root absent. No input occurred.
A narrow native element screenshot and unique fixture XPath implementation is complete;
its reviewed source checks pass, and a warned physical retry must precede interaction acceptance. DOM-ID trust
and human prompt observations remain explicit separate boundaries.

Private iOS fixture integration passes12 AppDev,35 main runner,35 fault runner,16 runtime,
13 borrowing and9 target-fault source checks. Integrated typecheck passed at21:28
(log `2026-10-03T21-28-16-295Z-7574`). Independent review found two blocking helper gaps:
preparation could overwrite the originally captured simulator bootstrap, and deletion did not
atomically include the creation fence. Both are being repaired with replacement-kernel and
late-generation regressions before any private iOS host run. SDK provenance verifies the
downloaded executable digest, not the entire application bundle. Ordinary simulator selection
and installation behavior remain unchanged; physical private SDK compatibility remains unproved.

The restored repairs now pass22 runtime,13 borrowing and9 target-fault source cases
(final logs `2026-10-03T21-39-24-615Z-4521`, `2026-10-03T21-39-05-741Z-2129`,
`2026-10-03T21-39-30-798Z-5377`). Four mutations prove forbidden bootstrap adoption,
shutdown and deletion are detected and were restored. Final independent rereview is clear:
every admitted shutdown checks the original bootstrap atomically, including a late replacement
after an earlier Shutdown observation. Missing or gone identity conservatively retains ownership.
Integrated checks of the current complete source must precede quiet iOS host acceptance.

Native screenshot/selector source passes5 controller,22 WebDriver and52 isolation cases;
five ownership/serialization/cap/cardinality mutations fail and are restored. Independent review
found one acceptance-runner issue: final-text XPath polling threw on transient absence
instead of retrying. Stable-target polling now retries the old value; the regression detects
the former behavior, final52 isolation cases pass, and independent rereview is clear.

Android escalation/recovery/quarantine now use the guarded invocation-private allocator and
reserve both console ports before launch. Existing private names require their exact creation
journal and released-generation closure proof before registry contact; unknown names are skipped.
Canonical quarantine reporting preserves both fences when publication is missing, and output-close
failure cannot skip child disposal. Final4 allocator,36 faults and9 target-fault source cases pass;
four meaningful guard mutations fail and were restored. Final independent rereview precedes hosts.
No fault route guarantees5582;
the retained5580 session and both legacy reservations must remain untouched. Non-launching public
status at21:34 still reports session `46f15709-5140-4ada-8012-5a81941775f6` in
`cleanup-failed`, with target and unknown driver ownership retained.

The installed iOS SDK loader now uses canonical shared filesystem/package helpers. It resolves
Expo from the existing Expo-host package, then resolves its CLI from that exact Expo installation.
An actual competing-toolchain import regression detects a wrong anchor; final23 runtime cases
and integrated typecheck pass. The private kernel/creation/deletion fences remain unchanged.
Source-only validation still does not establish SDK57 compatibility on the minted simulator.

The final convention pass adds shared exclusive private-file writes and file-URL conversion,
with4 filesystem regressions proving0600 files, collision/symlink preservation, missing-parent
refusal and escaped module import. Dependency-free public marker/app-module entries avoid private
cross-package imports. Native scratch fixtures retain caller-owned cleanup and explicit discovery;
cleanup18 cases pass, including survival after child exit. Existing ten browser-emitted error
exceptions were relocated to their unchanged statements; the exception scope was not broadened.
The22:00 complete static lane passed all8 nodes, including formatting, repository lint and
integrated typecheck, but rejected a green verdict because this execution document changed during
the run. A complete frozen-tree rerun remains required. No dependency/index changes.

Quiet private iOS invocation `0cdb50f8-bdad-45a2-b398-c02b9cee7619` failed before readiness.
The genuine downloaded SDK57.0.9 executable is named `Expo Go`; its safe-basename validator
incorrectly rejected spaces. A containment/symlink-preserving correction passes26 source cases
and meaningful restored mutations. All8 captured fixture identities are independently absent,
the minted device is Shutdown, and the Developer's booted iPhone remains preserved. Controller
preparation preceded its first recorded child, so historical startup provenance remains uncertain:
session `1cda6a87-19b3-4dde-a0db-20252ace4d29`, generation
`716b807a-6149-4bf6-a7d5-1d507c06fa01`, project `MhZRMD` and asset/creation records remain retained.
Future finite preparation children are being published through the existing managed `onChild`
seam, with no change to public recovery or retrospective adoption.

Warned Mac2 invocation `574adda2-95b2-4502-9f38-9437fea72b17` failed the fixture XPath before
capture/input. Its records closed and all38 captured identities are independently absent.
The pinned backend uses a detached Foundation root; embedded absolute XPath counts returned zero.
The application-ancestor count correction passes a compiled real-backend regression and review,
including duplicate fixtures across windows and duplicate controls. Warned corrected retry
`b9360725-1a0f-4591-b070-d06c03416835` still returned no native element before capture/input;
its recorded app state was3. Its records closed and all35 captured identities are independently
absent. Same-invocation source-before-lookup and counter-only copied-backend diagnostics are being
added to distinguish XML publication from snapshot-token/native-element resolution. No binding mode,
consent, activation loop, selector weakening or return behavior is changed.

Quiet Android escalation invocation `caa89a08-4c3d-426b-923e-8e279add7763` used private console
pair5582–5583 alongside retained5580 and recorded genuine TERM/KILL and both target releases.
Its captured emulator is independently absent and baseline peers preserved. The case failed because
suspension preceded serial-name proof, so the intended graceful ADB rejection was not observed.
Suspension now occurs only inside the proved owned ADB-stop interception; the source ordering and
failed-case private collector pass17 target-fault/4 allocator cases, restored mutations and review.
The historical private AVD remains listed and owned; its default diagnostic path was insufficient
disposal proof. Future cleanup uses generation/kernel/group and repeated name-absence evidence,
with diagnostic paths following configured Android directory precedence.

The future finite-parent and original-error repairs now pass7 cleanup-evidence,3 actual
parent/child-lifetime,11 startup and13 diagnostic source regressions. Removing unref, original
cause or callback preservation fails the corresponding tests and is restored. Independent review
is clear: final receipt-write rejection preserves primary failure and actual closure/release facts,
blocks target mutation on uncertainty, and never fabricates retained driver ports after proved
physical release. The old Android invocation cannot inherit this source fix retroactively.

The Developer authorized implementation of the bounded runner, managed mobile attachment/recovery,
copied WDA registration barrier, and fixed isolated native host routes. Visible Chrome, simulator,
emulator, Studio and Mac2 checks are authorized in this session with notice before each check.
Native consent and human verdicts remain separate requirements. The planning baseline below is
historical; this section records subsequent measured evidence.

| Workstream                                              | Current disposition                                                                              | Evidence and remaining boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Named routes and closed case grammar                    | Implemented; focused source checks pass                                                          | Canonical configuration adds `studio-canary` and `studio-manual-checks`; generated adapters regenerated through `fix-agent-config`. Six public `dev-loop` verbs remain. New host reach is restricted to fixed projects/cases and bounded arguments.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Managed mobile ownership/attachment/recovery            | Implemented and reviewed; live interaction blocked                                               | Holder-issued non-releasing grants, target/runtime identity, generation/kernel fencing and conservative recovery remain implemented. Grant8/Diagnostics20/Controller21, integrated types and independent review pass after separating normal input revocation from external cancellation and preserving bounded private transport causes. Fresh iOS dispatch has complete provenance, but driver creation lacks a session identity and server-group closure is unproved. Keep historical mobile target/driver fences; source evidence does not close live attachment/input.                                                                                                                                                                                                                                                                                                                                                                                               |
| Detached WDA provenance                                 | Implemented; real Xcode launch provenance proved                                                 | Real registration-only A/B at21:00 passed4 tests/41 assertions: authenticated OS peer/kernel/signed copied bundle and durable ownership before ACK, exact socket/HID/signal policy, replay refusal, zero backend/input calls. Both receipts closed/channels removed; all90 captured identities independently absent. Mac2 input and human consent/focus remain separate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Finite lifecycle/fault/Chrome runner                    | Implemented closed catalog21; lifecycle/fault/Chrome host cases pass                             | Commands, ordinary lifecycle, full corrected lifecycle faults, foreground and Chrome cases pass on the real host. Corrected public recovery proves earlier compilation-failure session `9f174c28-9969-45fd-9c2f-dd7cfd4d6b06` stopped, same generation and preserved failure history; its projection is removed. Fixed `combined-lifecycle` and `combined-target-failure` cases cover all-target readiness and partial dispatch rollback in source tests; actual borrowed-sentinel producer admission is reviewed. Mobile and combined host cases remain open.                                                                                                                                                                                                                                                                                                                                                                                                            |
| Android fixture preservation                            | Private allocation and collector reviewed; escalation and recovery host passes                   | Invocation-private names, baseline refusal and exclusive console reservations preserve retained5580 and legacy resources. Fresh5c34a3f5 proves owned ADB rejection, actual TERM/KILL, target release and complete private AVD deletion under paired cleanup generations. Independent process/directory/name checks agree. Historical caa/c77 retained assets remain untouched; their source receipts are never retroactively upgraded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Quiet isolated Studio canary                            | Real-host pass; focus unobserved                                                                 | Invocation `d4d40aeb-f27c-4c79-a748-bfee297f5822`, isolated `com.devtao.studio.test-4351d865b9f4`; capabilities and owned teardown pass, disposable projection removed. Human quiet-focus question remains unanswered.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Quiet server lifecycle                                  | Current real-host pass                                                                           | Corrected invocation `d61811ef-238c-452d-a44b-52f17efc2644`, session `a8fee2da-d2a1-4ddc-b791-0e65f5df299f`: controller survives launcher; reload preserves generation; restart rotates generation and actual Metro identity/port; stop proves all owned cleanup and controller disposal. Source projection removed,4 primary peers and2 baseline resources preserved. Earlier wrapper-classification failure remains historical evidence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Command refusals                                        | Current real-host pass                                                                           | Corrected invocation `29dbcc4f-00d6-493c-8fa7-461728c72a07` passes single-app selection and all9 allocation-free refusal checks. Session `f50020cb-7011-4986-ad4e-44bdfb5115ca` stopped with proved cleanup/controller disposal; both source projections removed,4 primary peer identities and2 baseline resources preserved. Earlier aggregate failures remain historical evidence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Quiet managed Chrome                                    | Current real-host pass                                                                           | Corrected invocation `800dca69-0790-480b-b97d-79c4f452171c`, session `5b444d8a-39c0-4946-8055-effa67af24b2`, passes exact target input/state change, six before/after screenshots, reload/restart interaction, client disconnection without browser termination, and proved browser/profile/services/controller cleanup. Projection removed and peers preserved. LAN-origin mismatch and omitted marker helper are fixed; earlier failed invocation remains historical evidence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Native acceptance entrypoint rollback                   | Implemented; source independently clear and quiet host retry passed                              | Seventeen actual-callback source regressions and meaningful mutations cover allocation failure, independent rollback, uncertain shutdown retention, repeated-run ledger preservation and canonicalization failure. Current quiet native invocation `4c4aa6ac-4b73-4658-98bd-056692aa9d97` passed capabilities and owned teardown; its unique ledger records both project and runtime removed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Visible native semantic interaction                     | Current real-host pass; human focus verdict open                                                 | Invocation `8abf81d6-a46d-465f-a410-337eaeb82377` passed real renderer input/state change, document refresh and stale-generation observation refusal, then owned native/server teardown. Visibility warning is retained in the final report.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Visible Chrome lifecycle                                | Current real-host pass; human focus verdict open                                                 | Invocation `34f42a19-71cb-4b65-901b-b571b26ed4fa`, session `753f0b09-c92a-4ae1-8957-bf4ba903b9db`, passes reload/restart with preserved `--show-browser`, owned cleanup/controller disposal and peer/resource preservation. Visibility warning is present before launch and in the final report.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Foreground compatibility                                | Current real-host pass                                                                           | Invocation `29d8f339-4cda-4e98-8593-090ef57f0bc7` starts the foreground server, proves controlled cancellation with exit130 and complete owned descendant cleanup, and preserves baseline peers/resources.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Xcode/Mac2 engineering acceptance                       | Launch provenance host pass; physical lane stopped for human window observation                  | Real signed Xcode registration is proved before backend contact. Detached-root XPath, element screenshot, uniqueness and fixed numeric diagnostic source are reviewed. Latest diagnostic703b22b4 reports failed activation/state3, menu-only XML, and xml=0 hashes=0 resolved=0; no input. All21 captured process IDs absent and private channel removed. A fresh owned-window/focus/consent observation is required before another physical retry; no binding/settings workaround.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Native manual route                                     | Corrected preview and terminal cleanup pass; human window verdicts open                          | Retry `8efebff2-7b11-4073-adfc-4db73ba11345` bundled and ran the real preview, then terminal cancellation drained native/server cleanup. Route exit0, launch exit130, stopped launch record and both disposable project ledgers removed prove automated cleanup. Its report says launched, not human acceptance. Earlier interrupted invocation `98150d6f-ce05-4b9b-a706-ad20195f265c` remains uncertain; preserve `tao-studio-native-project-eQ2DUv` and `tao-studio-native-project-BF64q7`. No manual window verdict was received.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Earlier fault lifecycle retry                           | Historical failure; uncertain fixture retained                                                   | Invocation `16f8118a-512e-4212-829f-6d65a752f1ac` proves intended compilation failure and stopped/proved recovery for session `7871faa8-eaec-463e-896c-dbbee544d37d`. Its injected Metro-failure session `e7dadc99-7927-4eca-bc03-15856f99b992` retained uncertain provenance after repeated stop; preserve source projection `tao-managed-loop-project-OEl6Kb`. Primary peers and baseline resources were unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Corrected fault adapter and disposal wait               | Source reviewed; real-host rollback and recovery pass, concurrent-control assertion under repair | Invocation `32726d52-1612-40b4-a5bd-6d159c98f63f` passes compilation/Metro/dispatch failure rollback, cancellation at all three startup phases, delayed cancellation, retained cleanup-failure recovery, authentication, stale identity refusal and serialized reloads. All nine sessions stopped with proved cleanup/controller disposal, projections removed and primary peers/resources preserved. Aggregate remains incomplete: its concurrent restart/reload assertion incorrectly required reload success while restart was starting; the actual not-ready refusal preserved the fence. Repair the harness expectation without changing control semantics.                                                                                                                                                                                                                                                                                                          |
| Real Xcode socket A/B probe                             | Original denial proved; grant connected, then strict peer check refused                          | Original phase `ad261d70-d149-4343-9a81-10368ff2b7e2` records actual EPERM errno1, no acknowledgement, zero backend/input operations and closed cleanup. Exact-grant phase `89545075-5f7c-4f91-a2b5-7e458f9d9188` connected but the helper refused before publishing/acknowledging the peer. Both records closed and channel directories were removed; independent named probes found all94 recorded build/helper identities and both XCTest runners absent. Fixed diagnostics will identify the failed peer check. Signed fixture peers separately aborted before main because signed metadata lacked a bundle identifier; repair their private signing fixture without relaxing production checks.                                                                                                                                                                                                                                                                      |
| Full corrected lifecycle fault case                     | Current real-host pass                                                                           | Invocation `71dafa2f-01af-40a5-a7c8-408c7faf4b20`, log `2026-10-03T19-59-44-143Z-39751`, passes all startup faults, cancellation phases, delayed cleanup, retained cleanup-inspection recovery, authentication, stale identity refusal, concurrent restart/reload fencing plus fresh reload, stop during restart and durable controller death/public recovery. All11 sessions stopped with proved cleanup and controller disposal; projections removed,5 primary peers and2 baseline resources preserved. Earlier uncertain receipts remain retained as historical evidence.                                                                                                                                                                                                                                                                                                                                                                                              |
| First quiet Android lifecycle                           | Dispatch and owned cleanup proved; interaction lookup failed                                     | Invocation `91e46cf5-dc14-475a-b86b-74d850550ce7`, log `2026-10-03T20-07-04-863Z-2629`, booted its private headless `emulator-5580`, installed Expo Go, bundled and dispatched the managed runtime, and created the driver session. Initial runtime-marker lookup failed before input/screenshots. The selector overescaped the literal dot through the pinned UiAutomator parser; the corrected `[.]` selector passes19 source tests and integrated typecheck, and restoring the old selector fails10 assertions. Independent review is clear; actual lookup requires a fresh host retry. Stop proved driver/device/services/controller cleanup, private AVD and project removal, preserving five primary peers and two baseline reservations.                                                                                                                                                                                                                           |
| Android boot-limit retry                                | Incomplete; stale receipt, asset ledger and project retained                                     | Invocation `243f7882-3cbb-44ae-9e45-703133aa0db0`, log `2026-10-03T20-22-47-576Z-60419`, hit the owned emulator's three-minute boot limit while host load exceeded100 on18 CPUs. Session `7ea399a5-b7a7-446a-9e5c-402e7d62245d`, loop generation `578b315c-f96e-477d-b41b-bc0e69b583e0`, records private AVD/serial generation `62169-11545446-4da1-4b2d-b4cc-016ce3a0786c`; retain its asset ledger and project `tao-managed-loop-project-xFIRYG`. Named controller/emulator/netsimd probes found recorded PIDs absent, and current registry owners are absent. Source diagnosis finds successful local startup cleanup can release reservations without publishing the released device fact. Public recovery correctly refuses the missing owner tuple. Fix future durable publication; never promote this historical receipt from current absence. Baseline five primary peers and two legacy reservations were preserved. No marker/input evidence from this attempt. |
| Android failed-startup publication repair               | Source pass and independent review clear; future host retry pending                              | Proved shutdown and successful generation-fenced recovery/release now publish the released device fact before independently fallible output cleanup. Uncertain stop/recovery/lease/publication failures preserve the original startup error and cannot claim proved release. All28 focused tests and integrated typecheck pass; six production reserve-path cases persist/read durable receipts, and three guard mutations fail then are restored. This repairs future publication and supplies no missing proof for the historical attempt.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| WDA signed-policy diagnosis and fixture cleanup         | Exact mismatch measured; native lane paused for source repair                                    | Probe log `2026-10-03T20-20-16-539Z-40311` again proves original denial in phase `3504ea2c-69f6-47d7-8a60-074c7ee492cd`. Grant phase `024d3019-ef74-4471-8b19-8eeedd3ba1d8` connects, then refuses signed policy: sandbox true, exact-rule false. Independent parsing shows Xcode adds exactly two fixed HID/signal baseline clauses to the single socket rule; the host signature has three strings while the guard requires one. Implement only exact singleton or exact baseline-plus-socket recognition. Both records closed; all86 recorded build/helper identities independently absent. Four unique signed fixture containers encountered EPERM removal and remain retained after joined peers. Replace those host fixtures with unsigned early-refusal peers and signed positive evidence from the real Xcode runner; preserve historical containers and normal OS policy.                                                                                        |
| First quiet iOS lifecycle                               | Dispatch refused before readiness; boot-lifetime cleanup proved                                  | Invocation `eda6977d-824b-416a-853f-2ab98b6156eb`, log `2026-10-03T20-37-19-476Z-90383`, booted pre-existing shutdown simulator `F9FCE14B-AC77-4E52-8E26-4889F11EE13B` without a viewer. This was ownership of its boot lifetime, not proof of invocation-created isolation; before and after inventories both show Shutdown. The prebuilt-host lookup returned404 and no installed app handled the SDK57 Expo URL. Session `b4ca216a-5c14-42fe-8b7d-9b5c2374fd41` stopped with proved simulator/services/controller cleanup; project `tao-managed-loop-project-kEddPC` was removed, five peers/two reservations and the user's booted simulator preserved. No identity/input evidence. Private minted-device SDK provisioning is being implemented only for fixed acceptance fixtures, preserving ordinary selection and installation policy.                                                                                                                            |
| Third quiet Android lifecycle                           | Runtime ready; unknown driver identity quarantined; finite parent remains referenced             | Invocation `dc724624-7471-4ec5-a451-e171f9e95d52`, session `46f15709-5140-4ada-8012-5a81941775f6`, generation `e8e26c01-78b5-455c-a4a9-956924cb84d7`, reached readiness and dispatched SDK57 Expo Go. Driver creation returned no published UUID; the original cause was masked by a generic retention error. No identity, input or screenshot acceptance occurred. Appium74669 and captured ADB75620 are independently absent; controller9629 and emulator10411 remain live. Device and driver ports4894/8269/9183 remain fenced; project `tao-managed-loop-project-dLC3QD` and private AVD assets remain retained. Preserve quarantine and stop this affected lane. Source fixes preserve the original sanitized cause and make future private-helper capture finite without releasing retained ownership. The old imported runner remains referenced and cannot acquire the future fix retroactively.                                                                  |
| Revised WDA strict policy and replay contracts          | Source reviewed; actual Xcode acceptance passed                                                  | Exact unique signed singleton/triple policy, owned in-memory replay and category-specific negative contracts pass focused tests and restored guard mutations. Actual signed runner registration before backend contact passed at21:00 with independently verified cleanup. Four historical protected fixture containers remain retained.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Mobile faults/interaction; coexistence and human checks | Blocked or pending human observation; no acceptance inferred                                     | Mobile physical input and follow-on lifecycle/recovery/parallel/viewer checks remain open after unknown driver startup/cleanup. Run independent exclusively owned fault cases only after frozen source review. Native physical Mac2 requires actual owned-window observation. Quiet/visible focus, native consent, development-Studio coexistence and the three manual window verdicts require the Developer; no answer has been recorded. Persistent unified UI controller remains deferred until post-MVP.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

The second real Xcode attempt exposed private Unix-channel access, before WDA listener startup.
The signed XCTest runner's sandbox permits IP networking but lacks this socket-path grant.
A bounded registration-only A/B probe and exact invocation socket entitlement passed source
validation and review; the real Xcode probe measured original denial and a later strict peer refusal.
This changes only the copied runner; normal Automation and Accessibility consent
still apply. The probe is now visibly classified and refuses execution without `--show-studio`.

Host load repeatedly exceeded170–370 on18 CPUs during source review corrections. A named process
inventory showed test workers from another checkout; they are preserved. Host launches are held
while pressure is extreme. No timing in this execution is a performance measurement.

Successful managed sessions have proved cleanup; their receipts/history are retained as evidence.
The failed private-worker session retains uncertain provenance and its source projection.
The compilation-failure session has subsequent proved recovery and projection removal.
The interrupted manual invocation also retains its
two disposable projects pending complete owned shutdown proof. Successful managed-loop and native disposable
projections are recorded removed in their invocation external-directory ledgers. Pre-existing
Chrome/Metro, the booted iPhone, and legacy Android fences remain outside this task's ownership.

## Outcome and scope

1. The managed lifecycle implementation is committed but has not landed. Execution should first
   establish server-only and Chrome lifecycle evidence, then complete the mobile attachment and
   recovery seams, Android/iOS acceptance, detached WDA provenance, and native human acceptance.
2. Two known source gaps block interaction: the mobile drivers cannot yet attach safely to the
   running managed runtime, and Xcode's detached WDA runner lacks captured launch provenance.
   Bounded fault tooling, target-aware interrupted recovery, genuine Mac2 input coverage, and
   isolated canary/manual host routes also need implementation or an explicit human route.
3. This plan preserves no default runtime/idle timer, target-specific `--show-*` options,
   authenticated loopback control, one resource/mutation owner, borrowed-resource preservation,
   and the post-MVP deferral of the unified UI controller. It does not cover physical phones,
   desktop app loops, release signing, distribution, or broad release QA.

The initial planning pass changed only this document. Subsequent execution is authorized above;
machine settings, dependencies, commits and landing remain outside its scope.

## Reconciled baseline and evidence limits

The [acceptance handoff](<Managed development loops - Acceptance handoff.md>) was read first.
Its matrix and the four backlog entries remain the completion contracts.

| Evidence                   | Current reconciliation                                                                                                                                                                                                            | What it does not prove                                                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Six committed chunks       | Live history confirms `8d88afc72`, `c40aadd9b`, `1c604ea10`, `0dfa6e469`, `6000eed2e`, `b13ddc54d`, following `3021ec7ed`. Working tree/index were clean before this document.                                                    | Landing, new source changes, or host acceptance.                                                                                                                          |
| Source validation          | Developer/handoff baseline: all 33 focused files and integrated typecheck passed; brief committed-diff review found no new high-confidence issues. Not rerun during planning.                                                     | Every open real-host matrix row.                                                                                                                                          |
| Loaded host permission     | Standalone `./agent unsandboxed dev-loop status --json` exited 0 with `{"sessions":[]}`.                                                                                                                                          | Start, readiness, interaction, or cleanup.                                                                                                                                |
| Host capabilities          | Named capabilities report passed: process table/liveness, port inspection, Watchman, Nix, CoreSimulator and Hutch available. Docker unavailable.                                                                                  | Chrome availability, compatible mobile images/Appium drivers, WDA launch registration, native consent, or focus. The Memory fixture requires no Docker/hosted datasource. |
| Device/Studio inventory    | `android devices` returned no attached devices. `simulators list booted` returned iPhone 17 `45EED26D-0777-4B4F-8CE2-144FD84B8938` on iOS 26.5. `studio-ps --json` reported one stopped/stale launch, no owned/undetermined PIDs. | Ownership of the booted iPhone, absence of all unrecorded Studio processes, or authorization to reclaim stale records. Preserve them.                                     |
| Historical identities      | `processes started 37085` exited 1 with empty output. PIDs 31441, 5618 and 76829 returned the same start times recorded for unrelated Chrome/Metro.                                                                               | Attribution of new processes by historical PID. The broad process report exceeded tool capture limits, so no complete-inventory absence claim is made here.               |
| Prior native host evidence | Hidden runtime probe and visible semantic host-control passed on October 2. Corrected Mac2 retry built local WDA, refused unproved detached listener, and recorded cleanup.                                                       | Mac2 interaction, consent/prompt behavior, focus, coexistence, or manual window semantics.                                                                                |
| Earlier browser evidence   | Exact Chrome clicks/screenshots and finite installed-Chrome journeys were previously exercised.                                                                                                                                   | Full managed-loop/profile cleanup or focus observations.                                                                                                                  |

Stale wording to correct during the future evidence update:

1. Backlog/local notes saying the new host prefix is unavailable are superseded by today's status
   preflight. They remain historical evidence, not a current blocker.
2. The ignored October 2 acceptance note still says all changes are uncommitted; live Git history
   supersedes it. The handoff warns to preserve an old Chrome profile, while the Chrome backlog
   records its later deletion. Neither authorizes cleanup of anything found now.
3. The handoff's uniformly open matrix is conservative: keep prior narrow native/browser passes,
   but do not use them to close the broader rows. No backlog acceptance field is closed here.

The generated [developer-environment index](<Developer environment upgrades.md>) agrees with:

| Backlog entry                                                       | Completion coverage in this plan                                                                                            |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `DEVENV-QUIET-UI-HOST-ACCEPTANCE` — In progress                     | W0–W2 lifecycle; W3/W5 iOS; W6–W8 native identity, Mac2, coexistence, focus, consent and manual checks.                     |
| `DEVENV-APP-DEV-WEB-OPENS-CHROME-IN-THE-FOREGROUND` — In progress   | W2 exact managed Chrome, graceful profile/server cleanup, unrelated-process preservation; W8 quiet/visible focus.           |
| `DEVENV-ANDROID-EMULATOR-LEASE-RELEASE-PRECEDES-EXIT` — In progress | W3/W4 shutdown/escalation, abrupt exit, publication quarantine, parallel reservations, recovery, managed screenshots/input. |
| `DEVENV-PERSISTENT-UI-CONTROLLER-POST-MVP` — Planned/Deferred       | Preserve its deferral. Finite acceptance adapters below do not implement a general persistent interaction service.          |

## Execution rules, evidence and resource accounting

1. Stay on shared `dev/ro`; reinspect Git before each source slice. Preserve concurrent files and
   index entries, particularly the HNReader sketches and `@/studio/View3.tao`. Use Data MVP or
   task-owned disposable fixtures, never HNReader as an acceptance workaround. Read package
   guidance before package edits. No dependency/version/lockfile change is included.
2. All command blocks below are **future execution instructions** except the explicitly reported
   planning preflight. Run from the shown directory. Invoke host operations standalone and capture
   tool results; do not redirect/pipeline them to evade the host probe. No raw host signals,
   private worker entrypoints, arbitrary control URLs, or credential reads in chat.
3. Record each case under `.artifacts/host-acceptance/managed-loops/<run-id>/`: source commit and
   dirty task diff, exact argv, exit codes, sanitized stdout/stderr, session/generation, app/source
   identity, readiness/target dispatch, kernel process identities, device/resource generations,
   driver identity, screenshots, control ordering, cleanup outcome and unchanged peer identities.
   Separate labels: **source regression**, **real-host pass/failure**, **capability blocked**,
   **consent deferred/denied**, **human observed**, **not run**. A start receipt, dispatch success,
   log message or driver session creation is never rendered-interaction proof.
4. Capture complete process/resource inventories internally in the bounded acceptance runner and
   emit sanitized scoped results. Do not infer absence from a clipped terminal report. Keep local
   control and registration capabilities private (`0700` roots, `0600` files), out of receipts,
   retained history, command output and logs. No private control files are copied to evidence.
5. Add a task-local external-directory ledger during execution: exact path, owner/invocation,
   purpose, activity, cleanup condition and final disposition. Preserve reusable AVDs, unknown
   Chrome profiles, shared DerivedData, Appium Strongbox/version state and unrelated caches.
   This planning task created no external directory. Repository command logs remain checkout-local.
6. Every case has a bounded startup/action/shutdown observation budget; timeout means failure or
   deferred evidence, never an automatic session lifetime. Stop via named controls when no longer
   useful. Release resource fences only after authoritative owned shutdown. If identity, complete
   descendant coverage, driver deletion, or target shutdown is uncertain, retain/quarantine and
   report the current generation and safe next action. Do not prune evidence to make a case pass.
7. Serialize mutation on each target and machine-wide physical input. Run resource-intensive mobile
   and native builds sequentially. Explicit reservation-isolation cases may start two owned loops,
   but do not run physical input concurrently. Human focus observations run without competing UI
   automation. A busy lease refuses/defer; never steal it.
   Parallel loops require separate task-owned Data MVP source projections/project realpaths:
   `dev-command.ts` acquires an exclusive `ProjectDevSession` for the selected project. Two starts
   against the one checked-in fixture cannot prove device parallelism. The finite runner prepares
   discoverable projections through existing fixture helpers, records any required host-temporary
   roots, and removes them only after project/process/device cleanup. Test same-project refusal
   separately. The ordinary checked-in fixture command examples are for serial cases.
8. Stop the affected lane on ownership mismatch, unexpected focus/window, unapproved consent need,
   unsafe teardown, or unrelated-resource change. Run independent owned rollback even if another
   cleanup step fails. Continue independent quiet work only if it cannot worsen retained ownership.

## Sequencing and source ownership

| Workstream                                  | Prerequisite                                      | Exclusive source responsibility during implementation                                                                                  | Review/stopping point                                                     |
| ------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| W0 inventory and access                     | Execution authorization                           | No source edits                                                                                                                        | Snapshot resources/permissions; stop on unsupported host access.          |
| W1 finite acceptance plumbing and lifecycle | W0                                                | `dev-cli` dev-loop modules, finite proof orchestration and CLI wiring; shared typed control; host grammar/help only for approved reach | Review bounded faults/authentication before any fault host run.           |
| W2 Chrome                                   | W1 ordinary lifecycle                             | Expo Chrome launch/target reporting, finite CDP adapter; retain existing `StudioCdp.attach`                                            | Review evidence/cleanup before mobile.                                    |
| W3 managed mobile attachment/recovery       | W1                                                | Reservation holders, typed transient delegation, mobile attach drivers, target dispatch identity, generation-aware recovery            | Review lease/runtime contract and source regressions before device input. |
| W4 Android                                  | W3; ordinary lifecycle can precede attachment     | Android ownership/recovery and Android proof cases                                                                                     | No new session on quarantined AVD/serial.                                 |
| W5 iOS                                      | W3; ordinary lifecycle can precede attachment     | iOS reservation/recovery and iOS proof cases                                                                                           | Preserve borrowed iPhone/viewer; no unsupported recovery.                 |
| W6 detached WDA provenance                  | W0; independent of W3                             | Native WDA bootstrap/guard and focused regressions                                                                                     | Prove registration before any backend HTTP or Mac2 attachment.            |
| W7 native isolation/Mac2                    | W6 for Mac2; hidden/semantic paths may precede it | Native launch/test identity/projection, smoke behavior, bounded canary/manual routes                                                   | Physical-input proof and clean shutdown before human closure.             |
| W8 human focus/consent/coexistence/manual   | W2/W4/W5/W7 plus scoped visible authorization     | Only necessary fixes in the owning seam; human evidence                                                                                | Pause on revocation; never change host settings to force a pass.          |
| W9 evidence/backlog/handoff                 | All applicable rows have disposition              | Owning backlog entry files and task evidence                                                                                           | Stop for commit/landing decision; no automatic landing.                   |

Use read-only reviews at the mobile/controller and native/bootstrap boundaries. Do not concurrently
assign overlapping `dev.ts`, shared control, permission/help, or ledger files to different writers.
After execution approval, create the progress ledger through `progress-report`; report weighted
completed acceptance, keeping blocked human/host rows visible. No progress percentage substitutes
for the row-by-row disposition.

## W0 — Non-launching baseline and loaded access

Run again at execution start; today's result is not a future inventory:

```sh
cd "$HOME/code/tao-lang-2"
git status --short --branch
git log -8 --oneline
./agent help
./agent unsandboxed dev-loop status --json
./agent unsandboxed capabilities
./agent unsandboxed studio-ps --json
./agent unsandboxed android devices
./agent unsandboxed android emulators
./agent unsandboxed simulators list available --json
./agent unsandboxed processes list
./agent unsandboxed processes started 37085
```

Record currently active unrelated Chrome/Metro/Studio and devices with current identities, not just
these historical selectors. The last command checks absence only; never adopt/reclaim a process
if that PID exists again. If terminal inventory clips, record that limit and use the reviewed
finite runner's complete scoped inventory; do not claim all historical/native processes absent.

Permission: existing named read-only operations. Human involvement: none unless access is refused.
Stop on sandbox/unsupported operation and report the exact refusal; do not disable the wrapper,
change permissions broadly, start Docker, install tools, or change Xcode selection.

## W1 — Finite acceptance tooling and managed lifecycle

### Implementation boundary

Current source already serializes controls, fences generations, supports stop preemption and
recovers interrupted controllers. Public grammar has only six verbs; there is no fault or driver
attachment command. Extend the existing **finite** `test-host` entry with a bounded managed-loop
proof mode, orchestrated in `dev-cli` so `e2e-testing` does not import the CLI back. Reuse existing
drivers and source-test operation seams. Do not create a general command/script executor.

Proposed interface, **not implemented or callable at this snapshot**:

```sh
cd "$HOME/code/tao-lang-2"
./agent unsandboxed test-host managed-loop --case commands
./agent unsandboxed test-host managed-loop --case lifecycle
./agent unsandboxed test-host managed-loop --case lifecycle-faults
./agent unsandboxed test-host managed-loop --case foreground-compatibility
```

Make `--case` a closed enum; fault cases may affect only sessions/fixtures created by that proof
invocation. A supplied session is allowed only for non-destructive managed interaction, validated
against checkout/session/generation and live reservation holder. Never accept arbitrary PID,
endpoint, shell, executable, environment override, or user-owned session for fault injection.
Capture stdout/stderr separately internally, including initial/final warnings and clipped nested
reports. Invalid case/argument/visibility combinations refuse before allocation.

Fault seams must reproduce compilation failure, Metro readiness failure, requested-target dispatch
failure, pauses at startup stages, worker/controller death, failed cleanup, delayed cancellation,
and owned TERM/KILL behavior. Inject at the existing operations layer, with owned real host
processes/devices where the row requires host proof. Record which failure was injected; do not call
a mocked process result real graceful shutdown. Existing `test-host --fault` is an application
journey fault, not a managed-loop lifecycle fault.

Source ownership:

1. `packages/cli/dev-cli/dev-cli-src/dev-loop/{DevLoopCommand,DevLoopController,DevLoopWorker,DevLoopStore,DevLoopRecovery}.ts`;
   new finite proof orchestration beside these modules; wiring in `dev-cli-src/dev.ts`.
2. `packages/shared/shared-src/DevLoopControl.ts`; `packages/cli/agent-cli/agent-cli-src/agent-config/DevLoopArgs.ts`,
   `HostCommandTargets.ts`, `cli/agent-host-dispatch.ts`, `cli/agent-help.ts` only as necessary for
   the approved bounded behavior. Preserve the existing six public `dev-loop` verbs.
3. Expo readiness hooks in `packages/apps/expo-host/expo-host-src/dev-loop/expo-dev-loop.ts` and
   server/Metro/target seams; app selection stays in `packages/cli/tao-cli/cli-src/dev-command.ts`.

Permissions: implementing the new reachable `test-host` behavior requires explicit execution
approval naming this scope. If canonical permission changes are necessary, edit only `.rulesync/`
sources and regenerate with `./agent setup`; never hand-edit adapters. No arbitrary host signals
are granted to the harness. The runner itself checks captured ownership before controlled signals.

### Existing ordinary lifecycle commands

The checked-in fixture declares `DataMVPApp` and uses Memory. Run one start, record its returned
UUID, then use that UUID below. Shell variables are local convenience, not control credentials.

```sh
cd "$HOME/code/tao-lang-2"
./agent unsandboxed dev-loop start "Apps/Test Apps/Data MVP" --app DataMVPApp --json
```

```sh
cd "$HOME/code/tao-lang-2"
SESSION='<UUID returned by the selected start command>'
./agent unsandboxed dev-loop status --session "$SESSION" --json
./agent unsandboxed dev-loop logs --session "$SESSION" --lines 200
./agent unsandboxed dev-loop logs --session "$SESSION" --lines 200 --json
./agent unsandboxed dev-loop reload --session "$SESSION" --json
./agent unsandboxed dev-loop restart --session "$SESSION" --json
./agent unsandboxed dev-loop stop --session "$SESSION" --json
./agent unsandboxed dev-loop status --session "$SESSION" --json
```

Issue controls only at the intended state; this block is a command catalog, not a script that
skips readiness. Use bounded status observation, not a background gate/sleep polling loop.

### Required lifecycle cases

| Case                      | Evidence required                                                                                                                                                                                                                                                                                                                                                                                               | Cleanup/stopping criterion                                                                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Selection/grammar         | A task-owned single-app fixture without `--app` selects deterministically; controlled ambiguous fixture refuses with candidates and `--app` guidance; unknown app, duplicate/invalid flags, missing UUID, private verbs and JSON-follow refuse before device/service allocation. The checked-in Data MVP folder has both DataMVPApp and EnumFields, so keep its explicit `--app DataMVPApp` for ordinary cases. | No process/profile/device/lease delta after each refusal. Do not test ambiguity by launching the whole repository.                                                    |
| Foreground compatibility  | Owned finite fixture starts the real foreground path with supported arguments; normal foreground behavior remains. Managed selection is prompt-free.                                                                                                                                                                                                                                                            | Runner supplies controlled stdin/cancellation to its own child and proves cleanup; never depend on harness terminal Ctrl-C or launch an uncontrolled foreground loop. |
| Survival/readiness        | Finite start process exits; controller and reservations survive; compilation, Metro and every requested target dispatch precede `ready`. Exercise each target separately, then combined web+iOS+Android on owned targets.                                                                                                                                                                                       | Stop every session; dispatch failure prevents `ready` and rolls back all previously allocated targets.                                                                |
| Readiness failure         | Real invalid disposable Tao source; controlled Metro failure; one target failing in a combined request. Logs/report preserve phase and warnings.                                                                                                                                                                                                                                                                | No false ready, complete independent rollback; retain if any shutdown is unproved.                                                                                    |
| Stop during startup       | Pause at selection/reservation/boot/compile/Metro/dispatch and issue `stop`; repeat stop joins one completion.                                                                                                                                                                                                                                                                                                  | No late dispatch; no reservation release before owned close/shutdown.                                                                                                 |
| Reload/restart            | Reload keeps session/generation/service identities and produces an observed app reload. Restart keeps UUID/configuration/visibility, advances generation and replaces owned services only after cleanup.                                                                                                                                                                                                        | Reject overlap/stale clients; new readiness and interaction evidence required after restart.                                                                          |
| Concurrent controls       | Two reloads, two stops, restart+reload and stop preempting restart/start; record actual queue order and bounded completion.                                                                                                                                                                                                                                                                                     | No duplicate cleanup, deadlock, stray generation, or late write into the successor.                                                                                   |
| Authentication/fencing    | Real loopback-only listener; missing/wrong capability, stale worker/event/control generation and wrong controller identity refuse. Private root/file modes and redacted reports hold.                                                                                                                                                                                                                           | Runner uses internal clients; never print/replay private credentials through shell/chat.                                                                              |
| PID identity              | Deterministic source PID-reuse tests plus host refusal of a controlled stale identity for an owned disposable peer; demonstrate the live peer is unsignaled.                                                                                                                                                                                                                                                    | Do not force OS PID allocation or falsify arbitrary user records. Literal PID recycling is claimed only if actually observed; injected mismatch is labeled.           |
| Interrupted recovery      | Kill only the proof-owned worker/controller after durable identity publication; `status` reports interruption and `stop` uses locked identity recovery. Race recovery with successor generation.                                                                                                                                                                                                                | No deletion of successor credentials/records, no restart before process **and device** cleanup.                                                                       |
| Cleanup failure/retention | Controlled shutdown/inspection failure yields retained/unknown ownership; credentials are retained if disposal proof fails. Test retry while live peers exist.                                                                                                                                                                                                                                                  | No forced release; record exact remaining owner/generation and allowed recovery route.                                                                                |
| Unrelated preservation    | Owned disposable sentinel Chrome/Metro plus currently unrelated host identities before/after ordinary/fault cases.                                                                                                                                                                                                                                                                                              | Only owned resources change. Unrelated-process damage halts the lane.                                                                                                 |

Source tests already cover much of this; source replay does not close these host rows. Human
involvement: none for quiet lifecycle; foreground runner must remain controllable and window-free.
Stop for review after ordinary lifecycle or any reproduced defect before widening source scope.

## W2 — Exact managed Chrome, reload/restart and full cleanup

Dependencies: ordinary W1, installed Chrome and working CDP. Source owners are
`expo-runner/AgentChrome.ts`, `expo-runner/run-targets.ts`, finite managed proof adapter and, only
if needed, `packages/ides/studio-tooling/studio-tooling-src/StudioCdp.ts`.

`AgentChrome.ts` owns a UUID profile and bounded TERM/KILL close before deletion.
`StudioCdp.attach()` disconnects its transport on close; it does not own/stop the attached browser.
DevTools is currently printed in loop logs rather than a typed receipt field. The finite adapter
must bind the observed endpoint to the current session's Chrome process/profile and target URL;
add a sanitized typed target receipt if log discovery cannot prove that association. An in-app
tab opened at the app URL is a separate session and does not satisfy this row.

Existing start:

```sh
cd "$HOME/code/tao-lang-2"
./agent unsandboxed dev-loop start "Apps/Test Apps/Data MVP" --app DataMVPApp --web --json
```

After the bounded proof mode is approved and implemented:

```sh
cd "$HOME/code/tao-lang-2"
SESSION='<current managed web session UUID>'
./agent unsandboxed test-host managed-loop --case chrome --session "$SESSION"
```

1. Attach existing CDP to this Chrome only; capture before/after images, type a unique workspace
   name, press Add workspace, assert that name appears, and remove the fixture row. Record console
   errors, app/source identity, target URL, Chrome identity/profile and current generation.
2. Reload through the public control and re-observe the app; record the actual runtime's reset/
   preservation behavior without introducing a new semantic requirement. Restart, reattach only
   to the successor generation, and repeat input/screenshot. Old attachment must fail or disconnect.
3. Close the CDP client and prove the borrowed browser remains alive. Stop the loop through W1's
   catalog; prove Chrome/descendants, Metro/compiler/controller and their ports stopped, active
   control credentials disposed, owned profile removed, and durable receipt/log history retained.
4. Repeat failed Chrome launch/failed cleanup through the bounded fault runner. Preserve the
   profile if process close is unproved. Preserve unrelated Chrome/Metro and shared caches.
5. Quiet launch/focus and authorized `--show-browser` behavior are W8 observations. If a visible
   launch activates Chrome, report that measured behavior; do not change window-manager settings.

Permission: existing named loop lifecycle plus approved finite proof behavior. Quiet CDP needs
no visible authorization. Human involvement: focus observation in W8. Stop on endpoint ownership
mismatch before CDP contact; do not attach the user's Chrome debug endpoint.

## W3 — Managed mobile interaction and retained target recovery

### Current gap and minimal source work

The existing `preheldTargetLease` seam is consumed by both controllers. The finite proof supplies
a non-releasing wrapper (`AppiumNativeHostProofCommand.ts:81,99,488–496`), but first builds and
installs its own isolated application. Android also validates an isolated app ID, artifact digest
and proof-local APK (`AppiumAndroidController.ts:625–637`). Managed dispatch may instead open
Companion/Expo Go (`expo-runner/run-targets.ts:99–151`). Passing a lease alone would exercise the
wrong runtime and weaken the existing isolated-build contract.

1. Add a scoped delegation callback at the actual reservation holders:
   `dev-cli-src/simulators/AgentAppDev.ts` for iOS and `AgentAndroidEmulator.ts` for Android.
   Android delegation must assert both AVD and emulator-serial ownership; keep those fences intact.
   Extend typed internal worker/controller messages as necessary, never a public raw endpoint.
2. Delegate a revocable, non-releasing lease view from the live holder to a **finite** proof.
   Bind session UUID, checkout realpath, loop generation, target ID, resource generation and
   allowed fixture action sequence. Each attach, observation, action, screenshot and deletion
   checks current ownership. No second acquire of the held exclusive target and no global lease
   release to let Appium in. The loop remains the only target-release owner.
3. Add explicit managed-attach construction to existing iOS/Android controllers under
   `packages/testing/e2e-testing/native/appium/` and `native/appium-android/`. Keep the isolated
   build/install proof constructor strict. Managed attach must verify the actual dispatched
   runtime identifier, dev URL/project/app selection and source revision; use existing host
   diagnostics/handshake or add the smallest typed runtime identity receipt. No uninstall,
   reinstall, reset, alternate proof app, or new runtime chosen to make the test pass.
4. Permit Appium to own only its driver session/server/ports and bounded input on that target.
   Existing driver teardown must not terminate/reset the borrowed managed runtime. Preserve
   unrelated device apps/data. For each supported runtime encountered, prove attach/preserve
   behavior or record a capability blocker; Companion proof does not silently cover Expo Go.
5. Controller mutation queue cancels and drains interaction before reload/restart/stop; driver
   mutations serialize inside that grant. Stop interrupts a hung proof within a bounded cleanup
   budget. Driver failure closes owned Appium resources; uncertain remote deletion retains driver
   fences and blocks further target mutation. Loop/holder death invalidates the grant. Never let
   a failed proof release the target while the manager is live or teardown is unproved.
6. Persist target/resource-generation information needed for interrupted recovery in the durable
   receipt before boot/dispatch. Current `DevLoopRecovery.ts` deliberately cannot mark owned
   devices released merely because process recovery completed. Integrate verified Android recovery
   and a narrowly checked iOS recovery into `dev-loop stop`, or keep a documented safe retained
   result where no proof is possible. Do not introduce an unconditional device release.
7. iOS recovery may act only on the recorded owned device with matching retained generation and
   dead old holder; confirm CoreSimulator shutdown and resource-generation continuity before
   release. Borrowed devices remain booted. If ownership was never published or a peer now owns
   it, quarantine/refuse. No current named iOS fence-recovery command exists; do not invent one
   in execution. Implement this bounded behavior under existing `stop` only after approval.

Additional owners: `packages/testing/host-control/host-control-src/MachineResources.ts` only for
necessary lease-view/recovery support; `packages/testing/appium-driver/appium-driver-src/` for
driver-only cleanup; Expo target receipt producers; shared control/store; focused regressions.
`e2e-testing` remains reusable and does not import `dev-cli`. No unified UI API or new dependency.

### Finite proof and source review

Proposed commands, unavailable until W1/W3 implementation and approval:

```sh
cd "$HOME/code/tao-lang-2"
SESSION='<ready managed mobile session UUID>'
./agent unsandboxed test-host managed-loop --case mobile-interaction --session "$SESSION" --target android
./agent unsandboxed test-host managed-loop --case mobile-interaction --session "$SESSION" --target ios
./agent unsandboxed test-host managed-loop --case mobile-interaction-faults
```

The normal case uses Data MVP's workspace-name input, Add workspace action and resulting row;
capture before/after screenshots from the same running target. Confirm session/runtime/source
identity, close only the driver, demonstrate continued managed runtime use, then public reload/
restart with grant revocation and repeat attachment. Fault case creates its own loop and tests
driver failure, delayed action, stop/restart overlap, lease loss, controller exit, stale grant and
uncertain driver deletion. A separate `test-host android|ios` journey after stop is optional driver
diagnosis only and never closes managed interaction.

Acceptance: one target owner throughout; driver port/session isolation; no release by delegated
lease; stale action rejected; stop drains both lifecycles; uncertain cleanup retains rather than
launching another mutator. Permissions: approval must name this new managed-attach/recovery reach.
Human involvement: none unless native consent/focus appears; then W8. Stop after contract/source
review before live input. If runtime identity or safe attach cannot be proved, finish independent
lifecycle cases and report this exact blocker; do not weaken isolated-build validation.

## W4 — Android lifecycle, escalation, durable abrupt exit and recovery

Dependencies: W1 for lifecycle/fault runner, W3 for input/recovery. Source ownership:
`AgentAndroidEmulator.ts`, `AndroidRecovery.ts`, Android reservations/receipt producers and the
Android finite cases. Shared pool AVDs are reusable infrastructure, not disposable test directories.

Existing commands:

```sh
cd "$HOME/code/tao-lang-2"
./agent unsandboxed dev-loop start "Apps/Test Apps/Data MVP" --app DataMVPApp --android --json
```

For an explicitly authorized currently booted borrowed emulator, recheck its identity first:

```sh
cd "$HOME/code/tao-lang-2"
SERIAL='<verified booted emulator serial, such as emulator-5554>'
./agent unsandboxed dev-loop start "Apps/Test Apps/Data MVP" --app DataMVPApp --android --emulator "$SERIAL" --json
```

Proposed finite cases, after W1/W3:

```sh
cd "$HOME/code/tao-lang-2"
./agent unsandboxed test-host managed-loop --case android-lifecycle
./agent unsandboxed test-host managed-loop --case android-escalation
./agent unsandboxed test-host managed-loop --case android-abrupt-exit
./agent unsandboxed test-host managed-loop --case android-quarantine
./agent unsandboxed test-host managed-loop --case android-recovery
./agent unsandboxed test-host managed-loop --case android-parallel
```

| Required case         | Real-host evidence and cleanup criterion                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Graceful owned stop   | Headless boot/app dispatch, managed input/screenshots through W3, bounded ADB stop, authoritative parent/descendant close and listener disappearance before both serial/AVD leases become reusable.                                                                                                                                                                                                       |
| Escalation            | Controlled owned ADB stop failure/timeout; real TERM and, in a separately owned resistant-process fixture, KILL. Record signal attempts and observed close. Emulator TERM/KILL coverage is claimed only for stages actually exercised on the owned emulator; helper-only evidence stays separate.                                                                                                         |
| Startup failure       | Failure before boot-ready/runtime dispatch rolls back already owned processes and services. Failed shutdown retains both fences.                                                                                                                                                                                                                                                                          |
| Durable abrupt exit   | Kill only proof-owned parent/worker/controller after AVD intent and child identities are durably published; observe retained/recoverable state. Include death while descendants remain. No terminal cancellation assumption.                                                                                                                                                                              |
| Spawn/publication gap | Pause precisely after spawn and before verified identity publication, terminate proof-owned parent. Durable intent remains quarantined; competing acquisition refuses. This gap is deliberately **not** automatically recoverable. Runner retains its independently captured test-process provenance for eventual exact owned rollback, without teaching production recovery to adopt by AVD/serial/path. |
| Parallel/isolation    | Two explicitly proof-owned loops use distinct AVD/serial reservations, Metro/Appium ports and app state. A third contender for a held explicit target refuses. After proved shutdown, demonstrate safe port/slot reuse and stale generation refusal. Input remains serial per device.                                                                                                                     |
| Borrowed target       | Use a proof-owned long-lived sentinel emulator or explicitly authorized borrowed target. Loop and driver close without stopping that emulator or resetting unrelated apps. Stop the sentinel only through its own owner after observation.                                                                                                                                                                |
| Retained recovery     | Failed cleanup publishes rotated generation; live peer, wrong generation, recycled serial and unknown descendant attempts refuse without effect. Matching generation with stopped, completely known processes recovers fences. Unknown-descendant quarantine stays retained.                                                                                                                              |

Supported retained Android recovery, only for a recorded identifiable owner:

```sh
cd "$HOME/code/tao-lang-2"
AVD='<recorded retained owned AVD name>'
GENERATION='<current retained generation from its receipt>'
./agent unsandboxed android recover --avd "$AVD" --generation "$GENERATION"
```

After successful target recovery, retry session `stop` and confirm its current receipt. Never
invent a `dev-loop recover` verb or equate ADB absence with fence release. Any missing reconciliation
between Android recovery and session receipts is a W3 source fix, followed by focused review.

Permissions: existing named commands plus approved bounded fault reach. No new emulator installation
or dependency is authorized by this plan. Human involvement: explicit emulator viewer/focus and
any native prompt in W8. Stop before reuse if either target fence or descendant ownership remains
uncertain; list retained generation, proof artifacts and next safe investigation.

## W5 — iOS reuse, parallel isolation, ownership and viewers

Dependencies: W1, W3 for managed input/recovery; available compatible runtime. Source ownership:
`AgentAppDev.ts` simulator reservation/boot/shutdown, Expo simulator target dispatch, W3 recovery
and finite iOS cases. Viewer launch remains separate from device boot.

Existing start and explicit borrowing:

```sh
cd "$HOME/code/tao-lang-2"
./agent unsandboxed dev-loop start "Apps/Test Apps/Data MVP" --app DataMVPApp --ios --json
```

```sh
cd "$HOME/code/tao-lang-2"
UDID='<explicitly authorized verified simulator UUID>'
./agent unsandboxed dev-loop start "Apps/Test Apps/Data MVP" --app DataMVPApp --ios --simulator "$UDID" --json
```

Do not assume today's booted iPhone is authorized for input/installation. Prefer a proof-owned
sentinel simulator for borrowing; a human may authorize the existing one specifically.

Proposed finite cases after W1/W3:

```sh
cd "$HOME/code/tao-lang-2"
./agent unsandboxed test-host managed-loop --case ios-lifecycle
./agent unsandboxed test-host managed-loop --case ios-parallel
./agent unsandboxed test-host managed-loop --case ios-recovery
```

1. Select/reuse an available shut-down simulator before creating another; record UDID and boot
   ownership. Prove managed app dispatch and W3 screenshots/input. Stop must verify Shutdown before
   releasing owned fences; shared reusable devices remain available rather than deleted.
2. Start two proof-owned loops with different simulator reservations/ports/state. Refuse a contender
   for the same explicit UDID. Stop one while the other remains interactive; repeat slot reuse.
3. Borrow a verified booted simulator: release only the loop's reservation and driver resources,
   leaving device and unrelated app state intact. An explicitly selected device is never shut down
   merely because this loop booted it; preserve recorded borrowing semantics.
4. Exercise failed boot, stop during boot/install/open-URL, failed shutdown and interrupted holder.
   Verify preboot durable intent, retained generation, no automatic reuse on uncertainty and safe
   generation-checked recovery through the reviewed W3 `stop` behavior. Current code's conservative
   retained result is valid refusal evidence, not completed automatic target recovery.
5. Observe viewer-free execution twice: with no Simulator viewer and with a pre-existing viewer.
   Record whether that viewer attaches to/raises the new device. Do not close the user's viewer
   to manufacture invisibility. Authorized inactive viewer/focus observation is W8.

Permission: named loop and simulator diagnostic operations; approved W3 recovery/attach reach.
Human involvement: existing-viewer and inactive-focus observations. Stop on unavailable runtime,
unproved reservation, or a viewer unexpectedly taking focus; report it before further launch.

## W6 — Reliable detached WDA provenance before contact

Dependencies: W0, pinned WDA source/Xcode; no dependency upgrade. Current
`StudioMac2TestRun.ts:148–194` admits a listener only if its kernel identity was captured in the
owned xcodebuild tree. That safe guard rejects detached Xcode runners. The continuously owned
frontend is inline at `:359–415`; there is no separate `OwnedWdaFrontend` module to modify.

### Proposed launch-registration barrier

1. First run a bounded engineering spike in the copied pinned WDA project. Identify a pre-listener
   runner entry point, verify Xcode test-environment propagation, and verify an available local
   macOS registration transport that exposes **OS-authenticated peer PID/identity**. These are
   implementation hypotheses until measured; do not assume Xcode inherits every shell variable.
2. Before Xcode launch, create an invocation-private registration channel, one-use capability and
   expected generation. Modify only the invocation's copied WDA bootstrap source/configuration,
   retaining source/build digests and invocation-local DerivedData. Do not edit installed driver
   source, shared caches or Strongbox metadata.
3. The runner registers before binding the WDA backend and waits for acknowledgement. Authenticate
   the one-use capability/generation and derive its PID from the OS peer, capture/recheck kernel
   start identity, and tie the loaded runner/test bundle to the invocation's built artifacts.
   Add that identity durably to the existing owned set, then acknowledge listener startup.
   A JSON-declared PID, Xcode log line, executable path, healthy `/status`, or matching leased port
   alone cannot establish provenance. No retrospective adoption of an already-listening runner.
4. If transport requires a native helper, keep it repository-owned and narrowly limited to this
   registration/identity task, using existing platform facilities. Review it independently. A new
   package dependency/version or broader host operation needs a separate decision.
5. Keep `ownedListener()` as the HTTP admission gate. Recheck current peer/kernel/listener identity
   and desktop generation before every status/session/action/delete request. Retain private
   loopback frontend, redirect rejection, serialized physical input, and external
   `appium:webDriverAgentMacUrl` attachment. Never reenable the driver's unowned-listener DELETE.
6. Wrong/replayed generation/capability, missing registration, unverifiable peer, controller exit,
   competing backend listener or failure before registration leaves forwarding disabled. Signal
   only already captured identities. If detached shutdown/absence cannot be proved, quarantine
   port/input fences and artifacts. Path-scoped inventory can corroborate absence, never authorize
   signaling an unregistered runner. Continue independent Appium/Studio/fixture cleanup.
7. Disable/abort forwarding before teardown; keep frontend inert/bound until Appium shutdown is
   proved, so a reused port never receives a late driver request. Join one cleanup completion and
   release only after registered runner, captured Xcode children, listener and Appium are gone.

Source ownership: `packages/ides/studio-tooling/studio-tooling-src/StudioMac2TestRun.ts`, a narrowly
scoped bootstrap/registration helper beside it, `studio-tooling-tests/studio-mac2-test-isolation.test.ts`,
and necessary Mac2 smoke wiring. `ProcessTree`/machine-resource support changes require seam review.

Focused source commands after implementation:

```sh
cd "$HOME/code/tao-lang-2"
./agent test-file packages/ides/studio-tooling/studio-tooling-tests/studio-mac2-test-isolation.test.ts
./agent test-file packages/testing/host-control/host-control-tests/MachineResources.test.ts
./agent typecheck
```

Regressions must reject fake/replayed peer, wrong kernel identity, lost acknowledgement,
generation change, redirected request, late Appium traffic, pre-registration death and failed
rollback; removing an ownership guard should break a meaningful assertion. Source tests do not
prove that the real Xcode runner registers. After source review, use W7's actual Mac2 smoke for
the first approved launch; record provenance before any backend request.

Permission: execution approval must explicitly include WDA bootstrap/launch behavior reached
through `studio-smoke`. Human involvement: scoped native visibility/brief focus and OS consent.
Stop the spike if OS-authenticated peer identity or pre-bind barrier cannot be implemented with
the pinned topology; return the evidence and a bounded alternative proposal. Do not loosen guards.

## W7 — Every native launch path, isolation and genuine Mac2 input

Dependencies: W6 for Mac2; hidden/semantic checks can run sooner after execution authorization.
Owners: `StudioNativeIdentity`, `StudioNativeTestRun`, `StudioDev`, `StudioNative`, `StudioSmoke`,
`StudioCanary`, `StudioCanaryCommand`, `StudioManualChecks`, launch manifest, their focused tests
and native smoke files under `packages/ides/studio-tooling/`. Driver-owned input remains in
`packages/testing/appium-driver/appium-driver-src/AppiumMac2HostController.ts`.

1. Audit/run smoke, hidden simulated-user, canary, visible semantic, Mac2 and manual entry paths.
   Verify stable checkout-realpath test identity distinct from development Studio; invocation-local
   Hutch/build/state/data/launch records; native-test lease serialization; default disposable
   source projection; explicit project remains exact. The current test bundle is
   `com.devtao.studio.test-4351d865b9f4`, a stable consent identity, not a cleanup selector.
2. Two invocations sharing that test identity serialize/refuse rather than sharing mutable state.
   Explicit occupied-project cases refuse before launch and never prompt to take over. Use
   proof-owned occupied fixtures, and corroborate development Studio preservation separately.
3. The current Mac2 smoke (`studio-mac2-acceptance.test.ts:118–132`) asserts app-state type and a
   screenshot. Extend its deterministic native fixture with a discoverable control and changed
   visible state; perform real driver click/input, assert resulting state and capture before/after
   screenshots. App-state query alone is insufficient interaction proof. Keep physical input
   serialized and scoped to the isolated test app.
4. For each entry path, record cleanup of owned Studio/Hutch/compiler/preview/Appium/WDA children,
   private ports, launch/state ownership, leases and disposable source projections. Simulate
   retained cleanup in focused tests and exercise safe owned failure on the host where tooling
   permits; fixture removal must wait for actual shutdown. Preserve unknown/shared caches.

Existing named commands:

```sh
cd "$HOME/code/tao-lang-2"
./agent unsandboxed studio-smoke --native packages/ides/studio-tooling/studio-smoke/studio-simulated-user.test.ts
```

The default `studio-launch.test.ts` explicitly tests browser CLI launch against HNReader. Adding
`--native` to that file does not turn it into isolated native launch acceptance; exclude that
shape from this lane. Cover native command launch through the isolated canary/manual paths and
their recorded readiness/cleanup, plus native lifecycle regressions.

After scoped visible/focus authorization, and W6 review before Mac2:

```sh
cd "$HOME/code/tao-lang-2"
./agent unsandboxed studio-smoke --native --show-studio packages/ides/studio-tooling/studio-smoke/studio-host-control.test.ts
./agent unsandboxed studio-smoke --native --show-studio packages/ides/studio-tooling/studio-smoke/studio-mac2-acceptance.test.ts --json
```

`studio-canary` and `studio-manual-checks` exist in `dev.ts`/Justfile but are absent from current
named host dispatch. Recommended small tooling slice: add these two fixed isolated workflow
targets to canonical host configuration/help, retaining argument/visibility checks and no raw
Hutch/PID passthrough. Approval must name those additions; regenerate adapters with `./agent setup`.
Do not alias them through unrelated host operations. After implementation, these proposed shapes
use CLI defaults (no `--project`), preserving disposable default projection:

```sh
cd "$HOME/code/tao-lang-2"
./agent unsandboxed studio-canary
./agent unsandboxed studio-manual-checks --show-studio
```

The manual command needs a real interactive human terminal; the harness's lack of Ctrl-C is not
fixed by a named route. If the Developer chooses to run the existing human recipe instead of
adding routes, use an explicitly task-owned disposable project/app in that terminal:

```sh
cd "$HOME/code/tao-lang-2"
MANUAL_PROJECT='<owned disposable Tao project prepared for these checks>'
MANUAL_APP='<app declaration in that project>'
just studio-manual-checks "$MANUAL_PROJECT" "$MANUAL_APP" --show-studio
```

The recipe passes an explicit project, so it does **not** get the CLI's automatic disposable
projection. Do not run its default HNReader arguments in the shared checkout. Record the manual
project's owner/cleanup and arrange a second owned project for File > Open Project.

Permission: existing smoke routes, approved W6 behavior/new isolated routes and scoped visible UI.
Human involvement: W8, plus interactive manual termination. Stop on lease/project takeover request,
unknown runner, incomplete teardown or unapproved focus. A missing canary/manual route stays a
capability blocker until the chosen route is authorized and implemented.

## W8 — Native consent, focus, coexistence and human checks

This workstream needs an explicit review window in the execution task. Prior-thread visible
permission is historical; it does not authorize new windows here. Obtain one scoped authorization
covering visible Chrome, Simulator, emulator, native Studio, brief Mac2 activation/input and normal
native permission prompts as desired. Reuse that authorization for its retries; pause/revocation
requires stopping affected visible sessions before another launch.

Existing target-specific visible commands, run separately with readiness/cleanup between cases:

Execution now provides fixed, invocation-owned visible cases. Use these for this host's measured
acceptance: ordinary Android defaults can reclaim the preserved legacy AVD/serial reservations.
Each case uses only its target-specific `--show-*` flag internally and prints a visibility warning;
notify the Developer before each command. Android keeps the private AVD/console admission path.

```sh
cd "$HOME/code/tao-lang-2"
./agent unsandboxed test-host managed-loop --case chrome-visible
./agent unsandboxed test-host managed-loop --case ios-visible
./agent unsandboxed test-host managed-loop --case android-visible
```

The ordinary command shapes remain supported; the Android one below is not this execution's
acceptance command because the baseline reservations must be preserved.

```sh
cd "$HOME/code/tao-lang-2"
./agent unsandboxed dev-loop start "Apps/Test Apps/Data MVP" --app DataMVPApp --web --show-browser --json
./agent unsandboxed dev-loop start "Apps/Test Apps/Data MVP" --app DataMVPApp --ios --show-simulator --json
./agent unsandboxed dev-loop start "Apps/Test Apps/Data MVP" --app DataMVPApp --android --show-emulator --json
```

Use W1's exact UUID-based status/reload/restart/stop commands for each receipt. Restart must preserve
its original visibility configuration. There is no generic `--show` flag.

| Human/host item                         | Procedure and evidence                                                                                                                                                                                                                                                                                                                    | Stop/cleanup                                                                                                                                                                                                                               |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Quiet Chrome/mobile/native focus        | Human leaves another app focused; run quiet lane and record foreground app, visible windows and Space before/after start, input, reload, restart and stop. Check Simulator with no viewer and an already-open viewer.                                                                                                                     | Unexpected activation/Space change is a failure, not dismissed by a headless argument. Do not close/rearrange unrelated windows or alter AeroSpace settings.                                                                               |
| Explicit visible targets                | Observe Chrome window behavior and inactive Simulator presentation; verify emulator window is intentional. Record actual focus behavior, including any accepted scoped activation.                                                                                                                                                        | Stop only owned sessions/windows. No fullscreen/maximize/Space changes for convenience.                                                                                                                                                    |
| Development Studio coexistence          | Developer keeps/starts an ordinary development Studio in the review window. Inventory its actual identity, state/project lease and processes. Run hidden probe/canary, visible semantic check and Mac2 against isolated test identity/project. Verify development app/content/state remain alive/unchanged and no takeover prompt occurs. | Never stop the Developer's Studio. If a separate task-owned development sentinel is used, launch through supported `studio-native`, record its launch UUID and stop only that UUID; absence of development Studio cannot pass coexistence. |
| Native Automation/Accessibility consent | Record current behavior. If OS prompt appears, pause for Developer's normal OS action, then retry the same scoped check. Record prompt identity, grant/deny outcome and subsequent driver behavior.                                                                                                                                       | No TCC writes, resets, silent grants, permission bypass or guessed consent diagnosis. WDA ownership failure is not consent denial.                                                                                                         |
| Permission prompts already granted      | Mark existing-grant execution separately from fresh-prompt behavior.                                                                                                                                                                                                                                                                      | If no prompt can be naturally observed, leave fresh grant/denial/recovery acceptance deferred for a suitable human-controlled host/account. Do not revoke existing grants or create accounts/settings under this plan.                     |
| Human manual Studio                     | In interactive isolated manual workflow: File > Open Project opens a second project window; Command-W closes exactly one; closing final window quits Studio. Observe without affecting development Studio.                                                                                                                                | Server may remain after final window closes; human Ctrl-C ends this current workflow, then prove owned server/native cleanup and remove only inactive owned fixtures.                                                                      |

For a task-owned development sentinel only, the existing launch/stop shapes are:

```sh
cd "$HOME/code/tao-lang-2"
STUDIO_PROJECT='<owned discoverable disposable project containing exactly one app>'
./agent unsandboxed studio-native "$STUDIO_PROJECT"
```

The current `studio-native` host target invokes a Justfile recipe that forwards only the project;
it does not accept an extra `--app`/`--json`. The checked-in Data MVP folder has multiple apps and
no default, so it cannot be used directly for this sentinel command. Its non-JSON launch output
does not print the launch UUID. Obtain the task-created UUID from the supported inventory below,
correlating the before/after delta with the owned project realpath and captured process identities:

```sh
cd "$HOME/code/tao-lang-2"
./agent unsandboxed studio-ps --json
```

```sh
cd "$HOME/code/tao-lang-2"
LAUNCH='<recorded task-owned development Studio launch UUID>'
./agent unsandboxed studio-stop --launch "$LAUNCH"
```

First ensure the fixture project is not held by a managed loop. This foreground launch requires
controlled human/runner termination; prefer the Developer's already-running Studio for coexistence.
`studio-stop` is not authorized for someone else's launch. Test launch records may live in their
invocation root; ordinary `studio-ps` alone does not inventory every isolated launch.

`StudioManualChecks.ts` records `status: 'launched'`, not a human pass. Preserve that contract;
record the three human verdicts independently with date, reviewer, invocation and observed result.
Do not restore interactive question logic or automatic server lifetime as a hidden extension of
this acceptance work. Physical accessibility/input evidence, semantic host-control and browser
preview remain distinct; screenshots alone do not prove menus/focus/window closing.

## Focused implementation validation, then host evidence

Run only affected files while implementing, and integrated typecheck after the coupled slices.
Existing exact source command catalog (do not run during planning):

```sh
cd "$HOME/code/tao-lang-2"
./agent test-file packages/cli/agent-cli/agent-cli-tests/dev-loop-args.test.ts
./agent test-file packages/cli/agent-cli/agent-cli-tests/agent-host-commands.test.ts
./agent test-file packages/cli/dev-cli/dev-cli-tests/dev-loop-command.test.ts
./agent test-file packages/cli/dev-cli/dev-cli-tests/dev-loop-controller.test.ts
./agent test-file packages/cli/dev-cli/dev-cli-tests/dev-loop-recovery.test.ts
./agent test-file packages/cli/dev-cli/dev-cli-tests/dev-loop-reservations.test.ts
./agent test-file packages/shared/shared-tests/dev-loop-control.test.ts
./agent test-file packages/apps/expo-host/expo-host-tests/expo-dev-loop.test.ts
./agent test-file packages/cli/dev-cli/dev-cli-tests/agent-android-emulator.test.ts
./agent test-file packages/cli/dev-cli/dev-cli-tests/android-recovery.test.ts
./agent test-file packages/testing/host-control/host-control-tests/MachineResources.test.ts
./agent test-file packages/ides/studio-tooling/studio-tooling-tests/studio-native-test-isolation.test.ts
./agent test-file packages/ides/studio-tooling/studio-tooling-tests/studio-mac2-test-isolation.test.ts
./agent test-file packages/ides/studio-tooling/studio-tooling-tests/studio-native-visibility.test.ts
./agent test-file packages/ides/studio-tooling/studio-tooling-tests/studio-release-and-canary.test.ts
./agent typecheck
```

Add meaningful focused tests for new delegation/attach/bootstrap/proof cases and list their exact
paths/commands in the execution evidence once created. Existing Appium `.host.spec.ts` files may
invoke host behavior; inspect their runner classification before calling them a source-only gate.
Use exact-file `./agent fmt <reviewed paths>` if formatting is necessary. No full-tree formatter,
`finalize` or full verification in this shared checkout before a separately authorized landing.

## W9 — Closure, retained resources and review handoff

1. Every acceptance row above gets evidence/disposition, including subcases; close no umbrella row
   while managed interaction, native focus/consent/manual or cleanup remains unproved. Keep exact
   tested source/diff and human observations tied to the same implementation generation.
2. Reconcile all task-created sessions and external directories. Use named status/stop and recorded
   generation recovery, then independent complete ownership inventory. For each retained item,
   report owner, process/device/resource generation, activity, artifact path, cleanup condition and
   exact supported command; where no safe command exists, explicitly say investigation/approval
   is required. Do not supply a guessed kill or delete command.
3. Update only the owning Chrome/Android/quiet-host backlog entries with source versus host versus
   human evidence and unresolved acceptance. Preserve the persistent-controller entry as deferred.
   Archive an entry only when its literal acceptance is satisfied under `devenv-upgrades` rules;
   regenerate both indexes with the existing command, never hand-edit them:

   ```sh
   cd "$HOME/code/tao-lang-2"
   ./agent ledger-index
   ```

4. Stop at the requested edit/review boundary. Committing needs the Developer's subsequent request;
   stage only reviewed task-owned paths, preserving other index work. Landing needs its own
   authorization and `./agent unsandboxed land`; full verification runs there. Passing focused
   checks or all host rows does not mean landed. Never run finalize as a workaround on `dev/ro`.
5. Before the implementation handoff, refresh its task-local checkpoint with completed rows,
   retained ownership, exact stop/recovery commands and next action. Recommend a dedicated
   [recurring repository pass](<Recurring repository pass.md>) after acceptance/landing: its last
   boundary is September 28, and these changes cross CLI, leases, host dispatch and native drivers.
   That separate pass must not be launched from this planning task.

## Decisions and approvals for review

1. **No unsettled language/product decision is required to write or review this plan.** WDA peer
   transport and managed runtime attach feasibility are engineering questions to resolve in bounded
   spikes, with safe refusal if proof is unavailable. Do not reopen timers, visibility syntax,
   borrowing semantics or the post-MVP controller boundary.
2. **The Developer authorized the implementation reach above.** The closed host catalog, managed
   attachment/recovery, copied-runner registration and isolated native routes are implemented.
   This authorization does not grant force-release of uncertain ownership, machine-setting changes,
   dependencies, commits or landing.
3. **Human observations remain to arrange:** visible checks are authorized in this session with
   notice before each, but focus, consent, coexistence and manual verdicts remain unanswered. Recommended route is the fixed isolated host
   commands above; the existing human recipe with owned disposable projects is a valid alternative.
   Fresh-prompt acceptance may need a separately authorized suitable host/account. It remains open
   if existing consent prevents observing it.

Stop at this evidence handoff. Remaining engineering questions are proof of unknown mobile driver
and process-group closure, and accessible native window readiness. They require bounded diagnosis
and fresh recorded proof before affected acceptance can resume. The human checks need actual
observations through the normal OS flow. No settled product decision is reopened. Recommend a
separate recurring repository pass after the acceptance/landing boundary because this work crosses
CLI dispatch, target leases and native drivers; do not start that unrelated pass here.
