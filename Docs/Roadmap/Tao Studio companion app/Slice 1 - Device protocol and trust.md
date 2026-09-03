# Slice 1 - Device protocol and trust

Status: Barrier 0 contract for [Prompt - Implement Slice 1](./Prompt%20-%20Implement%20Slice%201.md).
This is the settled seam between Tao Studio, its development tooling, the dependency-light runtime,
and the companion shell for **Pair and render one real device**. Later slices extend it; nothing here
adopts Tao language semantics.

## Topology and lifecycle

```text
Tao Studio process (one per `./dev studio` launch)
  127.0.0.1:<studio>   loopback Studio server: workbench, full API, Host-validated, unchanged
  0.0.0.0:<gateway>    StudioDeviceGateway: one WebSocket path, tao-studio-device-v1 only
  <lan>:<metro>        one project-owned Expo/Metro per open project, started with --host lan
                                 |
                                 v
                    Tao Companion development build (expo-dev-client)
                    loads the Metro bundle, mounts TaoStudioDeviceHost, dials the gateway
```

- `runStudioDev` starts the gateway once, before the first project opens, and stops it last. It
  never starts a second Metro, watcher, or compiler.
- The generated preview root selects a host by platform: `web` keeps the browser bridge; every other
  platform mounts `TR.Studio.DeviceHost` around the same generated Tao app, fixture, and scenario
  adapters. One compilation and one Metro file graph drive both canvases.
- The device learns the reachable Studio host from the URL its own bundle loaded from
  (`NativeModules.SourceCode.scriptURL`), and the gateway port from the Expo manifest
  `extra.taoStudioDevice.gatewayPort` that `StudioPreviewRuntime` writes into the isolated preview
  project's `app.json`. The preview project also declares `scheme: "taostudiocompanion"` so Expo's
  own `/_expo/link?choice=expo-dev-client` returns the companion's deep link. Nothing secret is in the
  manifest.
- The gateway resolves the project session from the Metro port the device names in its hello
  (every open project has its own port), or from an explicit `sessionId` when the device carries one.

## Trust model

Threats in scope: a device on the same LAN that was never paired; an attacker on the LAN who
observes, replays, reorders, or injects control frames; an active attacker who sits between phone
and Mac during pairing; a device whose trust was revoked; a stale device that reconnects to a
different Studio process or project.

