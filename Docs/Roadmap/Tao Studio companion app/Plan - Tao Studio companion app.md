# Plan - Tao Studio companion app

Status: product direction settled; the development foundation, Slices 1 and 2, and the packet-23 trust and
rediscovery hardening are implemented in software. Slice 3's Tao Lens has landed;
its selected-render browser and physical-device acceptance runs remain to be proved. Physical cable/LAN
evidence remains separate and unverified here. Slice 4 is deferred until after the public MVP;
later product slices remain planned. This plans a
Tao-published iPhone and iPad companion for Tao Studio:
developer tooling first, then an invited-project beta, feedback, and collaboration client. Product
interactions here do not adopt new Tao language semantics; new source spelling still follows the
Revolution decision and WordFlower tranche process.

The initial local development host uses the exact Tao version that serves its Metro bundle. A store
Companion for invited beta builds remains a tentative path; its update mechanism, native compatibility,
and App Store acceptance require separate proof.

Implementation handoff (archived, Slice 1 landed): `Docs/Archive/Plans/Prompt - Implement Slice 1.md`.

Existing boundaries remain authoritative:

- [Native device as a Studio canvas](../../Archive/Explorations/Exploration%20-%20Native%20device%20as%20Studio%20canvas.md)
  owns the two-plane protocol, source authority, revision identity, security, and real-device proof.
- [Tao Studio](../../Spec/Tao%20Studio.md) owns the implemented workbench, semantic source actions,
  scenario cells, capture, design inspection, tests, and multi-project sessions.
- [Beta distribution in one command](../Tao%20ship/Plan%20-%20Beta%20distribution%20in%20one%20command.md)
  owns membership, compiled-bundle delivery, and the no-public-sharing rule.
- [Deterministic simulation](../Deterministic%20simulation.md) owns the future deterministic journal,
  scripted world, replay, and time-travel contract.

## Direction settled - 2026-09-02

Build the companion app with these committed product capabilities:

- trivial local or internet pairing with Studio;
- project, app, variant, scenario, state, persona, and compatible-revision switching;
- Fast Refresh with exact compile/apply acknowledgement;
- native inspection, logs, provider/network activity, performance, tests, and automation controls;
- loading Studio state onto a device and capturing device state back;
- speaking, replaying, editing, and saving user-story journeys;
- an iPad-first pen-and-touch canvas that edits real Tao view definitions;
- invited beta delivery, semantic feedback, visual/theme proposals, and replies;
- permission-controlled project forks and proposals shared back;
- physical-device failure replay promoted into regression coverage;
- multi-device and multi-account stories controlled as one journey.

The companion is not desktop Studio squeezed onto a phone. It is the physical-device canvas, probe,
recorder, sketch surface, replay target, and collaborator client of the same Studio session.

## Product shape and authority

- **Home** shows owned/joined projects, nearby and remote Studio sessions, invitations, beta updates,
  assigned test missions, feedback replies, and forks.
- **Run** gives the Tao app the real device at true scale. A small movable Tao affordance opens project,
  scenario, inspect, sketch, record, story, trace, replay, environment, and refresh controls.
- **iPad workbench** surrounds a focused view with component/project-view palettes, entity fields,
  design tokens, layout controls, variants, history, and a pen-and-touch canvas.
- **Developer, tester, and collaborator** are server-authorized capability sets, not client flags.

Tao source on the developer's Mac or trusted project server remains the only source authority. The
device sends typed, revision-bound proposals; Studio validates project, app, compile, manifest, cell,
preview instance, source version, owner, node kind, and preconditions before writing. The device applies
only the compiled revision Studio acknowledges in response. Optimistic ink or drag feedback remains
visibly provisional until that round trip completes.

The durable concepts are `DeviceSession`, `StoryPlan`, `RecordedJourney`, `SketchProposal`,
`FeedbackBundle`, and `ComparisonSession`. These names describe protocol concepts, not settled public
TypeScript types or Tao syntax.

## Connection: make pairing disappear

One `tao-studio-device-v1` control protocol supports three transports:

1. **Development bootstrap.** Studio gives the installed development client its Metro URL, candidate
   Studio gateway addresses, and an ephemeral pairing attempt. Both screens show the same short
   authentication code before Studio grants persistent device trust.
