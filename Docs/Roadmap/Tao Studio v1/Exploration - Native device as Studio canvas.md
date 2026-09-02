# Exploration - Native device as a Studio canvas

Status: feasible design, not implemented. This report is the final architecture exploration requested
for Tao Studio v1; it does not close the required real-device spike or authorize a production
implementation.

Direction settled 2026-09-02: the first mode below ships as the **Tao Studio companion app**, a
Tao-published phone app for the development experience and for pre-release testing by members
invited to a project on the Tao Lang servers; `tao ship <App> --beta` delivers through it. The
decision, its App Store rules, and its design rules are in
`Docs/Roadmap/Tao ship/Plan - Beta distribution in one command.md`; the program is open work in
`Roadmap.md`.

## Verdict

1. **Expo development build on the LAN — adopt.** A Studio-instrumented development client can use
   Metro/Fast Refresh for code and an authenticated Studio WebSocket for cell assignment, selection,
   and semantic source actions. Start here.
2. **Ad hoc, internal, or TestFlight preview build — limit.** Pairing and the control protocol are
   viable, but code delivery must use a compatible, signed update or an attached development server
   allowed by that build. Do not promise arbitrary instantaneous code replacement.
3. **Production/App Store build — reject for live compilation.** Do not place a general remote-code or
   editing backdoor in a production app. The safe remainder is inspection and source-action proposals
   against declarations already shipped in the binary; changed behavior appears only through the
   ordinary reviewed binary or signed-update path.

The first mode is technically credible because an Expo development build is the app's own native
binary with development tooling, can switch among development servers, and can connect to a local
server or tunnel. React Native Fast Refresh normally updates components quickly and preserves
compatible function-component state, but it can remount after some module-boundary or runtime
changes. The design must therefore treat preservation as conditional, never as a protocol promise.

The production limitation is deliberate. Apple's App Review Guideline 2.5.2 prohibits downloaded
code that introduces or changes app functionality, subject to narrow exceptions that do not describe
an ordinary Tao app. Expo updates also require native-runtime compatibility; their code-signing and
runtime-version mechanisms are the right boundary for a distributed preview build, not a way to
bypass review or turn a production app into an unrestricted Studio client.

## Proposed architecture

The native client is another renderer for the existing Studio project session. It does not become a
source authority and does not expose a second editing protocol.

There are two coordinated planes:

1. **Code plane.** In a development build, Metro and Fast Refresh publish compiled JavaScript. In an
   internal preview build, an explicitly compatible signed Expo update may publish a complete
   revision. The device must acknowledge the loaded bundle hash and compile revision before Studio
   applies cell configuration for that revision.
2. **Control plane.** One authenticated `tao-studio-device-v1` WebSocket carries pairing, capability
   negotiation, manifest revisions, opaque preview-instance assignment, cell configuration,
   selection/highlight events, source-action requests, acknowledgements, revocation, and reconnect
   recovery. Source code and credentials do not travel in preview URLs.

The device host uses the same identity tuple as a desktop cell:

```text
project + appName + manifestRevision + compileRevision
        + cellId + cellRevision + previewInstanceId
```

`previewInstanceId` is random and opaque. It locates a server-held bootstrap record; it is not a
container for arguments, fixture rows, state, file paths, or secrets. Every message that mutates or
selects a cell carries the full tuple, and Studio rejects stale compile, manifest, cell, and instance
revisions before doing work.

### Pairing and trust

Studio advertises a Bonjour service on the LAN and also offers a QR/deep-link fallback. The QR contains
only a Studio endpoint, session identifier, Studio public-key fingerprint, and a single-use,
short-expiry pairing challenge. It must not contain a reusable bearer credential.

Pairing proceeds as follows:

1. The instrumented app opens an explicit **Connect to Tao Studio** screen. Nothing listens or pairs
   silently in an ordinary app session.
2. The device scans the QR or chooses the discovered Mac. Both sides display the project, app,
   device, build channel, runtime version, and a short verification code; a person confirms both.