Out of scope for this slice: an attacker who already runs code on the Mac or the phone; a
compromised Metro (the code plane is Expo's development transport and is not authenticated here);
confidentiality of the JavaScript bundle itself, which is served by Metro in the clear and already
contains the project path that the browser preview bundle contains today.

Primitives, all from the audited, maintained `@noble` family (`@noble/curves`, `@noble/hashes`,
`@noble/ciphers`), pure JavaScript, running unchanged under Bun and Hermes:

| Need                             | Primitive                                      |
| -------------------------------- | ---------------------------------------------- |
| Long-term Studio/device identity | Ed25519 signing keys                           |
| Per-connection key agreement     | X25519 ephemeral Diffie-Hellman                |
| Key derivation and short code    | HKDF-SHA-256 over the handshake transcript     |
| Frame confidentiality/integrity  | XChaCha20-Poly1305 with a per-frame nonce      |
| Replay and reordering rejection  | Strictly increasing sequence number in the AAD |

No new cryptographic construction is invented. The composition is the standard authenticated
ephemeral exchange with numeric comparison used by Bluetooth LE Secure Connections and ZRTP: both
sides derive a short authentication string from the transcript, a person compares it on both
screens, and Studio confirms. A man in the middle produces two different transcripts and therefore
two different codes. Signing the transcript with the long-term keys binds those identities to the
session; nonces and fresh ephemerals make every captured handshake frame useless on replay.

Storage: the device keeps its Ed25519 secret key and the pinned Studio public key in iOS Keychain
through `expo-secure-store`. Studio keeps its identity and the trusted-device list as JSON under the
Studio user state root (`.artifacts/user/studio/device-trust/`), never inside a project.

## Handshake

All handshake messages are clear JSON text frames limited to `helloLimitBytes`; after
`device.confirm` every frame is sealed. Base64 encodes every byte string.

```text
device.hello     protocol, sessionId?, metroPort?, device{name,model,os,appVersion?},
                 devicePublicKey, ephemeralPublicKey, nonce, pinnedStudioKey?
studio.hello     protocol, mode: pair|reconnect, studioPublicKey, ephemeralPublicKey, nonce,
                 signature = Ed25519(studioSecret, transcript || "studio")
device.confirm   signature = Ed25519(deviceSecret, transcript || "device")
studio.rejected  code, message            (clear; the socket closes right after)
```

`transcript = SHA-256(len‖protocol, len‖sessionId, len‖devicePublicKey, len‖deviceEphemeral,
len‖deviceNonce, len‖studioPublicKey, len‖studioEphemeral, len‖studioNonce)`.

`sessionId` in the transcript is exactly what the device sent in `device.hello`, or the empty string
when the hello carried only `metroPort`; both sides hash the same value.

Key schedule: `shared = X25519(ownEphemeralSecret, peerEphemeralPublic)`, then
`HKDF-SHA-256(ikm = shared, salt = transcript, info = "tao-studio-device-v1 <label>")` with labels
`device-to-studio`, `studio-to-device`, and `sas`. The short code is the first four bytes of the
`sas` output as a big-endian integer modulo 1,000,000, shown as six digits.

Studio decides `mode`:

- **reconnect** when `devicePublicKey` is already trusted for this Studio identity. No code is shown.
- **pair** when the device is unknown and the pairing window is open. The gateway sends
  `studio.pairingPending` (sealed), both screens show the code, and the connection stays in
  `pairing` until Studio's confirm or decline. Confirm stores the device and sends `studio.welcome`;
  decline sends `studio.rejected pairing-declined`.
- otherwise `studio.rejected pairing-closed` or `untrusted-device`.

The device verifies the Studio signature with the key in `studio.hello`, and refuses with
`studio-key-mismatch` when it already pins a different Studio key; re-pairing after Studio changes
identity requires the person to forget the pinned key on the device. A wrong or reused signature,
an unknown session, an unsupported protocol, an oversized or malformed frame, and a handshake that
takes longer than `handshakeTimeoutMs` all end in `studio.rejected` plus close.

## Sealed control plane

```text
{ type: "sealed", seq, nonce, box }     box = XChaCha20-Poly1305(dirKey, nonce, json, aad = protocol:seq)
```

`seq` starts at 1 in each direction and must equal the receiver's expected value; anything else
closes the connection (`replayed-frame`). Frames above `frameLimitBytes` close it (`oversized`).

Studio → device (sealed):

```text
studio.pairingPending  {}
studio.welcome         sessionId, appName, projectLabel, capabilities[], compile, manifest?, heartbeatMs
studio.manifest        manifest: { manifestRevision, compileRevision, scenarios[{cellId, cellRevision,
                       scenarioId, label, group, viewport{width,height}}] }
studio.compileState    compileRevision, appliedRevision, status, message
studio.cellAssigned    identity{appName,cellId,cellRevision,compileRevision,manifestRevision,previewInstanceId},
                       runtime (the same bootstrap record the browser cell fetches)
studio.cellUnavailable cellId, code: unknown-cell | manifest-unavailable, message
studio.appliedAck      compileRevision, accepted
studio.reconnect       {}                (the device drops and dials again)
studio.revoked         reason            (then close 4001)
studio.pong            {}
studio.error           code, message
```

Device → Studio (sealed):

```text
device.selectCell      cellId
device.applied         identity, compileRevision, appliedRevision
device.report          level: info | error, message
device.ping            {}
```

Rules:

- Studio assigns a fresh `previewInstanceId` per `studio.cellAssigned` through the existing matrix
  session (`registerCellPreview`), so the device is one more opaque preview instance. On a manifest
  change the gateway re-registers the device's selected cell (or the first cell when the old one is
  gone) and pushes a new assignment.
- The device renders an assignment only when its loaded bundle's `compileRevision` equals the
  assignment's; until then it shows the stale overlay. After mounting, it sends `device.applied`,
  which the gateway feeds to `session.acknowledgePreview` as an ordinary `preview-applied` message.
- `projectLabel` is the project folder name. No filesystem path, source content, credential, or
  unrelated session state crosses the gateway.
- Backgrounding pauses the client; foregrounding dials again with the stored key.

## Error vocabulary

`unsupported-protocol`, `unknown-session`, `pairing-closed`, `untrusted-device`, `bad-signature`,
`malformed`, `oversized`, `replayed-frame`, `timeout`, `pairing-declined`, `studio-key-mismatch`,
`revoked`, `replaced`, `gateway-stopped`, `unknown-message`, `unknown-cell`, `manifest-unavailable`.

## Loopback Studio API for the workbench

All session-scoped, loopback-only, alongside the existing `/api/preview/*` routes:

```text
GET  /api/device/status              gateway/pairing/trusted/connection snapshot
POST /api/device/pairing/open        {} -> { expiresAt }
POST /api/device/pairing/confirm     { devicePublicKey } -> { accepted }
POST /api/device/pairing/decline     { devicePublicKey } -> { declined }
POST /api/device/revoke              { devicePublicKey } -> { revoked }
POST /api/device/reconnect           {} -> { requested }
POST /api/device/select-cell         { cellId } -> { requested }
GET  /api/device/launch              host tooling: bundle id, scheme, device URL, candidates, devices, QR
POST /api/device/launch/open         { hostId } -> { launched, hostName, url } or a layered error
WS   /events                         gains `device-state` events carrying the status snapshot
```

