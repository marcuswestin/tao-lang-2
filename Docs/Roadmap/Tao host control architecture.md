# Tao host control architecture

## Status and recommendation

Research and repository inspection on 2026-09-19 support one Tao-owned API for interactive development
and real-host testing, with target-specific drivers underneath. Ro delegated the recommendation using
simplicity, maintainability, ease of use, debugging, and parallel development as the priorities.
The additive first implementation now lives in `packages/testing/host-control`,
`packages/testing/playwright-driver`, and `packages/testing/e2e-testing/journey`; existing coverage remains.

“Tao CDP” describes the desired control surface here; it does not mean implementing Chrome DevTools
Protocol on every host. The existing `StudioCdp` is a Chrome driver, not the source-aware contract.
Avoid a permanent second general browser driver or an abstraction containing every vendor method.

Use Playwright's library for browser sessions and Appium for native sessions: XCUITest on iOS,
UiAutomator2 on Android, and Mac2 for external Studio acceptance. Studio development uses a Tao
semantic RPC inside its owned Electrobun shell. Real simulator and emulator journeys established the
mobile drivers; physical-device UI acceptance remains separate and incomplete. Maestro no longer
drives any repository route and is not part of the lasting architecture.

## Separate four responsibilities

1. **Sessions and ownership:** acquire a target, identify its app/build and owner, budget resources,
   retain or dispose it, and reject stale ownership. This is production development tooling shared
   by Studio, CLI use, and test runners.
2. **Tao observations and targeting:** combine source occurrences, interaction structure, rendered
   bounds, public test IDs, and host accessibility information. Keep each origin distinguishable.
3. **Host drivers:** perform actual pointer, keyboard, touch, scroll, capture and lifecycle operations.
   Drivers translate targets and report capabilities; they do not choose test expectations.
4. **Journey runners:** select explicitly registered coverage, apply declared setup, assert results,
   and preserve evidence. A runner uses sessions; interactive development does not require a test run.

Start with a small typed API in production tooling, invoked by CLI and Studio adapters. Add a thin
versioned request/response transport only where a process boundary needs it; do not start by building
a daemon, plugin ecosystem, or general remote-execution service. The host-neutral Effects core stays
in the shipped runtime and gains no browser, device, process, or runner dependencies.

## Driver choices and tradeoffs

| Backend                    | Recommended role                                            | Reason and limit                                                                                                                                 |
| -------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Playwright library         | Owned browser development and acceptance sessions           | Maintained locators, real input and browser contexts reduce custom automation work. Tao owns explicit context cleanup and library-level tracing. |
| Existing Chrome CDP driver | Preserve existing callers; narrow attach/debug escape hatch | Useful for existing Studio work. Do not build a second full locator/runner API or make raw evaluation the common interface.                      |
| Appium XCUITest            | iOS simulator now; physical iOS next                        | The persistent W3C surface passed the real simulator journey and fault probe. Physical-device UI acceptance is still unproved.                   |
| Appium UiAutomator2        | Android emulator now; physical Android next                 | The same compiled Tao journey passed on a real emulator, with isolated ports, artifacts, cleanup, and fault detection.                           |
| Studio semantic RPC        | Fast native Studio development                              | Source-aware observation and revision publication stay inside the owned shell and do not claim external accessibility acceptance.                |
| Appium Mac2                | Serialized external Studio acceptance                       | It owns the macOS physical-input lease. This host reaches WDA but currently stalls while creating the Mac2 session.                              |

