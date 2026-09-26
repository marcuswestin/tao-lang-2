# E2E testing

This private package owns Tao's additive real-host testing prototype, including command dispatch,
Playwright controls and browser journeys, isolated host builds, native journey orchestration, receipts,
and harness fixtures. `HostTestingCommand.ts` is its public package entry. Existing suites and merge
gates are unchanged, and this package does not reuse their runners, fixtures, mocks, or `@shared/test`.

The related `tao-host-control` package owns host-neutral sessions, semantic targets, revisions and
fenced machine-resource leases. `tao-playwright-driver` supplies owned Playwright-library browser
contexts. `tao-appium-driver` owns the reusable W3C transport, Appium server lifecycle, and Mac2
controller. This package owns the iOS and Android target policies and compiled-journey adapters.

`playwright.config.ts` discovers tests only through scoped control and subject-specific browser globs
inside this package. HNReader is the only existing app admitted as a subject; Clockwork is a harness
fixture. Production compiler, runtime, Expo configuration, and shared utilities are reused.

## Subjects and evidence

- **HNReaderStub:** compiled Tao app with its deterministic news adapter. Browser navigation and
  reading-history persistence are checked through visible controls and a real page reload. The native
  journey uses OS termination/relaunch. This does not prove the live Hacker News service or CloudKit.
- **Clockwork:** new tiny Tao app with a countdown and seeded color choice. It makes controlled time,
  rendering, interaction, and isolation observable. It is a harness fixture, not product coverage.
- **Controls:** small host-free checks for independent environments, invalid controls, cleanup, and
  the effect/import boundary. These are explicitly lower-level harness checks, never e2e evidence.
- **Application faults:** `--fault` freezes Clockwork's countdown or suppresses HNReader's history
  writes in the isolated generated app. The same healthy UI assertions must fail at countdown advance
  or post-reload history. `build.json` records the exact mutation and before/after digests. These
  probes do not establish detection of every possible defect.

## Commands

Run from the repository root. `./agent test-host` delegates to the matching `just test-host` recipe.
Each invocation writes a unique `.artifacts/host-testing/<run-id>/` directory.
Retention keeps at most two failed runs within the shared 4 GiB budget. When a failed build exceeds
the remaining budget, generated app, export, dependency, and driver-build directories are removed
first; screenshots, proof receipts, logs, and browser traces remain eligible for retention. Active
runs and directories without trustworthy ownership receipts are preserved.

```sh
./agent test-host check
./agent test-host lint
./agent test-host typecheck
./agent test-host driver
./agent test-host prepare --app hnreader
./agent test-host export --app clockwork
./agent test-host browser --app hnreader
./agent test-host browser --app clockwork --seed 12345
./agent test-host browser --app clockwork --fault
./agent test-host browser --app hnreader --fault
./agent test-host ios --app clockwork --device <simulator-UDID>
./agent test-host android --app hnreader --device <emulator-serial>
./agent test-host device --app hnreader --device <physical-device-ID>
```

Both browser `--fault` commands are intentionally red; inspect the failed assertion before calling
that meaningful fault detection. A compile, browser-launch, or unrelated assertion failure does not
prove the fault was caught. `check --fault` is rejected because controls do not build an application.
`application-fault.json` classifies browser mutations as `detected`, `escaped`, or `inconclusive`;
only the expected named assertion failures, with no unrelated or global failures, count as detected.
Native mutation runs use the same verdicts, requiring matching build provenance, source-linked Appium
timelines, driver receipts, and the exact expected authored assertion. HNReader requires successful
history before an actual matching-app termination and relaunch, followed by the distinct post-relaunch
persistence assertion failure. Every mutation command
exits nonzero, including an escaped mutation; a generic host failure is inconclusive.
`prepare` only compiles; `export` also builds the web bundle. When either is run with `--fault`, its
receipt is explicitly `inconclusive` because no host assertion ran, even when mutation provenance is
valid. Neither claims UI behavior. Browser runs use installed Chrome with fresh Playwright contexts and
temporary profiles. To use Playwright's downloaded Chromium, run `setup`, then pass
`--browser-channel chromium`. A browser launch failure is a failed proof, not a skipped test.

Native runs require an explicit target and a unique test application identifier. iOS simulators use
Appium XCUITest and Android emulators use Appium UiAutomator2. Both current routes execute the compiled
Tao journey and preserve screenshots, driver receipts, server logs, and cleanup evidence. Physical iOS
currently provides a separate Release build/install receipt. It does not report a journey verdict or
imply physical-device UI acceptance. HNReader's native journey also brackets its authored steps with
mounted-native-stack receipts, checks again immediately before and after every relaunch, and rejects any stack fallback; its toggle bar keeps enclosing chrome
and does not claim native tab selection. Relaunch must be outside `select` blocks for these global
host receipt checks. See [native details](native/README.md).

### Native navigation acceptance

```sh
./agent unsandboxed test-host ios --app native-navigation --device <iPhone-or-iPad-simulator-UDID>
./agent unsandboxed test-host android --app native-navigation --device <emulator-serial>
```