`GET /api/device/launch` and `launch/open` are served only when `runStudioDev` injects the
physical-device launcher from `packages/dev`; a packaged Studio without it answers 501.

## Module ownership

| Concern                                           | Module                                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------------------- |
| Wire types, limits, codes, parsers                | `packages/runtime/TaoRuntime-src/TR-studio-device-protocol.ts`                    |
| Identity, transcript, keys, code, seal/open       | `packages/runtime/TaoRuntime-src/TR-studio-device-trust.ts`                       |
| Device client state machine and native host       | `TR-studio-device-client.ts`, `TR-studio-device-host.tsx`, `TR.Studio.DeviceHost` |
| Gateway, trust store, status snapshot             | `packages/studio/studio-src/device/*`                                             |
| Loopback routes and `device-state` events         | `packages/studio/studio-src/StudioServer.ts`                                      |
| Workbench button/popover                          | `packages/studio/studio-src/client/StudioDevicePanel.ts`                          |
| Physical-device discovery, install, open, URL, QR | `packages/dev/dev-src/studio/StudioCompanionDevice.ts`, `StudioDeviceLaunch.ts`   |
| Companion shell                                   | `packages/studio-companion-app/`                                                  |
| Process wiring and preview-runtime manifest       | `packages/dev/dev-src/studio/StudioDev.ts`, `StudioPreviewRuntime.ts`             |

## Proof record - 2026-09-03

Host: macOS 26.5.2, Xcode 26.6 (17F113), Expo SDK 54 (`@expo/cli` 54.0.27), Bun 1.3.13, Mac LAN
address 192.168.50.107. Phone: roPhone, iPhone17,2, iOS 26.6.1, paired over the local network with
Developer Mode enabled. Studio run: `./dev studio "Apps/WordFlower/1 - Current" --app WordFlower`,
loopback server 62563, Metro 62549, device gateway 62530.

Proven with automated tests and against that live Studio process:

- Native shell: `just studio-companion-install roPhone` ran Expo prebuild and CocoaPods for the fixed
  bundle id `dev.tao-lang.studio.companion` without starting any Metro; the same workspace built and
  signed for `generic/platform=iOS` (`TaoCompanion.app`, team 9Q489XG6QZ). No second Metro ever
  started; Studio's per-project Expo process remained the only bundler.
- Open on device: `GET /api/device/launch` on the live Studio answered with Expo's own link
  `taostudiocompanion://expo-development-client/?url=http%3A%2F%2F192.168.50.107%3A62549`, the LAN
  candidate list, the connected host `roPhone`, the install command, and a devicectl diagnostic.
