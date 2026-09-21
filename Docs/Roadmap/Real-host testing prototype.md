# Real-host testing prototype

## Settled scope

Build an additive reference implementation before replacing existing testing. E2e means a real browser
or native OS host; a build or runtime-renderer test is a different kind of evidence. Start from HNReader
and a new focused Clockwork fixture. Register new coverage with scoped patterns and import no existing testing
infrastructure other than the HNReader subject. Keep existing suites and merge gates intact. Do not
commit until requested. Ro subsequently authorized completing review and committing this milestone
in chunks on 2026-09-19, then authorized landing it on `main` on 2026-09-20.

Implementation and commands: [E2E testing README](../../packages/testing/e2e-testing/README.md).

## Accepted package and authoring boundaries

`packages/testing/e2e-testing` owns the additive real-host orchestration, control checks, browser/native
journeys and dedicated Clockwork fixture. HNReader stays with its application; existing package tests
stay with their packages. `./agent test-host` remains the opt-in command. Scoped source/test globs
register coverage without file-by-file inventories; effect lint records the expanded files and fails
on an empty registration. Command dispatch, build preparation, host execution and evidence reporting
have separate named responsibilities.

Tao is the authored language for product journeys. The source-linked compiled journey plan now runs
through Playwright, Appium XCUITest, and Appium UiAutomator2. Appium is the sole native journey
execution path; the superseded Maestro runner and YAML authoring layer have been removed. Physical
termination/relaunch remains distinct from an in-process renderer remount, and unsupported host steps
fail explicitly.

Reusable host ownership, inspection and input sit below the journey runner so interactive development
and visual iteration can use them without importing testing orchestration. The production
`tao-host-control` package owns host-neutral sessions, semantic targets, revisions, and fenced
machine-resource leases; Playwright and Appium packages supply target drivers. Studio adds a semantic
development transport inside its owned native shell and a distinct Appium Mac2 acceptance seam.

## Prototype acceptance

- [x] Independent injected clocks and seeded random streams, with host-free isolation checks.
- [x] Explicit AST effect/import checks for participating files.
- [x] Isolated compilation and Expo web export for HNReader and Clockwork.
- [x] Browser journeys pass on a real browser (installed Chrome, isolated Playwright contexts).
- [x] Clockwork simulator journey passes through native taps and run-scoped deep-link clock control.
- [x] HNReader simulator journey passes navigation and process-relaunch persistence.
- [x] Isolated Clockwork Release build installed on the paired physical iPhone; independently confirmed by bundle ID.
- [ ] Physical-device UI journey passes; install-only receipts do not satisfy this.
- [x] Browser application faults demonstrate meaningful countdown and persistence failure detection.
- [x] Simulator application faults fail at the corresponding visible assertions.
- [ ] Behavior inventory and parity criteria justify replacing any existing coverage.

The runtime adapter uses one controlled `TR.Clock` per JavaScript realm. The pure core allows multiple
independent injected clocks in the same process. This establishes the prototype's isolation contract;
it does not yet migrate the repository to a universal production effect API.

The `RuntimeCore.ts` entry point at `@tao/runtime/core` exports `Effects` and `Arrays`, re-exported
through `@shared/core` and `@shared`. Their implementations stay inside the shipped runtime package
without platform dependencies or a new distribution package. `Arrays.sorted` and `Arrays.reversed`
return fresh arrays from readonly inputs; intentional mutation uses explicitly named in-place helpers.
Repository lint keeps raw sorting/reversal methods inside `core/Arrays.ts` throughout shipped runtime
source, preventing a recurrence of the native Hermes `toSorted` startup failure.

Physical-device UI driving, simultaneous multi-simulator host proof, and broad lint enforcement remain
open. No existing suite or pre-merge gate has been retired or replaced.

## Explicit behavior inventory

| Subject                      | Registered proof                                 | Independently observed behavior                                                                                                       |
| ---------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| HNReaderStub, browser        | `browser/hnreader.host.spec.ts`                  | Story comments, return navigation, two opened stories in newest-first order, persistence after page reload                            |
| Clockwork, browser           | `browser/clockwork.host.spec.ts`                 | Visible color action and countdown after controlled runtime scheduling                                                                |
| Browser realm isolation      | `browser/clockwork-environment.host.spec.ts`     | Separate clocks and random streams in fresh browser contexts                                                                          |
| Effects core and enforcement | Explicit `controls` Playwright project           | Same-process session isolation, invalid controls, lifecycle cleanup, synchronous clock observation, scoped effect/import restrictions |
| iOS native subjects          | Compiled Tao journey through Appium XCUITest     | Simulator input, run-scoped deep-link controls, process-relaunch persistence, screenshots, and source-linked receipts                 |
| Android native subjects      | Compiled Tao journey through Appium UiAutomator2 | Emulator input, run-scoped controls, process-relaunch persistence, screenshots, and source-linked receipts                            |

These are additive prototype proofs. They do not establish live Hacker News, CloudKit, all navigation
semantics, or parity with the repository's existing suites. No replacement is justified by this inventory.

## Recommended next architecture

The [host-control architecture recommendation](Tao%20host%20control%20architecture.md) records the
selected universal Tao API: a small production contract over owned host sessions, Playwright for
browsers, Appium for native acceptance, and semantic RPC for Studio development. Source-aware
inspection and ownership sit above drivers; the driver is not the journey runner.

## Parallel development and host testing

Ro requested concurrent agents both testing and actively developing on real hosts, including visual
design iteration. The current implementation provides these foundations:

- Hold an exclusive target lease across installation, UI interaction, and cleanup. Separate simulators
  permit parallel control; one physical device remains exclusive. Never infer ownership from which
  app or simulator happens to be foreground.
- Allocate targets from a bounded simulator pool with compatible runtime/device profiles. Account for
  driver processes, ports, bundle identifiers, app storage, and artifacts as session-owned resources.
  Build concurrency and simulator concurrency need separate machine-wide budgets.
- Give interactive development a reusable stateful session with fast refresh, screenshots, hierarchy
  inspection, and real input. Give acceptance a fixed build and controlled starting state; a live edit
  must not silently change the build a test claims to prove. Promote a development result into a
  separate acceptance session when collecting proof.
- Make deterministic scenarios, time, and randomness explicit session options for visual iteration;
  ordinary development should retain live effects. Host allocation must not silently install test
  clocks or replace the app's data sources.
- Support explicit release, owner-liveness checks, and crash recovery. Cleanup must neither
  erase another session's target nor interrupt a human or another agent's development preview.
- Keep scheduling and control receipts visible through the existing machine activity reporting.

Pool capacity, idle development-session retention, and explicit handoff remain future policy. Current
drivers isolate application IDs, artifacts, ports, revisions, and target leases, but real native
evidence still comes from coordinated single-target runs. A simultaneous multi-simulator host proof is
required before claiming that capacity. Same-target driving remains serialized by design.

Ro recalls an earlier decision against Playwright that has not yet been located. The subsequent
research recommends its library behind the Tao browser test driver to reduce locator/wait/debugging
maintenance, while preserving existing direct-CDP callers and keeping raw CDP a narrow diagnostic
or attach capability. This does not select Playwright Test as the universal runner; its use for
host-free controls is still prototype-only. See the recommendation for the evidence and tradeoffs.

The production `MachineResources` primitive now provides cross-worktree generation-fenced leases.
Mobile controllers lease each explicit simulator or emulator and their driver ports. Studio semantic
sessions share one owned native process; external Mac2 input owns one global physical-input lease.
`StudioPreviewRuntime.ts` remains the production preview-build seam for stateful development.