3. A TLS-protected challenge exchange proves the one-time secret and pins the Studio session key.
   Studio issues a short-lived token bound to the project, app bundle identifier, device key,
   runtime fingerprint, and requested capabilities. The device stores only the device key in the
   platform keychain.
4. Studio can revoke one device or all tokens for the session. Closing the project invalidates its
   preview instances. A new project or incompatible native runtime requires a new confirmation.

iOS local discovery and direct LAN connections require a clear
`NSLocalNetworkUsageDescription`; Bonjour browsing also requires the used service type in
`NSBonjourServices`. The request should occur from the foreground pairing screen. A tunnel can be an
opt-in fallback, but it increases latency and moves traffic through a third party, so Studio must show
that change in trust boundary before connecting.

### Protocol outline

All envelopes include a protocol version, message ID, session ID, and monotonic sequence. Commands
receive an acknowledgement or a typed rejection.

```text
device.hello          protocol, device/build/runtime fingerprint, last acknowledgement, capabilities
studio.welcome        project/app identity, revisions, permissions, heartbeat and expiry
studio.codeAvailable  compile revision, bundle hash, delivery mode
device.codeApplied    compile revision, bundle hash, refresh outcome, state-preservation outcome
studio.manifest       versioned fixture/scenario/subject/cell metadata
studio.assignCell     full cell identity, opaque instance ID
studio.configureCell  arguments, resolved data state, viewport/environment controls
device.cellApplied    full identity, measured native viewport, diagnostics
studio.highlight      version-bound semantic render identity
device.selectSource   full identity, semantic render identity
device.sourceAction   full identity, action kind, owner/range preconditions, typed operands
studio.actionResult   accepted/rejected, new source/compile revision, review checkpoint
studio.revoked        reason
```

Metro does not replace the Studio protocol. Fast Refresh tells the native runtime that code changed;
Studio still decides which scenario/view the device renders and whether a selection or source action
belongs to the current source. Conversely, Studio must not configure revision N until the device has
acknowledged loading revision N's bundle hash.

On reconnect, the device sends its last acknowledged sequence and full current identity. Studio
either replays a bounded retained suffix or sends a fresh manifest and cell assignment. A new
`previewInstanceId` invalidates the old instance. No queued device-side source action is replayed
automatically after ambiguity; the person must review and retry it against current source.

## Rendering and direct manipulation

The native device must render actual React Native/Expo components, navigation, datasource adapters,
fonts, safe areas, and device APIs. It is not a screenshot stream or a browser projection.

The first implementation should assign one focused view or app scenario to one device. A generated
`TaoStudioDeviceHost` mounts the selected subject with its fixture, ordered `prepare` changes, named
data state, and per-cell environment inside a scoped provider tree. The desktop matrix can assign
different scenarios to several connected devices.

Multiple cells on one phone are feasible only after all runtime catalog, data, navigation, clock, and
environment state used by a cell is instance-scoped. Rendering several React roots while leaving a
singleton registry underneath them is false isolation. Add an on-device grid only after tests prove
that writes, fills, failures, navigation, and refresh state cannot cross cell boundaries; until then,
one device renders one cell and Studio's desktop grid remains the multi-example overview.

Native direct manipulation reuses Tao's semantic source-action vocabulary:

- render metadata supplies the current declaration owner, source range, node kind, and cell identity;
- a native selection/overlay layer highlights without changing the component's layout;
- drag/drop, palette insertion, reorder, wrapping, and layout handles create typed source-action
  requests rather than text patches;
- the Mac validates identity and preconditions, writes Tao source, creates the review checkpoint, and
  publishes the next compile revision;
- the phone keeps no hidden durable edit state and cannot bypass a rejected action.

Touch interaction needs its own usability pass. A phone cannot faithfully reproduce a pointer-first
inspector: long-press may enter edit mode, handles need accessible alternatives, drag must coexist with
scroll and app gestures, and destructive or structurally large edits should require confirmation.

## Security and operational rules

- Compile Studio instrumentation only into explicit development/preview profiles. Production builds
  have no pairing listener, Studio token store, source-action sender, or remote bootstrap path.
