# DEVENV-QA-CAPTURE-BLOCKS-RUNTIME-SDK-IMPORTS — QA capture blocks runtime SDK imports

- **Status:** Candidate
- **Section:** External
- **Area:** Isolated QA source snapshots
- **Impact:** A valid app with a TypeScript adapter importing a runtime SDK cannot reach browser
  capture. Automatic QA discovery still lists its scenarios, but their coverage remains missing.
- **Evidence:** On 2026-10-06, the automatic scenario batch on `feat/scenario-qa-discovery` found
  five WordFlower variants. Every variant was blocked before Studio opened because
  `QaCapture.checkReferences` rejects the `react-native` import in `@ui/Export.ts`. The batch
  retained all 13 expected cells as missing and linked each failed launch log. See
  `.artifacts/qa/scenario-discovery-activated/coverage.json` and `app-10.log` through `app-14.log`.
  The diagnostic is `QA capture cannot isolate @ui/Export.ts reference react-native. Move the
  referenced source inside the project before capturing.`
- **Workaround:** None. Keep these captures blocked; another app's screenshots cannot supply them.
- **Proposed change:** Resolve runtime SDK imports against the preview runtime's declared, pinned
  dependencies while keeping local imports inside the staged project. Do not copy original
  `node_modules`, admit arbitrary host paths, or weaken computed-import checks.
- **Dependencies:** The existing isolated snapshot contract in `QaCapture` and preview runtime
  dependency ownership.
- **Acceptance:** A focused regression admits a declared runtime SDK and still blocks unknown
  packages and escaping local imports. A bounded WordFlower capture reaches its scenario cells,
  with actual missing or failed previews reported separately from source-isolation failures.
- **Source:** The retained automatic browser batch and inspection of `QaCapture.checkReferences`.