2. **Dependable LAN path.** Studio advertises authenticated Bonjour candidates. The current iOS module
   discovers `_tao-studio._tcp` on the local domain through Foundation's `NetServiceBrowser` and
   `NetService`; a trusted device verifies the pinned Studio identity before adopting rediscovered
   endpoints. This implementation does not claim peer-to-peer Wi-Fi discovery.
3. **Internet path.** Studio and device hold outbound authenticated WebSockets to the Tao relay. The
   relay routes encrypted, project-scoped messages without gaining source or filesystem authority.

A QR/deep link remains the universal fallback. It contains endpoint, session id, Studio key fingerprint,
and one short-lived challenge, never a reusable credential. The device key lives in Keychain and enables
foreground reconnection while project trust and runtime compatibility remain valid.

Network.framework remains the preferred candidate if Tao later adds an explicitly supported
peer-to-peer browse/connect path; the current software does not use it. Do not build new work on
Multipeer Connectivity: its current public classes are deprecated. DeviceDiscoveryUI is not a Slice 1
dependency: its documented Mac app-to-app surface is Mac Catalyst, while Studio currently uses Electrobun.
Revisit it only if a maintained Catalyst or native helper boundary makes it an actual fit. Any future
transport UI must label **LAN**, **peer-to-peer**, or **Tao relay** truthfully. Backgrounding pauses the
control plane; foregrounding revalidates and catches up rather than pretending iOS guarantees a permanent
socket.

The code plane stays separate: Metro/Fast Refresh for development; a signed, runtime-compatible complete
update for a distributed preview. A control connection never grants arbitrary live code to an App Store
build.

## Development foundation - verified 2026-09-02

This is the historical baseline from which Slice 1 began. Bonjour has since landed in software; the Tao
relay, beta delivery, and App Store constraints remain later work.

### Live repository facts

Compatibility update, 2026-09-15: Tao now pins Expo SDK 57.0.23 and React Native 0.86.3, enables
Expo's iOS scene lifecycle support, and supports Xcode 27's Device Hub. The bullets below preserve
the SDK 54 baseline against which Slice 1 was designed and implemented.

- Tao currently pins Expo SDK 54 (`expo ~54.0.37`) and React Native 0.81.5. The runtime toolchain does not
  yet include `expo-dev-client`.
- Studio already owns one isolated Expo/Metro process per open project, prefers port 8081, allocates another
  port when needed, and starts Metro with `--host lan`. Studio and the companion must share that process;
  starting a second Metro is unnecessary and risks the wrong bundle or port winning.
- The Studio browser/API server is intentionally bound to `127.0.0.1` and rejects a mismatched Host. Keep
  that surface private. A phone must use a second, narrow, authenticated device gateway rather than expose
  all local Studio routes on the LAN.
- The current dev loop can list physical iPhones/iPads with `xcrun devicectl`, choose LAN or active
  `169.254.*` link-local addresses, and launch Expo Go with `--payload-url`. That proves the host-side seams,
  but Studio does not invoke them and Expo Go is the wrong permanent shell for the companion.
- Studio already has compile revisions, preview manifests, cell/scenario bootstrap, source-action envelopes,
  and applied-revision acknowledgement. The missing seam is a native `TaoStudioDeviceHost`; the existing
  preview bridge assumes a browser parent and DOM.

### Chosen development topology

```text
Tao Studio process
  127.0.0.1:<studio>       browser/Electrobun workbench and full local API
  <reachable-host>:<gate>  small authenticated tao-studio-device-v1 gateway
  <reachable-host>:<metro> one project-owned Metro serving web and native bundles
                                    |
                                    v
                         Tao Companion development build
```

- Add a fixed Expo development-build project under `packages/ides/studio-companion-app`. Keep it on the repo's
  SDK 54 line for this slice and install the SDK-matched `expo-dev-client ~6.0.21`; an SDK upgrade is a
  separate repository-wide change.
- Give the shell its own development bundle identifier and generated dev-client scheme. Its native binary
  changes only when native dependencies or app configuration change; Tao, TypeScript, and UI changes keep
  using Metro and Fast Refresh.
- Make the Studio preview runtime serve a platform host: browser keeps the existing preview root; iOS and
  iPadOS mount generated `TaoStudioDeviceHost` around the selected generated Tao app. One compilation and
  one Metro file graph therefore drive both canvases.
- Add `StudioDeviceGateway` beside, not inside, the loopback Studio server. The device initiates the
  WebSocket. The gateway exposes only pairing, session/app/scenario selection, cell bootstrap, revision
  state, device observations, and explicitly granted source-action proposals.
