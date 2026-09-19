# Real-host testing prototype

## Settled scope

Build an additive reference implementation before replacing existing testing. E2e means a real browser
or native OS host; a build or runtime-renderer test is a different kind of evidence. Start from HNReader
and a new focused Clockwork fixture. Register each new test explicitly and import no existing testing
infrastructure other than the HNReader subject. Keep existing suites and merge gates intact. Do not
commit until requested. Ro subsequently authorized completing review and committing this milestone
in chunks on 2026-09-19; merging and pushing remain outside this task.

Implementation and commands: [host-testing README](../../packages/dev/host-testing/README.md).

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

The `RuntimeCore.ts` entry point at `@tao/runtime/core` exports the `Effects` namespace, re-exported
through `@shared/core` and `@shared`. Its implementation stays in `core/Effects.ts` inside the shipped
runtime package and has no imports, so sharing
it introduces neither Node/React Native dependencies nor a new package to distribute.

Native physical-device driving and broad lint enforcement remain open implementation work. No test
suite has been retired and no pre-merge gate has been replaced.

## Explicit behavior inventory

| Subject                      | Registered proof                                            | Independently observed behavior                                                                                                       |
| ---------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| HNReaderStub, browser        | `browser/hnreader.host.spec.ts`                             | Story comments, return navigation, two opened stories in newest-first order, persistence after page reload                            |
| Clockwork, browser           | `browser/clockwork.host.spec.ts`                            | Visible color action and countdown after controlled runtime scheduling                                                                |
| Browser realm isolation      | `environment/clockwork-browser.host.spec.ts`                | Separate clocks and random streams in fresh browser contexts                                                                          |
| Effects core and enforcement | Explicit `controls` Playwright project                      | Same-process session isolation, invalid controls, lifecycle cleanup, synchronous clock observation, scoped effect/import restrictions |
| Native subjects              | `native/flows/clockwork.yaml`, `native/flows/hnreader.yaml` | Intended simulator OS input, deep-link controls, and process-relaunch persistence; acceptance depends on native receipts              |

These are additive prototype proofs. They do not establish live Hacker News, CloudKit, all navigation
semantics, or parity with the repository's existing suites. No replacement is justified by this inventory.

## Recommended next architecture

The [host-control architecture recommendation](Tao%20host%20control%20architecture.md) records the
research following Ro's request for one universal Tao API. Recommend a small production control
contract over owned host sessions, Playwright library for browser control, Maestro for the current
simulator batch proofs, and a bounded Appium XCUITest spike for interactive/physical iOS control.
Source-aware inspection and ownership sit above drivers; the driver is not the journey runner.
This recommendation is not an implementation or permission to replace existing coverage.

## Parallel development and host testing

Ro requested that the architecture support concurrent agents both testing and actively developing on
real hosts, including visual-design iteration. The following is a proposed direction, not implemented
capacity or a settled lifecycle policy:

- Use a shared production host-session authority for development and acceptance. A session identifies
  its owner, worktree, target, app/build, logs, screenshots, and UI-control endpoints. Reuse production
  coordination utilities where suitable; do not import existing testing infrastructure into this PoC.
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
- Support explicit handoff, release, owner-liveness checks, and crash recovery. Cleanup must neither
  erase another session's target nor interrupt a human or another agent's development preview.
- Keep scheduling and control receipts visible through the existing machine activity reporting.

Decisions still to settle: pool capacity policy, idle development-session retention, and preemption.
Recommended defaults are adaptive bounded capacity, reusable development sessions, and no automatic
preemption of active development. The current PoC still relies on coordinated serial native runs;
unique app IDs and run-scoped controls alone do not make same-target concurrent driving safe.

Ro recalls an earlier decision against Playwright that has not yet been located. The subsequent
research recommends its library behind the Tao browser adapter to reduce locator/wait/debugging
maintenance, while preserving existing direct-CDP callers and keeping raw CDP a narrow diagnostic
or attach capability. This does not select Playwright Test as the universal runner; its use for
host-free controls is still prototype-only. See the recommendation for the evidence and tradeoffs.

Repository seams inspected: `MachineLanes.ts` already owns cross-worktree atomic resource leases,
but lives under `repository-tests`; do not import that testing infrastructure into the PoC. A future
shared production lease primitive would need an explicit extraction with existing callers preserved.
`StudioNative.ts` currently reserves one global native host, whereas a simulator pool needs one lease
per target. `StudioCompanionSimulator.ts` can discover/boot/open an explicit simulator but does not
allocate one. `StudioPreviewRuntime.ts` provides an existing production preview-build seam for
stateful development. These are architectural references, not implemented integration.
