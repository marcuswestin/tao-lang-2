# DEVENV-FIREBASE-BUILD-SNAPSHOT-OMITS-CONNECTION-SETTINGS — Firebase build snapshot omits connection settings

- **Status:** Resolved
- **Area:** Immutable build snapshots and public Firebase configuration.
- **Impact:** A configured Firebase app loses its project-local public settings during a build because source snapshots exclude the .tao directory.
- **Evidence:** The new synthetic compile-only build regression failed before the repair and passed afterward on feat/hosted-provider-acceptance-evidence, after integration of main 20bbeff06. Snapshot creation restored project identity and lock files but omitted .tao/local/connections.json.
- **Workaround:** None required after the repair.
- **Proposed change:** Validate Firebase settings with the contained public-settings reader, snapshot only normalized Firebase fields, include them in the source digest, and reject changed settings during snapshot creation. Keep other local files and unrelated connection entries excluded.
- **Dependencies:** Existing project-local Firebase settings and runtime configuration injection.
- **Acceptance:** firebase-build-snapshot.test.ts performs four real compile-only web builds and passes. It verifies missing settings remain optional, all six public fields reach generated auth/data code, changes affect output and digest, key order does not, and unrelated local data is excluded. The existing build-project-dependencies.test.ts suite also passes both tests. Snapshot race rejection has no dedicated interleaving test; hosted and installed packaging acceptance remain separate.
- **Source:** packages/cli/tao-cli/cli-tests/firebase-build-snapshot.test.ts and packages/cli/tao-cli/cli-src/build-command.ts.
- **Archived:** 2026-10-04