- Inject only non-secret bootstrap facts into the development manifest: gateway candidates, session id,
  protocol version, and ephemeral attempt id. Perform an authenticated ephemeral key exchange, compare a
  short code on both screens, then store the device key in iOS Keychain. Do not invent cryptography; choose
  a maintained protocol/library during implementation.

### First install and daily loop

Add these product commands; they do not exist yet:

1. **Install when native code changes:** `just studio-companion-install device="<name>"` runs Expo prebuild
   as needed and `bunx expo run:ios --device "<name>" --no-bundler`. The current SDK 54 CLI supports
   `--no-bundler`; this is the important correction to the old repository's install flow.
2. **Run Studio normally:** `just studio-native "<project>"` starts Studio's existing per-project Metro,
   compiler/watcher, loopback workbench server, and the new device gateway.
3. **Open on device:** Studio asks Expo for the iOS custom-runtime URL through `/_expo/open` when available,
   falling back to the SDK 54 `/_expo/link` redirect. It then launches the installed bundle id with
   `xcrun devicectl device process launch --payload-url <url>`. A QR for the same URL is always visible.
4. **Connect control:** the loaded device host tries the advertised gateway candidates, completes pairing or
   reconnects with its stored key, requests the selected cell, and acknowledges the exact revision it drew.
5. **Iterate:** Tao compilation updates the generated app; Metro/Fast Refresh updates the real device and web
   preview. Native rebuilds happen only after native dependencies, config plugins, entitlements, or app
   configuration change.

Studio should also expose `Open on Device`, `Copy device URL`, `Show QR`, `Reconnect`, and a diagnostic that
names the chosen Metro host, gateway host, ports, runtime, device, and failure layer.

### Network and cable behavior

- **Default:** same reachable LAN. This remains Expo and React Native's documented physical-device path.
- **Cable:** USB-C/Lightning reliably supports install and launch through Xcode/CoreDevice. It does not by
  itself promise that Metro traffic is port-forwarded. If macOS exposes an active iPhone link-local network,
  offer its `169.254.*` address as another candidate; validate it from the phone before selecting it.
- **Candidate selection:** prefer the host in Expo's own custom-runtime URL, then race/probe safe alternatives
  from the device. Do not blindly replace Expo's URL with the first Mac interface, and never send
  `localhost` to a physical device.
- **Restricted LAN fallback:** Expo's `--tunnel` can carry the Metro code plane, but it does not expose the
  separate Studio gateway. Full remote development waits for the Tao relay or an explicitly owned gateway
  tunnel; Slice 1 may require LAN or a proven cable network.
- **No private USB stack:** do not add `iproxy`, `usbmuxd`, or an undocumented port-forwarding dependency
  unless the real-device proof shows the supported LAN/link-local paths are insufficient.
- Add `NSLocalNetworkUsageDescription` and the development-only ATS local-network declaration to the
  companion app. Add `NSBonjourServices` when Bonjour browsing lands. Handle denial, macOS firewall/local
  network permission, captive-portal isolation, VPN interfaces, and network changes as named diagnostics.

### Old repository audit

| Previous approach                                                           | Decision here                                                                                                                                               |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fixed Expo development client, bundle id, and scheme                        | Keep. It is still Expo's recommended production-grade development shell.                                                                                    |
| `expo run:ios --device` for first install                                   | Keep, with `--no-bundler` so Studio remains the only Metro owner.                                                                                           |
| `devicectl` JSON discovery, installed-app check, and `--payload-url` launch | Keep through current TypeScript wrappers; Xcode 26.6 still exposes these supported commands.                                                                |
| Hand-built `{scheme}://expo-development-client/?url=...`                    | Replace as primary logic with Expo's open/link endpoint; retain construction only as a tested fallback.                                                     |
| Prefer an active `169.254.*` iPhone interface                               | Keep as a candidate only and prove it on the actual phone; a cable alone is not a Metro tunnel.                                                             |
| Bash, `jq`, `grep`, and failure-swallowing launcher scripts                 | Do not port. Use `@shared` process/filesystem wrappers, structured results, and Studio-owned lifecycle/errors.                                              |
| Start `expo run:ios` after Metro is already running                         | Drop. The old command omitted `--no-bundler` and could contend with the existing server.                                                                    |
| Expo Go as the physical shell                                               | Drop for the companion. It cannot carry arbitrary native modules/configuration and is tied to one SDK build.                                                |
| Custom `expo-dev-launcher` patch                                            | None found in the old tree or its relevant history; current SDK 54 documents the required generated scheme and deep link. Do not add a patch pre-emptively. |

