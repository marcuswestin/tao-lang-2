# DEVENV-STUDIO-PREVIEW-OMITS-LOCAL-EXPO-PLUGINS — Studio preview omits local Expo plugins

- **Status:** Resolved
- **Area:** Studio isolated Expo runtime packaging.
- **Impact:** Studio and browser host gates cannot start Metro when the copied Expo config refers to a local plugin absent from the preview directory.
- **Evidence:** The 2026-10-04 authorized landing on feat/hosted-provider-acceptance-evidence failed Studio launch, real-app, keyboard, and network gates with Failed to resolve plugin for module ./plugins/with-jazz-podfile-properties.cjs. StudioPreviewRuntime copied its config and top-level runtime files but omitted the plugins directory; the regular DevRuntime already copied it.
- **Workaround:** None required after the repair.
- **Proposed change:** Copy the toolchain plugins directory into each isolated Studio preview. Extend the existing creation regression to assert the configured Jazz plugin and both local plugin files are present.
- **Dependencies:** Existing Expo host local plugin configuration.
- **Acceptance:** The focused studio-dev.test.ts suite passes all 68 tests after the directory copy. An isolated headless studio-launch.test.ts run also passes, establishing that the preview starts and reports readiness. Full host landing verification remains a separate gate.
- **Source:** .artifacts/logs/verify-full/2026-10-04T18-11-34-094Z-49476-319985c7/summary.json and .artifacts/logs/dev-test/2026-10-04T18-16-19-732Z-77391-796301d3/summary.json.
- **Archived:** 2026-10-04