Playwright separates its library from its test runner. The library can serve an interactive session
without test callbacks; its caller must close contexts and arrange tracing and waits. Keep Playwright
Test for the current browser proofs without making it Tao's universal scheduler or host-free test
runner. [Library documentation](https://playwright.dev/docs/library).

Prefer a browser launched under the driver's ownership. Attaching over CDP is Chromium-only and
documented as lower fidelity than a Playwright-protocol connection. Report reduced capabilities
instead of pretending an attached human browser has a fresh isolated context.
[Connection documentation](https://playwright.dev/docs/api/class-browsertype).

Appium XCUITest supports real iOS devices. The simulator proof now covers startup, hierarchy queries,
touch input, screenshot, application relaunch, cleanup, and an authored fault. Parallel sessions use
distinct device IDs, WDA and MJPEG ports, and derived-data paths. Physical-device signing, attachment,
and UI assertions remain for the next slice.
[Driver overview](https://appium.github.io/appium-xcuitest-driver/),
[parallel setup](https://appium.github.io/appium-xcuitest-driver/latest/guides/parallel-tests/).

## Minimal common contract

Expose session identity/status/capabilities, inspect, screenshot, tap/click, type, key, scroll,
bounded observation waits, explicit lifecycle operations, and release. Start with the operations
needed by HNReader, Clockwork and one visual-editing loop. Platform-specific operations remain named
capabilities, with a clear unsupported result when unavailable; a browser refresh and OS process
relaunch must never silently substitute for one another.

Keep source-aware inspection separate from host accessibility inspection. `StudioCdp` currently
uses DOM selectors and CDP input. Compiler Studio metadata already carries source path/range,
owner and element identity; the runtime lowers public test tags to `testID` in ordinary builds.
Studio's native gateway already supports source highlighting, captures and source actions.
Those are valuable production seams, but not yet one supported external automation protocol.

Relevant owners:

- `packages/ides/studio-tooling/studio-tooling-src/StudioCdp.ts`
- `packages/compiler/compiler-src/codegen/app/TaoPropsCompiler.ts`
- `packages/apps/runtime/TaoRuntime-src/TR-interaction-outline.ts`
- `packages/apps/runtime/TaoRuntime-src/TR-studio-device-inspect.ts`
- `packages/ides/studio/studio-src/device/StudioDeviceGateway.ts`

A semantic target needs both authored identity and a concrete rendered occurrence, scoped to session,
build/source revision and preview cell where applicable. Source offsets alone cannot distinguish
repeated rows or remain valid across edits. Reject stale targets and re-inspect rather than tapping
whatever now occupies their old coordinates.

For user-facing acceptance, resolve the semantic target to host input, perform the real action, and
assert an independently observed result. Directly invoking a runtime action is a different, explicitly
named semantic operation; it cannot prove hit testing, accessibility, occlusion or OS lifecycle.
Do not derive expected output from the same semantic tree being tested. Keep source-edit/capture
bridges opt-in to Studio/test entries; release apps retain their public test IDs without publishing
private source paths or development control endpoints.

## Parallel development

- One mutable controller per target lease; multiple observers may consume serialized snapshots and
  events. A simulator and a physical device are exclusive targets. A browser context can be an
  independent target when the driver owns its storage and lifecycle.
- Use a machine-wide lease registry across worktrees, with owner liveness, a generation/fencing
  token, explicit handoff and safe recovery. Expiry alone must not authorize killing an active app.
  Do not import the existing repository-test lease implementation into production; extract a small
  production primitive only with its current callers preserved.
- Native pool allocation and build concurrency have separate bounded budgets. Begin with explicit
  target allocation and demonstrate two simultaneous simulators before introducing adaptive sizing.
  The configured pool limit is visible; never preempt a live development session automatically.
- Every session owns its driver ports, app identifier/data policy, artifacts and build output.
  Resource exhaustion queues or reports busy instead of falling back to another session's device.
- Studio semantic sessions share one owned process and use a process-wide operation and revision
  fence. Appium Mac2 separately owns the global `macos-physical-input` lease.
- Development sessions retain state and support fast refresh and visual iteration. Acceptance
  sessions bind an immutable build identity and explicit initial state. Promotion creates a separate
  acceptance session; an edit cannot silently alter a run already claiming that build.
- Live effects are the development default. Deterministic scenario/time/random controls are explicit
  options shared by development and tests, never installed as a side effect of acquiring a host.

## Debugging and evidence

Use one session artifact manifest linking command receipts, target/build identity, source revision,
capabilities, screenshots, console/device logs, and the original driver trace or flow report. Preserve
vendor artifacts instead of translating away useful detail. A failed command should identify its
target, last observation and relevant artifacts, with failure classes separating busy/unsupported,
stale target, build failure, host failure and application assertion failure.

Read-only observation may retry bounded transient failures. Do not automatically repeat mutating
input, installs or source edits after an ambiguous timeout. Inspect the resulting state or start an
explicit new acceptance attempt, retaining the failed attempt. Closing a browser context must flush
its artifacts before releasing ownership; device cleanup must verify the lease and isolated app ID.

Normal Appium close writes receipts and server logs, deletes the remote session, stops the owned
server, uninstalls the isolated application, and releases ports and the target lease. Worktree removal
cannot prove that those host resources stopped, so runtime cleanup remains necessary. An ambiguous
remote deletion retains its lease to prevent another session from reusing a live target.

## Completed slices and next set

Slices 1–4 are implemented additively:

1. iOS simulator journeys execute the compiled Tao plan through Appium XCUITest, including cleanup,
   artifacts, relaunch persistence, and deliberate-fault detection.
2. Studio exposes semantic development control through its owned Electrobun process. The Appium Mac2
   seam and smoke are implemented; this host currently stalls while creating the Mac2 WDA session,
   before product assertions.
3. Host sessions isolate target leases, ports, application identifiers, revisions, and artifacts.
   Browser concurrency is proved; native allocation has host-free proofs and real single-target runs.
   A simultaneous multi-simulator host proof remains outstanding.
4. Android emulator journeys execute the same compiled Tao plan through Appium UiAutomator2,
   including cleanup, artifacts, relaunch persistence, and deliberate-fault detection.

The next slice set is:

5. **Physical-device UI acceptance.** Execute the authored journey through Appium on explicit iOS
   and Android devices, keeping installation receipts distinct from UI assertions and adding
   device-safe cleanup and retention policy.
6. **Studio as a Tao app.** Make Tao Studio buildable and developable through the Tao CLI toolchain,
   then run its semantic development and native acceptance surfaces against that product path.

The current additive prototype and its [handoff evidence](Real-host%20testing%20handoff.md) remain the
reviewable milestone. Existing in-process suites and their gate membership stay intact.