- Use `wss:` outside a narrowly marked local-development exception. Pin the paired Studio session key;
  do not trust any host merely because it is on the LAN.
- Scope authorization independently for render, inspect, and propose-source-action capabilities.
  Pairing never grants filesystem access or permission to write source directly.
- Redact absolute source paths and provider credentials from device payloads. Use manifest-local IDs;
  resolve them to paths only inside Studio.
- Bound message sizes, fixture/state payloads, retained replay windows, and action rates. Reject unknown
  protocol fields that would broaden authority.
- Pause control-plane application in the background, preserve only the reconnect token, and require a
  foreground identity recheck before resuming edits. iOS background execution is not a persistent
  WebSocket guarantee.
- Treat fixture and captured provider data as potentially sensitive. Show what data domains a scenario
  will send, exclude production credentials by construction, and support per-domain redaction.
- The current browser transport's `Origin: null` allowance and URL-supplied parent origin are explicitly
  loopback-only scaffolding. Neither is part of the device protocol: a LAN listener starts only after
  authenticated pairing and rejects both shortcuts.

## Staged implementation

1. **Transport spike:** add an instrumented Expo development build, foreground QR pairing, authenticated
   WebSocket, capability negotiation, heartbeats, revocation, and reconnect. Render the existing app
   only; do not write source.
2. **Single-cell native host:** apply the existing manifest/cell identity, fixture data state, focused
   view arguments, and environment to one isolated native root. Coordinate Metro revision and cell
   revision acknowledgements.
3. **Bidirectional selection:** propagate current native render identity, highlight from Studio, and
   select source from the device. Prove stale and cross-project rejection.
4. **Semantic editing:** enable one phone-side reorder or layout action through the existing Mac-side
   source-action bus, review checkpoint, compile, and refreshed native render.
5. **Matrix and remote-network hardening:** add several devices, then multiple cells per device only
   after runtime isolation is proven. Evaluate an authenticated tunnel separately from LAN mode.
6. **Internal preview profile:** test signed compatible updates and runtime-version rejection. Keep the
   App Store production build out of scope.

## Required real-device proof

No physical-device proof was run during this exploration. A simulator is insufficient for local
network privacy, Bonjour permission, foreground/background transitions, thermal behavior, touch
gesture conflicts, and realistic reconnect latency. Adoption beyond a spike requires a real iPhone
and an existing Tao app to prove all of the following:

- pair and revoke on the LAN, including denied Local Network permission and QR fallback;
- focus one parameterized view with a fixture, then switch among at least three scenarios;
- edit on the Mac, apply the exact compile revision, and record whether compatible local state survives;
- select a render in both directions and submit one semantic device-side source action;
- reject stale compile/manifest/cell/instance identities, a wrong project/app/runtime, a revoked device,
  and an invalid source action without changing source;
- disconnect, background, change networks, reconnect, and recover from unavailable Studio and Metro
  hosts without replaying an ambiguous edit;
- measure pair time, code-to-frame latency, control round trips, refresh/remount rate, state loss,
  memory, and thermal impact for one cell and the proposed grid.

Until that proof passes, “native device as Studio canvas” remains feasible architecture, not an
implemented Tao capability.

## Primary references checked 2026-08-30

- [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/)
- [Expo development workflows, LAN/tunnel, and QR launching](https://docs.expo.dev/develop/development-builds/development-workflows/)
- [Expo runtime-version compatibility](https://docs.expo.dev/eas-update/runtime-versions/)
- [Expo Update code signing](https://docs.expo.dev/eas-update/code-signing/)
- [React Native Fast Refresh behavior and state limits](https://reactnative.dev/docs/fast-refresh)
- [Apple local-network privacy and real-device requirement](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)
- [Apple's native WebSocket task](https://developer.apple.com/documentation/foundation/urlsessionwebsockettask)
- [Apple App Review Guidelines, especially 2.5.2 and 2.5.4](https://developer.apple.com/app-store/review/guidelines/)