### Slice 1 implementation boundaries

- **Native shell:** `packages/ides/studio-companion-app` app config, entry, fixed identity, dev client, local-network
  declarations, placeholder disconnected screen, and install recipe.
- **Studio lifecycle:** extend `StudioPreviewRuntime` and its Expo session with a custom-runtime device URL;
  add install/open actions without adding a second watcher, compiler, or Metro.
- **Protocol:** add a small versioned device protocol and `StudioDeviceGateway`; adapt existing
  manifest/cell/revision APIs internally rather than exposing the whole Studio HTTP server.
- **Generated runtime:** add `TaoStudioDeviceHost` with connect, pair, bootstrap, scenario switch, applied
  revision, reconnect, and an unmistakable disconnected/stale overlay.
- **Studio UI:** one device button/popover showing install state, connected device, transport, project/app,
  scenario, compile revision, applied revision, QR, and actionable errors.
- **Tests:** unit-test device parsing, endpoint selection, gateway authorization, stale/wrong-session messages,
  and lifecycle cleanup; integration-test simultaneous browser/native consumers and alternate Metro ports;
  close on a real iPhone, not a simulator.

The first physical proof must show: install once; launch from Studio; pair; render the selected Tao app;
switch among three scenarios; edit Tao and receive Fast Refresh; acknowledge the correct revision; reject an
invalid/replayed pairing attempt; disconnect/reconnect; and keep the browser/Electrobun Studio session usable
throughout. Record which of Wi-Fi and cable link-local actually worked on the test hardware.

### Non-development continuation

After Slice 1 is green:

1. Ship an internal/TestFlight companion shell with the same native capability fingerprint, no dev menu,
   and account login. TestFlight is the first distribution gate; an App Store build is not required by this
   slice.
2. Replace Metro bundles with complete, code-signed updates targeted to an exact native `runtimeVersion`.
   The client rejects a wrong runtime, signature, membership, project, or revoked revision before loading.
3. Move control traffic to outbound authenticated `wss` connections through the Tao relay while preserving
   the local Bonjour/QR route for a developer beside Studio.
4. Keep a per-project TestFlight-build fallback. Apple's App Review guideline 2.5.2 may prevent one public
   shell from downloading arbitrary app functionality; prove the membership-scoped model in TestFlight and
   obtain review feedback before making the universal shell a release dependency.

