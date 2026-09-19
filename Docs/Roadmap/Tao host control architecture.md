# Tao host control architecture

## Status and recommendation

Research and repository inspection on 2026-09-19 support one Tao-owned API for interactive development
and real-host testing, with target-specific drivers underneath. Ro delegated the recommendation using
simplicity, maintainability, ease of use, debugging, and parallel development as the priorities.
The additive first implementation now lives in `packages/host-control`,
`packages/host-control-playwright`, and `packages/e2e-testing/journey`; existing coverage remains.

“Tao CDP” describes the desired control surface here; it does not mean implementing Chrome DevTools
Protocol on every host. The existing `StudioCdp` is a Chrome driver, not the source-aware contract.
Avoid a permanent second general browser driver or an abstraction containing every vendor method.

Use Playwright's library for the default browser adapter. Keep the current Maestro simulator journeys
as batch acceptance evidence. Evaluate Appium XCUITest in a bounded native session spike when adding
interactive control and physical iOS acceptance; do not install its server/signing machinery merely
to complete the current prototype. If it proves suitable on both simulator and device, prefer one
native driver for development and acceptance over maintaining two equivalent long-term implementations.

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

| Backend                    | Recommended role                                             | Reason and limit                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Playwright library         | Default owned browser sessions                               | Maintained locators, real input and browser contexts reduce custom automation work. Tao owns explicit context cleanup and library-level tracing. |
| Existing Chrome CDP driver | Preserve existing callers; narrow attach/debug escape hatch  | Useful for existing Studio work. Do not build a second full locator/runner API or make raw evaluation the common interface.                      |
| Maestro                    | Existing simulator acceptance flows                          | Useful native input and artifacts; its documented CLI/flow surface is not a general persistent interactive SDK.                                  |
| Appium XCUITest            | Optional native-control spike for simulator and physical iOS | Real-device support and a persistent command surface fit interactive sessions, at the cost of WDA, signing, ports and startup complexity.        |

Playwright separates its library from its test runner. The library can serve an interactive session
without test callbacks; its caller must close contexts and arrange tracing and waits. Keep Playwright
Test for the current browser proofs without making it Tao's universal scheduler or host-free test
runner. [Library documentation](https://playwright.dev/docs/library).

Prefer a browser launched under the adapter's ownership. Attaching over CDP is Chromium-only and
documented as lower fidelity than a Playwright-protocol connection. Report reduced capabilities
instead of pretending an attached human browser has a fresh isolated context.
[Connection documentation](https://playwright.dev/docs/api/class-browsertype).

Maestro's CLI executes flows, while Studio provides interactive authoring. Its web support currently
documents Chromium-only beta behavior and preset viewport/locale restrictions, so it is not the
recommended browser foundation. Its documented iOS workflow establishes simulator support; physical
iOS acceptance remains unproved in this project.
[CLI](https://docs.maestro.dev/maestro-cli),
[web support](https://docs.maestro.dev/get-started/supported-platform/web-browser),
[iOS support](https://docs.maestro.dev/get-started/supported-platform/ios).

Appium XCUITest supports real iOS devices, but a usable spike must measure cold and warm startup,
signing recovery, screenshot/hierarchy latency, keyboard input, gestures, app relaunch, and repeated
attachment on this machine's iOS/Xcode versions. Parallel sessions need distinct device IDs, WDA
local ports and derived-data paths. These are reasons to test it, not a claim it already works here.
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

- `packages/dev/dev-src/studio/StudioCdp.ts`
- `packages/compiler/compiler-src/codegen/app/TaoPropsCompiler.ts`
- `packages/runtime/TaoRuntime-src/TR-interaction-outline.ts`
- `packages/runtime/TaoRuntime-src/TR-studio-device-inspect.ts`
- `packages/studio/studio-src/device/StudioDeviceGateway.ts`

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
  independent target when the adapter owns its storage and lifecycle.
- Use a machine-wide lease registry across worktrees, with owner liveness, a generation/fencing
  token, explicit handoff and safe recovery. Expiry alone must not authorize killing an active app.
  Do not import the existing repository-test lease implementation into production; extract a small
  production primitive only with its current callers preserved.
- Native pool allocation and build concurrency have separate bounded budgets. Begin with explicit
  target allocation and demonstrate two simultaneous simulators before introducing adaptive sizing.
  The configured pool limit is visible; never preempt a live development session automatically.
- Every session owns its driver ports, app identifier/data policy, artifacts and build output.
  Resource exhaustion queues or reports busy instead of falling back to another session's device.
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

## Candidate slices for discussion

Implementation status on 2026-09-19: slice 1 has a versioned Tao plan/interpreter and additive browser
execution, while native execution still uses retained Maestro YAML; slice 2 has a real Playwright
library adapter and concurrent-context proofs, but no CLI/Studio operator surface; slice 3 has a
fenced Appium/XCUITest contract and fake-client parallelism proofs, but no real Appium/WDA run.

1. **Tao-authored real-host journeys (recommended first).** Compile the existing HNReader persistence
   journey into a source-linked declarative plan and execute it on browser and simulator; add the
   Clockwork journey in Tao. Keep compiler/plan ownership independent of the drivers. Any retained
   Maestro YAML becomes generated driver output. Acceptance: one authored journey per behavior,
   real host input and lifecycle, source-line failures, explicit unsupported capabilities, and the
   same deliberate countdown/persistence faults detected on both hosts. Existing in-process suites
   stay intact. This removes duplicate authoring before expanding the driver surface.
2. **Owned browser development sessions.** Extract the reusable production host-control boundary
   beneath `packages/e2e-testing`, backed by Playwright library. Demonstrate two concurrent sessions
   with inspection, screenshots, input, explicit close and a visual-editing loop. Acceptance: no
   cross-session storage/input/artifact interference, revision-bound observations, and a separate
   immutable acceptance run after editing. Start with the capabilities that those demonstrations need.
3. **Persistent native control and physical-device acceptance.** Evaluate an Appium XCUITest session
   on a simulator and roPhone against the existing HNReader lifecycle journey and a visual-edit loop.
   Add explicit per-target ownership and prove a second simulator is unaffected by the first session's
   input and cleanup. Acceptance: actual physical UI assertions, source/build/target receipts,
   stale-owner rejection, and measured startup/debugging costs before selecting the lasting native
   driver. Full pooling, adaptive budgets and retention policy follow this bounded proof.

Slices are proposals, not scheduled implementation or completed capabilities. The current additive
prototype and its [handoff evidence](Real-host%20testing%20handoff.md) remain the reviewable milestone.
