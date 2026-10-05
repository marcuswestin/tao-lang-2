# DEVENV-NATIVE-KIT-OMITS-PROVIDER-TRANSITIVES — Native kit omits provider transitives

- **Status:** In progress
- **Section:** External
- **Area:** Expo host and Companion native dependency compatibility.
- **Impact:** A native host can be considered compatible while a selected provider needs a native module absent from that host.
- **Evidence:** `packages/apps/expo-host/expo-host-src/dev-loop/prebuilt-host/HostManifest.ts` computes `nativeKitOf` from direct manifest dependencies only. The Firebase provider declares `expo-sqlite ~57.0.3`, while Expo host and Companion manifests omit it. The parity test compares the two incomplete kits without asserting SQLite. The Developer's Simulator separately failed to import SQLite; the adapter replaces every import error with an installation suggestion, so this omission is not yet proven to cause that live failure. SDK57 Expo Go includes SQLite.
- **Source repair:** Installed dependencies, root devDependencies and nonoptional peers are now traversed with realpath cycle handling. Expo version/depth selection occurs before native filtering; native source hashes are retained. The real graph selects AsyncStorage2.2 over deeper1.24, and detects a Companion kit missing expo-sqlite57.0.3. Focused prebuilt-host tests passed26/26, including a direct JavaScript version shadowing a deeper native version. The initial graph repair did not change manifests; the subsequently approved host repair is recorded below. Native preflight retains original import/storage errors in development logs.
- **Workaround:** None proven for the reported run; identify its launched binary and retain the original module-import exception before choosing a host repair.
- **Proposed change:** Include native provider transitives in compatibility/build requirements, or enforce an exhaustive central native dependency contract; preserve the underlying import diagnostic. Rebuild affected custom hosts only after requirements and dependency changes are approved.
- **Dependencies:** Any manifest/version/lockfile change requires Developer approval.
- **Acceptance:** A fixture with a transitive native provider dependency cannot match a host lacking that dependency. A matching built host opens the real Firebase native replica and survives restart on Simulator; record host identity and original import diagnostics separately.
- **Source:** 2026-10-04 ordinary Firebase validation screenshot and read-only source investigation on feat/firebase-validation-account-buttons.

- **Remaining proof:** A reserved Simulator launched Expo Go57.0.9 but produced no bundle/database result. Native open/reopen and the reported original failure are unproved. Keep this entry open; the subsequently approved Companion rebuild is recorded below.

- **Approved host repair2026-10-05:** The Developer authorized dependencies and completion decisions. Companion now declares `expo-sqlite ~57.0.3`; `./agent setup --refresh-lockfile` passed. The host already receives SQLite through tao-firebase. The real graph regression now requires full Companion coverage; native open/reopen remains pending; the completed build is recorded below.

- **Build evidence:** Simulator host1.0.0-585e6bbd1f9e built successfully with ExpoSQLite57.0.3. Real graph26/26 confirms Companion coverage. Reserved Simulator receipt668148bd identifies that installed host; no bundle/database result arrived. Managed stop proved cleanup. Keep acceptance open for actual native open/reopen.
