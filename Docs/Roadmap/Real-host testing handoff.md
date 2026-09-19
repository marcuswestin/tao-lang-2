# Real-host testing handoff — 2026-09-19

## Continuation evidence (current session)

### Agreed cleanup after prototype review

The follow-up places real-host orchestration and its dedicated fixtures in `packages/e2e-testing`.
The developer command is a thin lazy package entry, while scoped globs register source and test
coverage. Expanded source coverage is retained in each effect-boundary receipt; empty registrations
are failures. Existing suites and their gate membership remain unchanged.

`RuntimeCore.ts` is the public core facade. `Arrays.sorted` and `Arrays.reversed` centralize portable
nonmutating ordering; explicitly named in-place helpers preserve intentional mutations. The shipped
runtime uses these helpers and repository lint prevents raw ordering-method access elsewhere in it.
`Effects` remains the same shared, host-neutral implementation.

Tao-authored real-host journeys are accepted direction, not yet an implemented executor. Existing
Maestro YAML and Playwright journeys remain the live proofs until equivalent source-linked Tao plans
can drive the hosts and detect the same deliberate application faults. See the three ranked
[next-slice contenders](Tao%20host%20control%20architecture.md#candidate-slices-for-discussion).

The records below retain the prototype's earlier paths/counts as historical evidence. Follow-up
validation under `.artifacts/host-testing/`:

| Run                                    | Follow-up result                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `d5f65942-d3e5-4fa3-88ab-f77c6de65fb3` | All 31 controls passed, including shared/runtime array identity and scoped TS/TSX glob discovery                 |
| `eec62284-52a0-415d-b8ec-8fabdb4f0028` | Effect/import boundary passed for 32 files expanded from three source patterns                                   |
| `e2b00acf-5a3e-4cd4-8839-c8c987d22f37` | Independent E2E package typecheck passed                                                                         |
| `ab87ee0e-42c1-4265-b24d-76ed5af8dbba` | Three Clockwork Chrome journeys passed, including concurrent-realm isolation                                     |
| `1972bcee-4b08-41a5-bf74-17af4dcf456c` | HNReader Chrome navigation/order/reload-persistence journey passed                                               |
| `201328e7-0ee8-4627-9ef5-a54b71923c97` | Frozen Clockwork countdown was detected at the intended healthy assertions; command intentionally exited nonzero |
| `f79a90d4-26ff-4e92-8cf1-85628dcb1b6e` | Missing HNReader history writes were detected after browser reload; command intentionally exited nonzero         |
| `e962f55f-acf9-41df-8e08-7fd51af6559b` | HNReader Release build/install and complete simulator journey passed, including OS kill/relaunch persistence     |

The simulator recheck uses the shipped portable Arrays implementation. This follow-up did not repeat
Clockwork's simulator journey, native mutation builds or physical-device installation; their earlier
receipts below remain historical evidence. Physical-device UI acceptance and the Tao-plan executor
remain incomplete. Fault JSON receipts preserve named assertion signatures and mutation provenance.

Independent core review found two static destructuring forms that bypassed the array convention;
assignment and for-of/in patterns are now covered alongside declarations and literal member access.
The final repository lane is recorded separately at `.artifacts/logs/verify-full/latest/summary.json`;
the opt-in host proofs above do not replace existing verification gates.

The first follow-up full lane passed 40 gates and failed two: unused local exports (removed) and
the existing simulated-user sketch-transition timeout. The isolated browser retry passed all four
tests in 15.77 seconds. The failure and overlapping-load evidence are recorded under DEVENV-042 in
the [developer-environment backlog](Developer%20environment%20upgrades.md); contention is not a proven
cause. The final lane receipt above records verification after the export cleanup.
That full retry (`2026-09-19T21-20-15-827Z-7571-cea3f64a`) passed 41 of 42 gates, with the same
simulated-user unsnap transition failing. No other lane was registered. Full host verification
was still red. Inspection found selection was applied before the board-settle wait and could be lost
when the board was replaced; an empty selection intentionally means unsnap-all. The test now prepares
the selection on the confirmed settled board, retaining the existing single real click and assertions.
The corrected focused journey passed all four tests in 14.38 seconds.
The final lane receipt above records validation after this narrow test-harness fix.
Run `2026-09-19T21-27-48-281Z-47873-ffe742c3` passed every host and test gate, including the repaired
simulated-user journey (46.1 seconds), but failed repository lint because nine existing raw-error
allowlist line numbers moved with the test edit. Those exact locations were refreshed without adding
exceptions. Final validation of that bookkeeping and the complete commit gate is recorded at
`.artifacts/logs/verify/latest/summary.json`. The last full-lane receipt retains its failed lint status;
host checks were not repeated after the allowlist/documentation-only follow-up.

Ro authorized completing the review and committing the current milestone in chunks on 2026-09-19.
Work is on `feat/real-host-testing-prototype` in the same worktree; no merge, push or new worktree is
part of this authorization. The [host-control architecture recommendation](Tao%20host%20control%20architecture.md)
records the researched driver/API direction and candidate next slices. It is a recommendation,
not a claim that a universal control API or simulator pool was implemented.

The effective policy remains `workspace-write` with restricted network and limited writable roots.
Reviewed `require_escalated` execution is available. The exact read-only command
`xcrun simctl list devices available --json` failed sandboxed with log-file `Operation not permitted`
and CoreSimulator connection errors, then succeeded outside the sandbox. This comparison identifies
the current discovery failure as a task restriction; no reboot or service reset was needed.
`./agent help` also succeeds outside the sandbox. Physical-device discovery reports a paired iPhone,
but discovery is not installation or UI evidence.

New evidence under `.artifacts/host-testing/`:

| Run                                    | Result                                                                                                                                                                            |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `d9c81c6d-2fd6-4a07-bb5c-528378811b7d` | HNReader real Chrome journey passed: detail, return, order, reload persistence                                                                                                    |
| `e1b68aae-44d9-476d-8d39-85c6aeb0818c` | Three Clockwork real Chrome journeys passed, including literal visible random progression                                                                                         |
| `38a04da7-0133-4400-ac74-e0e8fbc8fa40` | HNReader application fault intentionally failed only at post-reload `2 opened`; accessibility snapshot shows `Nothing opened yet`                                                 |
| `7ee7292a-68be-4c8c-9487-7f1fb8147125` | Frozen Clockwork application intentionally failed both `Countdown: 0:09` assertions; snapshot shows elapsed 1000ms and `Countdown: 0:10`; random progression passed               |
| `0c341b42-580f-4933-99e9-b4b549bda17b` | Nine controls passed, including production runtime clock scheduling, disposal, and reinstall                                                                                      |
| `82883f69-b21d-4a2e-b0ef-a349c22689d8` | Integrated prototype typecheck passed                                                                                                                                             |
| `1e9d9cb1-cff4-46a0-9fb3-bc66a4fe9f93` | Explicit effect/import checks passed for 16 participating files                                                                                                                   |
| `09cbeaa4-9393-4bd0-b280-6e7a2bd502c5` | Clockwork browser fault re-run produced `application-fault.json` with `detected`                                                                                                  |
| `bc32271a-7a1a-4d6a-bf03-3d1cc7aa2667` | HNReader browser fault re-run produced `application-fault.json` with `detected`                                                                                                   |
| `92c2de75-a16d-47dc-8ba9-a1c54d6acf66` | Thirteen controls passed, including classifier detection, escape, and unrelated/global-error rejection                                                                            |
| `2357a8ae-1baf-4fc9-b2fb-f20ed2f2fe24` | Clockwork iOS 27 simulator: Release build/install, clean launch, native color taps, deep-link receipt and countdown all passed; every recorded subprocess exited 0 without signal |
| `0827c59d-6e29-4bf0-b13c-46e801a1897a` | Healthy HNReader browser journey passed after the reload assertion marker was added                                                                                               |

The two fault runs were inspected at their intended assertions; browser launch/compile failure is not
fault-detection evidence. Their `build.json` records the generated-file mutation and digests, and
`playwright.json`, `browser.log`, screenshots, and traces retain the UI result. The earlier
wrong-expectation-only fault project was removed; `check --fault` now rejects a mode that cannot build
an application. Existing suites and merge-gate membership are preserved.

Independent review exposed stale exact assertions in the runtime export/package-graph tests.
Both were reproduced red, updated for the shared core, and passed (4 runtime-package checks and
3 package-graph checks). The pure shared Effects implementation remains unchanged.

The isolated native host now retains production iOS scene support and uses a per-run native control
scheme. Homebrew Java and Maestro were provisioned; native command environment supplies a scoped JDK
fallback. Native evidence is recorded below; repository verification remains a separate lane receipt.

The first native attempt `bf6f4cd8-b40f-452b-a311-9c1a0968b9a6` eventually produced a failed receipt:
Xcode reported `Build Succeeded`, installed and opened the isolated app, then Expo kept its development
server/log stream alive until the 90-second idle timeout. `native/receipt.json` records `SIGTERM` and
the timeout. The runner now requests `Release --no-bundler` so installation can return before UI proof.
That first run contains a build/install milestone, but no native UI acceptance.

Run `0c82e977-5048-40d6-a62e-19a49570b496` built and installed successfully and reached Maestro.
The first screen assertion failed because Expo's iOS `Open in…` dialog occluded a correctly rendered
Clockwork screen. Reset now dismisses that setup dialog; Maestro's artifact directories are explicitly
stored beneath the run's `native/` directory on subsequent runs.
Run `c8701b3e-8f9d-4391-9373-ac82390120e4` exposed queued dialogs from older runs after dismissing
the newest one. Reset now dismisses up to eight such setup dialogs and asserts none remain.
The succeeding Clockwork run is `2357a8ae-1baf-4fc9-b2fb-f20ed2f2fe24`.

### Further host results

- Final healthy browser rechecks: HNReader `3307e72a-ad23-4800-a288-e2f720c02753` (one journey)
  and Clockwork `5dd5f2eb-c948-4e8e-a188-fbe3772d895e` (three journeys) passed.
- Browser mutation runs `68766c1d-e13d-4c96-95bb-08eb35515aa4` (Clockwork) and
  `1ebe05b7-e68a-4ccd-8d63-f262a937db56` (HNReader) both produced `detected` verdicts with
  validated generated-file provenance. Host controls `84e48eb0-d6a0-4bf2-87a6-6c9f03755a20`
  passed all 14 then-registered checks; later native-classifier coverage is additional.
- Simulator mutation `a3adf24a-e345-4fe1-a08c-28c3fd4507d2` completed every earlier Clockwork
  step and failed only `Countdown: 0:09`. Its screenshot shows the `advance 1000ms` control receipt,
  correct `steel` choice, and frozen `Countdown: 0:10`. This was manually inspected; that invocation
  preceded automatic native verdict integration.
- HNReader `d0db1022-e352-429f-9351-48650e254c52` built and installed, then crashed before
  readiness. `native/application-crash.ips` identifies `CKContainer.default()` at native startup:
  HNReaderStub retains its CloudKit datasource, but the isolated app has no iCloud plugin/entitlements.
  The production native guard now requires the plugin's Info.plist container declaration before
  calling CloudKit. This rejects missing configuration through the existing sync-error path; it
  does not fabricate a cloud container or change the datasource. Signed entitlement verification
  remains Xcode's responsibility. Native acceptance of this fix is recorded separately below.
- Physical attempt `1f44d40b-ae08-43d8-a0d0-5ceab63c2656` discovered the paired iPhone and
  prepared the Release project, but Xcode exited 70 because roPhone was locked and development
  services were unavailable. No physical build/install or UI acceptance was established.
- After Ro unlocked the phone, `7e6ecbf3-042a-4c3c-bec9-b1dbb61795f6` successfully built and
  installed Clockwork on roPhone. `native/physical-install-confirmation.json` independently confirms
  its exact bundle identifier through `devicectl`. The proof correctly remains blocked at
  `physical-ios-ui-driver-unsupported`; installation is not UI acceptance.
- HNReader `7170ab25-ef35-423f-a523-00579c02a194` compiled the CloudKit guard and passed the
  former trap, then exposed a separate React Native fatal JavaScript error: `visualOrder` called
  `Array.toSorted`, unavailable in this Hermes runtime. The crash and simulator log are retained
  under `native/`. Shipped-runtime copy-sort/reverse calls now use compatible fresh-array operations;
  the focused interaction-attention suite passed 40 tests. The native recheck is recorded below.
- HNReader `ab233dab-cdb9-419a-a05b-b957514fdb1e` passed the complete simulator journey after
  those fixes: readiness, actual comment and empty-thread detail views, Back navigation, newest-first
  Reading order, OS termination/relaunch, and persistent `2 opened` with the same order. Its five
  recorded commands all exited zero without signals. Browser recheck
  `0e51bceb-8e32-4dc6-afe4-e39483e1c0a5` also passed after the runtime compatibility changes.
- Integrated controls `07f82fb9-9c88-451f-81c0-60ac62d74f81` passed 21 checks, including actual
  Expo plugin mod execution and strict native fault classification; prototype typecheck
  `15ff19bc-4691-48b3-8d14-55b770a44483` passed. The native classifier recognizes exact Maestro
  command shapes and requires matching-app termination/relaunch before HN's persistence failure.
- Native HNReader fault `c87274d9-15d3-4366-9d54-e0ca49cfc8e4` built and installed, passed
  navigation and the first `2 opened` assertion, terminated/relaunched the app, then failed only the
  final `2 opened` assertion. `application-fault.json` reports `detected` with mutation provenance;
  Maestro commands, JUnit, screenshot, and hierarchy remain under `native/`. Alongside the inspected
  Clockwork fault above, both intended simulator defects were caught by unchanged healthy assertions.
- Final integrated prototype controls `f157b119-6eb3-41d8-900a-31567395ce7f` passed 21 checks;
  typecheck `b7b8d4ee-819c-4f77-ab4c-98a92ebc2f59` and 19-file effect/import boundary
  `d9966ff7-8cf7-48f7-8793-021b830acc14` passed. No existing suite or merge-gate membership was removed.
- Repository `check` run `2026-09-19T20-07-35-343Z-85949-2c073477` passed repository lint,
  typecheck, runtime packaging and IDE build, but found handoff Markdown formatting and Clockwork
  canonical-source formatting. Both were fixed; this failed run is not a green repository gate.
- Repository `verify` run `2026-09-19T20-26-42-129Z-11614-81351097` passed 28 gates,
  failed four, and skipped Studio smoke. Three failures shared the existing Jest resolver's missing
  mapping for the new `@tao/runtime/core` export; the shared Jest configuration now maps that export
  to the same pure Effects implementation. Repository lint also identified a shifted existing
  standalone-plugin error allowance and a direct Node import in the new CloudKit control; both
  were corrected. Post-fix controls `8b459166-357e-4efa-af66-e8ca40880151` passed all 21 checks,
  and prototype typecheck `68de7fc7-768f-4a48-8352-6964a00ff4eb` passed. The final repository
  verification result is a separate lane receipt; this earlier failed run is not acceptance.
- Repository `verify` run `2026-09-19T20-30-43-740Z-16429-f2f5467b` then passed 32 gates,
  with no failures and Studio smoke skipped. The Git diff check passed and the index remained empty
  at that milestone. Subsequent review/commit preparation requires its own final verification record
  after any fixes or documentation updates.

### Review closeout before chunked commits

The full read-only review covered the host harness, registration/configuration, native target admission
and cleanup, fault evidence, shared/runtime Effects integration, CloudKit handoff and Hermes fixes.
Three findings were fixed and independently re-reviewed, with no remaining high-confidence findings:

- Browser fault detection searched the whole Playwright error string, which could include the intended
  assertion only in a neighboring source frame. It now requires a dedicated exact primary error header.
  Negative controls cover unrelated source-frame markers and a preceding control-receipt failure.
- The effect linter treated `Date(0)` as deterministic even though function-call Date ignores its
  arguments. It now rejects calls with arguments and their same-file aliases, while allowing
  `new Date(value)`. The new regression reproduced red in `5edfff30-d3c7-4b64-ab50-d55a03a4c5a3`.
- Browser control advanced the clock without publishing `lastControlAdvanceMs`. It now uses
  `advanceControl`. The strengthened real Chrome journey failed with `undefined` instead of `1000`
  in `d26bece4-c259-4e23-b274-3cf46018f811`, then all three Clockwork journeys passed in
  `48ba120b-a7fb-4ab3-ae95-adaa239b85f6`, including returned and visible control receipts.

Controls `4e76f36a-e175-474d-80b5-a41981490ee4` passed all 24 checks; the 19-file effect/import
boundary passed in `f08bfd9c-2684-47c1-bdf3-7811da6b051b`. Actual browser mutation runs
`5d6893cc-11db-4871-8002-64ab298bde87` (Clockwork) and
`9c026159-3b03-46c7-9262-255385c02b26` (HNReader) both produced `detected` with the stricter
classifier. They exited nonzero intentionally at the named healthy assertions, preserving traces,
screenshots and mutation provenance. Healthy HNReader also passed again in
`5df5dfdd-a1e3-4b18-b63a-686efc774078`. Native flow/classifier behavior was unchanged by these fixes.

The architecture recommendation was checked against current vendor documentation and repository
capabilities. It introduces no new driver dependency or universal API implementation. The final
repository lane's `summary.json` is authoritative for commit-time gates; host-proof receipts remain
separate because the opt-in prototype is not a member of the existing verification suites.

Full verification `2026-09-19T20-48-23-922Z-36871-bb33eb95` passed all existing host lanes,
including Studio native shell/canary, browser interaction, keyboard navigation and bundle proof.
It ended 41 passed, one failed, none skipped: only repository lint rejected raw-error syntax inside
a negative test's example source frame. That example now uses an unrelated assertion instead;
controls `3de6d2e6-df2d-4a6e-b84b-8e232587edaf` passed all 24 checks after the correction.
This failed lane is retained separately from the final commit-time verification receipt.

## Previous session handoff (historical)

## Resume here

Use the existing worktree `/Users/ro/.codex/worktrees/40f2/tao-lang-2`. All changes are uncommitted;
the index and branch refs were not changed. Preserve them. Do not commit, stage, merge, or replace
the worktree until Ro asks. Existing test suites and merge-gate membership are unchanged.

Read [the prototype README](../../packages/e2e-testing/README.md) and
[the roadmap](Real-host%20testing%20prototype.md). Ro wants real browser/native/device evidence,
explicitly registered new tests, and no imported legacy test infrastructure except HNReader as the
initial existing subject. Clockwork is a new minimal harness fixture.

## Design intent and working constraints

Ro's priority is testing quality and getting the architecture right, rather than preserving the old
test structure or optimizing test orchestration. The current step is an additive proof of concept,
not permission to delete or replace the old suites. Use real-host acceptance journeys for visible
behavior, and focused lower-level tests for behavior that is impractical or disproportionately
expensive to prove through those journeys. Avoid redundant coverage and assertions that merely
repeat implementation logic.

Ro explicitly authorized implementation with subagents and later requested sharing a host-neutral
core between the shipped runtime and `@shared`. Keep time/random state per session, control both
clock reads and scheduling, and avoid process-wide mocks that interfere with parallel tests.
The present linter is deliberately scoped; it does not yet enforce this throughout the repository.

Use the repository's `decision-rounds` skill for new product/architecture judgments that need Ro;
the accepted scope above does not need reconfirmation. Read delegation/parallel-implementation
guidance before assigning bounded implementation ownership. Coordinate expensive host runs so
multiple workers do not contend for the same simulator. Treat returned reports as claims to verify.

## Implemented

- One host-neutral `Effects` core exported by `@tao/runtime/core` and re-exported through `@shared`
  and `@shared/core`. It ships inside the runtime package, has no imports, and supports independent
  injected clocks and random streams. It does not migrate existing production callers wholesale.
- Test-only browser/native control adapters around production `TR.Clock`; one runtime session per
  JavaScript realm, run-ID validation, and receipt publication before timer subscribers execute.
- Explicit Playwright controls, browser journeys, and deliberate failing-assertion project.
- AST effect/import enforcement over 17 explicitly listed prototype files; documented limitations
  for dynamic properties, transitive dependencies, and cross-file alias analysis.
- Isolated Tao compilation and Expo export, with unique artifacts and isolated native app IDs.
- Native controller with bounded commands, exact target admission, canonical path checks, static
  config identity checks, and Maestro flows. Physical iOS is only a build/install milestone until
  a physical-device UI driver is added; it deliberately reports blocked rather than passed.
- Independent review fixes: default-expression lint traversal, loop scopes, CommonJS imports,
  native build environment/target/isolation checks, run/seed readiness, and consistent elapsed time
  observed by synchronous clock subscribers.

## Evidence obtained

- `just test-host check`: 8 passed; final functional core regression included.
  Receipt: `.artifacts/host-testing/3b62e57c-0018-4b65-8bd3-1f7a17359c4a/controls.log`.
- `just test-host typecheck`: passed after final native edits.
  Receipt: `.artifacts/host-testing/448d145f-2583-4174-8ac3-b7ad9b79a326/typecheck.log`.
- `just test-host lint`: 17 participating files passed.
- `just lint`, `just dead-exports`, and `just _runtime-pack-check`: passed.
- `just test-host check --fault`: intentionally exited 1 on the expected assertion (10 vs 1010).
  Receipt: `.artifacts/host-testing/3f23a189-d481-4d2d-ac9f-726faf37c1d2/controls.log`.
- HNReader and Clockwork compiled and exported through production Expo/Metro. Export receipts:
  `.artifacts/host-testing/f660917d-06fb-444c-9b50-a0280678c0cd/web-export.json` and
  `.artifacts/host-testing/293f4437-0c48-4f1f-b52c-327f3d053b82/web-export.json`.
  These exports preceded the final elapsed-time correction; that correction passed the checks above.
- Scoped TypeScript/Markdown formatting completed; `git diff --check` passed.

No browser UI journey, native build, simulator UI journey, physical-device UI journey, or full
repository verification has passed in this session. Build/export success is not UI proof.

## Host blockers and next actions

Initially the macOS app showed Full access selected, but the running task still received a
`workspace-write` permission policy with limited writable roots and approvals disabled. Its `simctl`
query reported both a log-file permission denial and `CoreSimulatorService connection became invalid`.

**Latest retry, 2026-09-19 15:43 America/New_York:** the supplied policy changed to writable root `/`,
but retained `sandbox_mode=workspace-write`, `approval_policy=never`, and explicit secret-file denials.
The log-file permission error disappeared. The exact command
`xcrun simctl list devices available --json` still exited 1 with
`CoreSimulatorService connection became invalid`, `simdiskimaged` unavailable, and connection refused.
This does not establish whether the remaining cause is task sandbox/XPC restrictions or a host-service
problem. No ordinary-Terminal comparison result has been supplied. No host reboot, service reset,
browser permission workaround, or secret-file access was attempted.

1. In a fresh turn with Full access selected, confirm the actual supplied permission policy and run
   read-only `xcrun simctl list devices available --json`. Judge capabilities from actual results,
   not just the mode label: the previous session allowed writes under `/` while retaining a sandbox.
   If still blocked, distinguish a task restriction from host failure before retrying or proposing
   a reboot. Use this exact worktree; do not clone or create another worktree, which would omit the
   uncommitted files.
2. Run `./agent help` to check dependency bootstrap. It previously stopped at keytar `EEXIST` despite
   installing Playwright. The declared `just test-host` recipe worked with the installed dependencies.
   This symptom is recorded in DEVENV-040; do not repeat a denied install/removal inside restrictions.
3. Run `./agent test-host browser --app hnreader` and then `--app clockwork`, inspect Playwright
   reports/traces, and fix real selector/runtime failures. Chrome previously closed before page
   creation. Chromium download was network-denied; no alternate download path was attempted.
4. Maestro was absent from PATH and `~/.maestro/bin`. Provision the supported native driver in the
   appropriate host environment, choose an available iOS simulator UDID, and run
   `./agent test-host ios --app clockwork --device <UDID>`, then the HNReader journey. Validate actual
   Expo build, install, UI, deep-link control, and persistence behavior before claiming success.
5. Keep physical-device installation and physical-device UI evidence distinct. Implementing the
   missing physical iOS driver is follow-on work; do not treat the current blocked receipt as green.
6. Finish host acceptance and deliberate application-fault proofs before expanding coverage or
   replacing anything. Run appropriate repository verification after fixing the bootstrap.

If CoreSimulator still fails in a genuinely unrestricted session, diagnose the host service separately;
the earlier restricted-session error alone does not establish that macOS needs restarting.
