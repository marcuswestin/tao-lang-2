# tao-icloud-native

The Expo module package behind Tao's Apple datasources. Two Swift modules share one pod
(`ios/TaoICloudNative.podspec`), one JavaScript package, and one entitlement plugin:

- **`TaoICloud`** (`ios/TaoICloudModule.swift`) backs `@tao/data/providers/icloud`. It exposes the
  app's iCloud Drive container as named documents: coordinated whole-document reads and writes,
  newest-wins resolution of iCloud conflict versions, a bounded metadata lookup before a read
  concludes a document is absent, and change events from a metadata query so another device on
  the same iCloud account shows up as a replacement snapshot. Documents are kept under
  `<container>/Tao Data/`, outside `Documents/`, so the Files app never lists them.
- **`TaoCloudKit`** (`ios/TaoCloudKitModule.swift`) backs `@tao/data/providers/cloudkit`. It runs
  one `CKSyncEngine` per datasource over a record zone of the private database (iOS 17 or later),
  takes whole records to save and names to delete, and reports fetched changes, saved records,
  server conflicts with the server's copy, and failures as events. Records are opaque to it; the
  merge policy lives in the Tao provider beside the runtime's fold.

## Layout

- `icloud-native-src/icloud-native.ts` — `ICloudDocuments`, the document boundary a provider
  drives, `iCloudDocumentsOver` for a supplied native module, and `loadICloudDocuments`, which
  binds the Swift module lazily and fails with a host-environment error where it is absent.
- `icloud-native-src/cloudkit-native.ts` (`tao-icloud-native/cloudkit`) — `CloudKitZone`, the
  zone boundary, `cloudKitZonesOver`, and `loadCloudKitZones`, on the same terms.
- `plugins/with-tao-icloud.cjs` (`app.plugin.js`) — the config plugin granting the iCloud
  entitlements: `containers` default to `iCloud.<bundle identifier>`, `services` to
  `CloudDocuments`; pass `CloudKit` for the CloudKit datasource.

## Building

The module is native code, so Expo Go cannot load it. A build that mounts an iCloud datasource
is a development build or a release build: `expo prebuild` links the module through autolinking
(the package is a dependency of `tao-runtime-toolchain`), and the config plugin must be applied
for the entitlements — the ship pipeline does so from the manifest's `icloud` section. On the
iOS Simulator, sign the simulator into an iCloud account and use _Features › Trigger iCloud Sync_
to push changes between simulators.