- Control plane: a scripted device built from the real runtime client
  (`TR-studio-device-client.ts` over Bun's WebSocket, `.artifacts/companion-slice-1/virtual-device.ts`)
  dialed `ws://192.168.50.107:62530/device` and, in one run: was refused with `pairing-closed`; after
  `pairing/open` showed the same six-digit code Studio's snapshot carried (`228 795`, then `973 821` on
  a second run); was confirmed through `pairing/confirm`; pinned Studio's fingerprint `7c55 994b b9c4
  ee4b`; received `studio.welcome`, the manifest, and a `studio.cellAssigned` whose instance the session
  had registered; acknowledged the applied revision (the coordinator reports `accepted: false` when the
  browser already acknowledged that revision, and the snapshot still records the device's applied
  revision); switched among the three WordFlower scenarios `states:novel`, `devices:phone`, and
  `devices:tabletDark` from both Studio and the device; saw a Tao source edit compile to revision 2 and
  reassign the cell at revision 2 while its bundle stayed at 1 (the stale case), then revision 3 after
  the edit was reverted; reconnected from Studio without a code; was revoked live (`studio.revoked`),
  and its next hello was refused. The browser workbench stayed connected and compiling throughout, and
  its Device popover showed the pending code, the connection, and the trusted list.
- Unit and integration coverage: protocol parsers and trust primitives, gateway handshake and every
  rejection code (wrong protocol, malformed, oversized, unknown session, replayed confirm, replayed and
  reordered sealed frames, timeout, declined, revoked, replaced, gateway stopped), trust-store atomicity,
  server routes with and without a gateway or launcher, the device client state machine (candidate
  fallback, backoff, heartbeat, key pinning and mismatch, revocation), the workbench panel model and
  controller, devicectl and Expo link parsing, and the generated native root.

On the phone, later the same night: with roPhone unlocked, `just studio-companion-install roPhone`
built, signed, and installed Tao Companion, and **Open on device** launched it into the Studio bundle
over Wi-Fi. (The install had first failed while the phone was locked, with
`kAMDMobileImageMounterDeviceLocked` and CoreDevice error 12040 from the developer-disk-image mount in
both `expo run:ios --device` and `devicectl device install app`; unlocking the phone was the whole
fix.) The first launch stopped at the device host's own precondition screen, because
`react-native-get-random-values` is a side-effect polyfill that exports nothing and the native module
kernel read its empty module as unavailable; the loader now reports the `crypto` global the polyfill
installs, which is what availability actually means for it. After that fix the phone reached the
gateway and was correctly refused with `pairing-closed` while pairing was closed.

On the iOS Simulator, the same night: `just studio-companion-simulator simulator="iPhone 17 Pro"`
built and installed the shell, and Studio's **Open on device** opened it on `127.0.0.1` and paired
with a matching code. The app scenario then rendered blank content under a correct header and tab
bar on every screen a stack owned, while the one screen behind a slot navigator rendered. The cause
was `ScreenStack` being created with no style: `react-native-screens` lays its screens out inside
that view's own bounds, which measured zero, so every screen under it was empty and the browser
canvas — which never uses the native stack — showed nothing wrong. A filling style on the stack
surface fixes it; a tab whose entry is a window-owning navigator also no longer wraps that navigator
in the tab's scroll frame, which is what the app host already does for a root navigator. The
simulator is now the everyday target for this kind of question: it needs no pairing, no unlocked
screen, and no LAN address.

Two more bugs surfaced by that live use, found only by re-testing after each fix rather than by the
scripted device or any existing test:

- The device client kept its own copy of the compile revision from construction and refused to
  `applied()` a later one, so every Fast Refresh after the first edit crashed the device host with
  "the applied revision is the loaded bundle revision." A live client survives a bundle it was not
  constructed against — Fast Refresh replaces the bundle out from under it — so there is no correct
  client-held copy to check; the host already makes the real comparison against its live bundle
  revision to decide the stale-bundle overlay. The client no longer holds or checks one. Verified on
  the simulator with a real edit-reload cycle: revision 4 applied, the new text rendered, no crash.
- A `view`-kind scenario mounts one Tao view directly inside `AppShell` with no navigator to turn
  `AppShell`'s `SafeAreaProvider` context into padding (only a navigator's `AppSurfaceFrame` does
  that), so it painted under the status bar and home indicator on a device. `DeviceCellFrame` now
  applies the device's safe-area insets itself for a `view`-kind cell only, leaving an `app`-kind cell
  untouched so a window-owning navigator (a native tab bar or stack) keeps the true screen edges it
  depends on. Verified on the simulator: the `WorkspaceRow` `"novel"` scenario now clears the status
  bar instead of starting under it.

One known limitation closed the same way, from reading rather than a new live repro: backgrounding
did not trigger a foreground redial, only the Reconnect button did, so a drop the OS caused while
backgrounded could sit for up to the 15s backoff cap after returning. `ConnectedDeviceHost` now
listens for the RN `AppState` transition into `active` and calls `client.reconnect()` immediately,
gated on the client already being `disconnected` — never mid-attempt or already connected, so a
healthy session is never torn down just because the app came forward. Covered by
`shouldRedialOnForeground` unit tests; not yet proven against a real background/foreground cycle,
on the phone or the simulator (the simulator does not suspend an app the way iOS does on a physical
phone, so backgrounding it would not exercise the drop this fixes).

Cable link-local carries Metro by design, not yet by proof: `preferredLanIPv4` already prefers a
`169.254.x.x` interface over the normal LAN address when one is present, which is what macOS assigns
a trusted, USB-connected iPhone, and the gateway URL a device dials is recomputed from the current
interfaces on every "Open on device" press, so nothing needs restarting for a newly plugged cable to
be picked up. No run has actually plugged a cable in with Wi-Fi off to confirm it. **Verify this on
roPhone before calling Slice 1 fully proven**: connect over USB, turn Wi-Fi off, press Open, and
confirm the phone reaches the gateway over the `169.254.x.x` address rather than failing to connect.

Still to record from the phone: code comparison on its screen, the rendered cell, and three scenario
taps on the Tao badge.

Known limitations recorded here rather than hidden: scenario and cell identifiers embed the project's
absolute source path (as the browser preview bundle already does), so the manifest a device receives
is not path-free yet; and a cell's browser instance and device instance coexist, so the matrix now
keeps several live instances per cell.