Primary current references: [Expo local development](https://docs.expo.dev/guides/local-app-development/),
[Expo SDK 54 dev client](https://docs.expo.dev/versions/v54.0.0/sdk/dev-client/),
[Expo CLI LAN/tunnel behavior](https://docs.expo.dev/more/expo-cli/),
[Expo development-build launching](https://docs.expo.dev/develop/development-builds/development-workflows/),
[React Native physical devices](https://reactnative.dev/docs/running-on-device.html),
[Apple local-network privacy](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy),
[Apple ATS local networking](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking),
[Apple networking guidance](https://developer.apple.com/documentation/technotes/tn3151-choosing-the-right-networking-api),
[Expo runtime compatibility](https://docs.expo.dev/eas-update/runtime-versions/),
[Expo update signing](https://docs.expo.dev/eas-update/code-signing/), and
[Apple App Review](https://developer.apple.com/app-store/review/guidelines/).

## Freehand view design with pen and touch

This is a first-class companion use.

### Load or lift out a real view

- Studio can send any view, scenario, arguments, fixture state, appearance, and device class to iPad.
- Long-press a running instance and choose **Edit definition** to open its owning view with the instance's
  current arguments captured into a focused Studio scenario.
- Applied edits update every visible instance in Studio and on connected devices.
- iPhone edits one true-scale cell; iPad holds the cell, surrounding controls, variants, and loose sketch
  material on one canvas.

### Pen, touch, palettes, and direct manipulation

- Apple Pencil draws, writes, circles, strikes out, and marks intent; touch selects, moves, resizes, pans,
  scrolls, and operates controls.
- Use [PencilKit](https://developer.apple.com/documentation/pencilkit) for low-latency ink, stroke identity,
  lasso/eraser tools, and handwriting recognition. Tao owns shape/layout recognition and source actions.
- Draw-and-hold proposes a clean frame or placeholder. Scribble inside it can propose `Text`; a handwritten
  component or field name resolves against the typed project catalog.
- Drag components, project views, entity fields, tokens, and scenario values directly onto the frame.
- Edge drags map to `fill`, `hug`, or a measured dimension; item drags map to move/reorder; container and
  inferred-flow changes use explicit reviewable actions.
- Color, ink, typography, spacing, radius, alignment, size, conditions, binding, and variant scope remain
  one tap away around the canvas.

### Free sketch to real layout

- A free sketch may preserve measured absolute placement temporarily. The exact draft representation and
  syntax remain a separate design decision.
- **Snap to flow** proposes hierarchy, direction, padding, gaps, `hug`/`fill`, and nested containers. Studio
  shows the inferred tree and source diff before applying.
- **Unsnap** returns measured flow layout to editable positions without losing elements or bindings.
- Raw ink can remain an annotation layer. It is never silently interpreted as source.
- Release compilation refuses unresolved placeholders or free-layout drafts that have not graduated into
  supported Tao views and layout.

Every recognized edit is one source action or one explicitly grouped checkpoint. Stale proposals,
ambiguous recognition, and unsupported layout retain their ink but never mutate source.

## Spoken user-story conductor

The person can address Studio or one companion instance:

> Create a document, go offline, edit it, reconnect, and show me what happens.

1. Apple's [SpeechAnalyzer](https://developer.apple.com/documentation/speech/speechanalyzer) or another
   selected provider produces text; transcription is not an execution plan.
2. Studio resolves phrases against the compiler-emitted action/command catalog, semantic selectors,
   scenario controls, typed data handles, and connected instances.
3. A visible `StoryPlan` contains typed steps, arguments, target device/persona, environment changes,
   waits, assertions, confidence, approvals, and unresolved phrases.
4. High-confidence, reversible, development-only plans may run after a compact preview. Destructive,
   externally consequential, permission-changing, credential-bearing, or ambiguous steps require explicit
   confirmation or correction.
5. Execution pauses at visible milestones. **Slower**, **pause**, **step**, **continue**, **repeat that**,
   and **save this story** operate the current journey.

The planner never invents coordinate taps. It offers semantic matches, asks once, or records an unresolved
manual step.

## Record interaction into an executable journey

Recording is being built elsewhere and is no longer part of this plan. What the companion owes it is
the same thing the rest of this plan already needs: Tao actions and render identity on the device,
not pixels. Nothing here should grow a second recorder.

## Developer device laboratory

- Switch project, app, variant, branch revision, scenario, fixture, account, and datasource.
- Load a scenario/capture; capture current device state back as a proposed fixture or report.
- Control appearance, locale, text size, reduced motion, orientation, permissions, location, notifications,
  lifecycle, and Tao-owned provider/network conditions where supported.
- Run a Tao journey on the real renderer, show each step, and jump failures to source.
- Stream console, fills/saves, network, actions, renders, memory, frame timings, thermal state, and failures
  into one causal timeline.

System-wide networking and OS permission dialogs are not faked. Tao-controlled providers use deterministic
scripts; true system UI uses a Mac-hosted XCUITest or manual outer lane where required.

## Tester, collaborator, and fork experience

- Invite named Tao accounts with explicit **run**, **comment**, **suggest design**, **suggest structure**,
  **view captures**, and **fork** capabilities.
- Send a compatible beta revision, changelog, scenario, persona, and optional guided mission.
- Attach comments, screenshots, voice notes, gesture recordings, and suggestions to semantic UI nodes.
- Enter edit mode to reorder/resize supported elements and adjust permitted tokens or recipes.
- Preview original and suggestion against the same capture before sending.
- Studio receives one reviewable bundle and can run the suggested app before applying any source action.
- Replies and resolution survive revisions through semantic identity with source/range and screenshot
  fallbacks when a node disappears.

**Fork into my Studio** copies only the authorized source revision, selected fixtures, project metadata,
and compatible assets into a new project identity. Credentials, secrets, private captures/members,
signing identity, and provider authority never cross. **Share back** creates a comparison and change
proposal; it never merges automatically or grants write access to either side.

## Additional high-leverage target 1: Tao Lens and causal heat

Long-press any node to join its owning source, arguments, data/provider provenance, access rule, resolved
design, actions, test coverage, render count, invalidating read, JS/React time, network wait, and failures.
The same semantic identity highlights physical pixels, source, design inspector, data row, and performance
timeline.

Why it belongs: Studio already has render identity, selection, design inventory, capture, logs, and cells.
The new work is joining those facts plus runtime timing and reactive-dependency events. The result is a
distinctly Tao explanation, not embedded generic React tooling.

## Additional high-leverage target 2: reality to regression

Any manual, recorded, spoken, or failed session can become a durable reproduction:

- capture compatible state, persona, environment, sanitized provider/network transcript, build, semantic
  actions, and failure fingerprint;
- replay on a physical device, pause before the failure, and attach the debugger;
- trim the journal while checking the same fingerprint remains;
- save minimized state and journey as a fixture/scenario/test proposal;
- link the passing regression on the fixed revision back to the report.

Why it belongs: capture and transient replay exist, record mode supplies the missing journal, and the
deterministic-simulation program defines the path from best-effort reproduction to guaranteed replay.

## Additional high-leverage target 3: multi-device story orchestra

One story can name several instances and personas:

> On the Developer's phone create the document. On Maya's iPad open it, go offline, edit it, then reconnect both.

Studio renders a lane per device/account plus one shared provider/world lane. It can pause all devices at a
barrier, allow deliberate concurrency, partition the network, and assert convergence or authority refusal.
A remote collaborator can perform one lane live while the rest remain scripted.

Why it belongs: it combines the story planner, recorder, deterministic network, membership, and existing
multi-cell Studio model into a proof environment ordinary mobile tooling rarely provides.

## Additional high-leverage target 4: parallel-universe review

Hold one scenario/capture constant while rendering current versus branch, original beta versus tester
suggestion, two themes, or crash revision versus candidate fix. Studio shows the matrix; the companion can
swipe or alternate the same physical view with an unmistakable revision label. Later, compatible universes
can mirror input and produce state, visual, performance, accessibility, and outcome diffs.

Why it belongs: revision identity and capture loading exist. The first useful version needs only two
compatible cells and explicit non-mirrored comparison.

## Implementation sequence

Each slice ends with focused protocol/runtime/product tests, a real-device pass where named, and
`./agent verify`. Simulator evidence cannot close local-network, pen/touch, thermal, backgrounding, or
physical-rendering acceptance.

### 1. Pair and render one real device

- Fixed Expo development build, Studio-owned Metro, generated `TaoStudioDeviceHost`, and a separate narrow
  LAN device gateway.
- Supported install/open automation, direct-address bootstrap, authenticated Bonjour rediscovery, QR
  fallback, short-code trust, cross-process revocation, reconnect, LAN/cable selection, and exact
  revision acknowledgement. DeviceDiscoveryUI and the internet relay do not block this slice.
- Render the selected app and switch among three scenarios.

Acceptance: a real iPhone installs without starting a second Metro, opens from Studio, pairs in a few taps,
renders and refreshes beside the browser/Electrobun canvas, switches three scenarios, reconnects without
rescanning, and rejects wrong/replayed/revoked trust. The proof records whether Wi-Fi or cable link-local
carried the connection; relay behavior is not required. **Still open:** every run so far has been Wi-Fi;
cable link-local is believed to work by construction (address selection already prefers a `169.254.*`
interface, see `Slice 1 - Device protocol and trust.md`) but has not actually been run with a cable
connected and Wi-Fi off — verify before treating this acceptance line as fully closed.

### 2. Everyday development canvas

- Project/app/variant/scenario/persona/revision switching.
- Fast Refresh, remount, relaunch, runtime capture, and restore controlled from Studio.
- Bidirectional selection and one device-originated layout action.
- Logs, compile/apply state, and provider/network controls.

Acceptance: edit Mac to native frame, select both ways, capture/restore WordFlower state through Studio,
and report whether compatible state survived refresh. A device journey is part of Slice 4.

### 3. Tao Lens and diagnostics

- Join source, render, design, data, action, scenario, logs, tests, performance, and reactivity.
- Add the causal timeline and public-API device observations.

Acceptance: select one slow render and reach its source, invalidating state/data, resolved style, provider
wait, and covering journey without manual correlation.

### 4. Record and replay a semantic journey (after public MVP)

The Developer deferred this entire slice on 2026-09-22. The saved source shape, expectation authoring,
unresolved native or foreign step behavior, and draft editing scope remain open decisions for when
the slice resumes. Its acceptance below is not a public-MVP release gate.

- Live semantic script, editing, expectations, replay, and reviewed test/journey proposal.
- Preserve unresolved foreign/native steps honestly.
- Run a journey on the live device renderer with visible step results.

Acceptance: record a five-step WordFlower story on iPhone, remove an incidental step, replay it, and save a
passing Tao test proposal.

### 5. Speak a story into existence

- Transcription, typed planning, confidence/approval boundaries, pause/step/correction, and saving.
- Compose spoken and manual recorded portions.

Acceptance: create/offline/edit/reconnect plans and runs with visible pauses; ambiguity and consequential
actions do not auto-run.

### 6. iPad freehand view workbench

- Lift out a view with scenario/arguments; PencilKit ink; touch manipulation; palettes, fields, design,
  and provisional source-action feedback.
- First recognizers: frame, text, component/field, move, resize, color, and one container conversion.
- Free-to-flow proposal with inspectable tree/diff and recoverable raw ink.

Acceptance: edit a real WordFlower row with Pencil and touch, review exact Tao on Mac, apply, and observe all
instances update.

### 7. Invited beta feedback and proposals

- Accounts, membership, capability grants, beta revisions, missions, feedback, privacy preview, visual/theme
  suggestions, comparison, replies, and resolution.

Acceptance: a non-developer accepts an invite, completes a mission, comments on one node, proposes one
layout/theme change, and the developer runs that suggestion in Studio.

### 8. Fork and share back

- Authority-stripped project copy, independent Studio development, and comparison/change proposal.

Acceptance: the fork contains permitted source/fixtures, no original authority or secrets, and cannot mutate
the origin without explicit acceptance.

### 9. Reality to regression

- Failure capture, provider/network journal, fingerprint, minimization, debugger handoff, device replay,
  and regression-source proposal under the deterministic-simulation contract.

Acceptance: one device failure replays to the same fingerprint, loses an irrelevant step, becomes a failing
test, and passes against the fix.

### 10. Multi-device and parallel universes

- Named device/account lanes, barriers, shared scripted world, remote live lane, and convergence/authority
  assertions.
- Two-revision comparison, then optional mirrored input and semantic/performance diffs.

Acceptance: one two-account offline/reconnect story runs across two physical devices, and one capture
compares original versus fixed without crossing state or identity.

## Security, privacy, and product gates

- Project membership is the only remote access model; no public gallery or share-to-anyone URL.
- Pairing grants named render, inspect, record, comment, propose, or fork capabilities.
- Devices never receive filesystem paths, signing credentials, provider admin credentials, or unrelated source.
- Production data/captures are excluded unless the project explicitly supplies a safe redacted source.
- Every upload previews included domains and redactions; every artifact records author, project, revision,
  retention, and revocation provenance.
- App Store guideline 2.5.2 remains a product risk. Development builds and TestFlight prove value before
  the public shell becomes critical; there is no device compiler or public project distribution surface.
- Speech and freehand recognition produce proposals. Low confidence never mutates source or triggers a
  consequential action.

## Required physical validation

- iPhone and iPad; Pencil and finger; portrait/landscape; Light/Dark; large text.
- LAN, peer-to-peer if adopted, relay, offline, network transition, background/foreground, revoked trust,
  unavailable Studio/Metro, and incompatible runtime.
- Correct, stale, wrong-project/app/cell/owner, revoked, malformed, oversized, and replayed messages.
- Speech permission denied, partial/ambiguous transcription, unsafe action, unavailable provider, correction.
- Pen/touch collision, accidental ink, correction, stale sketch, rejected source, compile failure, undo,
  and reconnect with provisional work.
- Report redaction, revoked membership, fork stripping, deletion, and audit.

## Open decisions before their slices

1. Whether DeviceDiscoveryUI becomes useful through a future Mac Catalyst/native helper boundary. It is not
   required for the Electrobun-hosted development path.
2. The free-sketch development representation and graduation into supported flow layout; no syntax is
   adopted here.
3. Which Tao actions are safe and reversible enough for high-confidence spoken auto-execution.
4. The exact source produced by record mode and how a person chooses journey versus behavior test.
5. Which capture domains a tester may share by default and which need per-report approval.
6. App Store acceptance of the membership-scoped compiled-bundle shell; TestFlight remains the fallback.