This subject runs the authored three-stack state-preservation journey in
`Apps/Test Apps/Navigation/Native Navigation.test.tao`. The isolated wrapper subscribes to runtime
host diagnostics before loading the app. Visible receipts require mounted native tab and stack hosts
before and after the journey; any basic fallback permanently fails the receipt for that process.
The fixture's exact title strings occur only in its headers, so its title assertions use native text
instead of the basic host's test identifier. The iOS build enables tablet support.
Android text presses first match exact visible text, then the exact authored accessibility label
of a button in the same selection scope. This handles native buttons' uppercase visual titles;
text assertions remain case-sensitive and never use that press fallback.
Presses poll for the exact target to become visible using the same 10-second budget as assertions,
then dispatch one click. Missing or hidden targets can be retried; transport failures and dispatched
clicks cannot. A successful click response alone does not prove that navigation completed.
Native input entry waits for its editable target to be visible, then types once. Input assertions
poll for the exact visible value after transitions. Both use the same 10-second budget and propagate
transport failures immediately; typing is never retried.

Browser, export, driver, and `--fault` are explicitly unsupported for this subject.
`device --app native-navigation --device <physical-device-ID>` performs the separately reported
Release installation milestone; it does not run a UI journey or claim physical-device UI acceptance. `prepare` builds the isolated fixture without claiming host acceptance. The journey
covers switching tabs, pushed stack positions, typed drafts, local counters, and native Back. It does
not establish gesture cancellation, toolbar menus, presentation dismissal, or keyboard/safe-area layout.

## Time, randomness, and parallelism

`Effects.createSession` is a pure session object with an injected clock and its own seeded random stream.
The `RuntimeCore.ts` entry point at `@tao/runtime/core` exports the `Effects` namespace;
`@shared/core` and `@shared` re-export that same namespace. Its implementation remains in `Effects.ts`
and imports no platform modules. Keeping the implementation
in the shipped package avoids a new distribution dependency or copied implementations.
Two instances can run concurrently in one process when they own different clock instances. No global
`Date`, `Math.random`, or timer function is replaced. The clock port is deliberately small; the real-host
adapter supplies production `TR.Clock`, which controls runtime time reads and scheduled callbacks.

`RuntimeHostTestControl` installs exactly one runtime session in a JavaScript realm. Independent
Playwright browser contexts have independent realms, storage, clocks, and random streams. A native
process has one session; concurrent native sessions need separate OS processes/devices. Control requests
carry the run ID and reject mismatches. Reloading starts a fresh clock/random session while retained
app storage is available for a persistence journey.

Owned browser contexts are independent targets. Native targets and Appium driver ports use
machine-wide generation-fenced leases with process identity; a demonstrably live owner is never
reclaimed because its session is old. Acceptance sessions bind an immutable revision. Development
sessions may publish a revision only through a driver operation that actually refreshes or deploys it.
Appium close deletes the remote session, stops its owned server, uninstalls the isolated application,
and then releases target and port leases. An ambiguous remote delete retains the target lease; deleting
a worktree alone cannot prove that host services or installed applications stopped.

`HostTestEnvironment` adapts that core to a test bridge. The new test entry point alone installs
the bridge. Production entry points do not import it.
Browser tests use the bridge only for effects; product actions use real UI input. Native time advances
arrive through a run-scoped `taohostpoc-<run-id>` deep link and are confirmed through visible app state.
The canonical seed `12345` has literal visible-color assertions. Custom seeds retain validity and
cross-browser consistency checks, without a claim of an independently pinned native color sequence.

An AST linter checks files expanded from registered package, runtime host-testing, and runtime core
source globs for ambient clock, randomness, and timer calls, plus imports of legacy test infrastructure.
Every pattern must match, generated and dependency trees are excluded, and `effect-boundary.json`
records the sorted expanded paths. Deterministic `new Date(value)`, `Date.UTC`, and
`Date.parse` remain legal. Exact, named adapter exceptions are supported; they do not waive import
rules. This is a file-local prototype, not repository-wide enforcement or a security boundary:
dynamic property names, cross-file aliases, transitive dependencies, and arbitrary reflective calls
need stronger analysis before claiming comprehensive enforcement.

## Before promotion

- Retain the green browser, iOS-simulator, and Android-emulator receipts and establish physical-device
  UI acceptance through Appium. Keep build/install evidence distinct from UI assertions.
- Retain the demonstrated browser and simulator fault checks as the host coverage grows.
- Prove simultaneous multi-simulator allocation on the host; current real evidence covers one explicit
  iOS target and one explicit Android target, while host-free controls cover conflicting leases and ports.
- Resolve the Appium Mac2 WDA session-creation stall, then exercise external Studio accessibility and
  physical input. The semantic Studio development path is already a distinct real-shell proof.
- Make Studio a Tao app that is built and developed through the Tao CLI toolchain.
- Decide the production-wide effect interfaces and migrate callers before broadening lint enforcement.
- Map required behavior to independently asserted journeys and lower-level exceptions; prove parity
  before retiring any old suite. Measure the new suite's cost and diagnostic usefulness.
- Preserve generation-fenced device admission in every native-driver path and extend its concurrency
  proofs when new target kinds are added.

The compiled artifact digest identifies generated app files, not the full runtime/toolchain closure;
it is provenance for this prototype, not a cache key or a complete reproducible-build guarantee.
