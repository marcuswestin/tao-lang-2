# iCloud datasource provider

Status: implemented boundary, not yet proven on devices. The package, native module, ship
entitlements, and provider protocol are in place and covered by focused tests; two-device live
acceptance on real iCloud accounts remains before this can be treated as a production sync path.

## Why a platform-sync provider

`Local` keeps a store on one device; `InstantDB` syncs it through a hosted backend that needs an
app id, a server, and eventually accounts. Between the two sits what the platform already gives a
signed-in person for free: the same store on every device of one iCloud account, with no server,
no sign-in flow, and no account model of Tao's own. `ICloud` is that provider, for apps whose data
is "mine, on my devices" rather than "ours, in a household".

It is deliberately a member of the existing full-snapshot family. The snapshot protocol already
has a remote member with last-snapshot-wins semantics (InstantDB), so iCloud Drive's document
model — a file per storage key, conflict versions when two devices wrote concurrently — maps onto
it without touching the runtime. CloudKit, the other Apple sync surface, is the granular-family
target instead (see `Docs/Roadmap/Multiplayer sync.md`): record-level changes, change tokens,
push-driven fetches, and record-zone sharing are the shape that family wants, and too heavy for
whole snapshots.

## Implemented boundary

- `@tao/data/providers/icloud` declares `type ICloud is datasource with { StorageKey text?,
  Container text? }` and binds `ICloudProvider` from its sidecar, exactly as InstantDB does.
  `Container` names the iCloud container identifier; omitted, the app's first entitled container
  is used.
- The connection keeps one document per storage key at `<container>/Tao Data/<key>.json`,
  outside the container's `Documents/` folder so the Files app never lists it while iCloud still
  syncs it. `load` reads it, `save` replaces it under file coordination, and `subscribe` follows
  it through a metadata query so another device's write arrives as a replacement snapshot. There
  is no `reset`: the document is shared with the account's other devices, so a device that failed
  to parse it must not wipe it, matching InstantDB.
- Echoes and transients are filtered in the provider. The metadata query reports this connection's
  own write like any other change, so the last written snapshot is dropped when it comes back; a
  document can read as missing for a moment while iCloud rearranges its bookkeeping, so a missing
  document never reaches the store (nothing in this design deletes it); and while a write is in
  flight the watch only notes that something changed, and the connection re-reads the document
  once its writes settle, so the watch can never publish an earlier snapshot over a later one.
- A read that finds no local item asks iCloud's metadata whether the document exists anywhere
  (bounded at eight seconds) before answering "no document", so a freshly signed-in device does not
  mount empty and then win the newest-wins conflict against the account's real data.
- Conflicts collapse to the newest version by modification date (last snapshot wins). A write
  supersedes any conflict versions outstanding at the time, since the runtime committed it over
  the newest contents it had seen.
- Configuration readers shared by InstantDB and ICloud live in
  `@tao/data/providers/provider-configuration.ts`, copied with each sidecar's relative import graph.

## The native module

`packages/icloud-native` (`tao-icloud-native`) is the repository's first native code: an Expo
module in Swift, autolinked into the runtime host through the existing
`autolinkingModuleResolution` setting because the package is a dependency of
`tao-runtime-toolchain`.

- `ios/TaoICloudModule.swift` exposes `readDocument`, `writeDocument`, `startWatching`, and
  `stopWatching`, plus a `documentChanged` event. Reads and writes go through `NSFileCoordinator`
  (a coordinated read of an undownloaded item waits for its download); watches are
  `NSMetadataQuery` objects over the ubiquitous data and documents scopes, started on the main
  thread, reading off it. JavaScript chooses the watch identifier so no event can precede its
  owner learning it.
- `icloud-native-src/icloud-native.ts` publishes `ICloudDocuments`, the boundary the provider
  drives, and `loadICloudDocuments`, which binds the Swift module lazily and fails with a
  host-environment error where the module is absent — Android, the web, or an Expo Go session.
- `plugins/with-tao-icloud.cjs` (`app.plugin.js`) grants the iCloud Documents entitlements. The
  ship pipeline applies it from the manifest: `tao ship` detects an app bound to `ICloud`
  (directly, through a named datasource, or inherited from its direct base app), records the
  explicit `Container` if any, and `app.config.js` adds the plugin with
  `iCloud.<bundle identifier>` as the default container.

Consequences for the development loop: Expo Go cannot load the module, so an app mounting an
iCloud datasource needs a development or release build; the companion app plan already introduces
that loop. On the iOS Simulator, sign the simulator into an iCloud account and use _Features ›
Trigger iCloud Sync_ to push changes between simulators.

## Known limits

- Apple platforms only. A mount elsewhere fails loudly with a host-environment error; an app that
  also targets Android or the web binds another datasource in a variant for those targets. Whether
  the validator should refuse such a target at compile time is a decision for the Developer.
- Single account, many devices. iCloud Drive offers no server-side rule evaluation, no accounts of
  its own, and no sharing of a data-scope document, so the §3 access rules have nowhere to run and
  the household demos are out of scope. Sharing arrives with CloudKit in the granular family.
- Whole-snapshot last-writer-wins, as InstantDB today. Concurrent edits on two devices overwrite
  each other's unrelated changes; the snapshot family's sequential row ids (open question 5 in the
  multiplayer exploration) also collide across devices that create rows offline at once.
- The container belongs to the signing team. If Tao's ship pipeline signs under Tao's own account,
  the container is Tao's while the data lives in the person's iCloud quota; a developer shipping
  under their own team gets their own container. Neither is wrong, but the ship documentation
  should say which one applies.
- Delivery latency is iCloud's. A metadata query reports a remote write when the daemon has
  downloaded it, which in practice is seconds on a live device and manual on the simulator.

## Validation

Focused coverage: `packages/icloud-native/icloud-native-tests` proves the document boundary over
a fake native module (absent documents, container pass-through, watch routing by identifier,
stop-once, start failures) and the config plugin's container derivation and entitlement merging.
`packages/stdlib/stdlib-tests/data-providers.test.ts` runs `ICloud` through
`TR.testProvider` with a fake document store and a rejecting variant, and proves document naming
per storage key and container, the absence of `reset`, echo and transient filtering, unsubscribe
guarding, and configuration validation before the native module loads. Compiler coverage compiles
the `ICloud` import with its copied sidecar and shared configuration reader; CLI coverage proves
the ship binding derivation; toolchain coverage proves the manifest's `icloud` section becomes the
plugin entry.

The Swift module compiles: `expo prebuild` of the runtime host, `pod install`, and an `xcodebuild`
of the `TaoICloudNative` pod target for the iOS Simulator succeeded against ExpoModulesCore 3.0.
The three commands, and which of them the Bash sandbox refuses, are recorded as DEVENV-055 in
`Docs/Roadmap/Developer environment upgrades.md`. No simulator or device has run the provider yet.

## Live acceptance still required

1. Build a development client with the module linked and an iCloud-entitled bundle identifier,
   install it on two devices (or two simulators) signed into one iCloud account, and confirm
   create, update, delete, relaunch hydration, and cross-device propagation.
2. Force a conflict — write on both devices while one is offline, then reconnect — and confirm
   the newest snapshot wins on both without either device blocking behind an error.
3. Decide whether platform-scoped datasources need a validator rule for non-Apple targets.
