# DEVENV-INSTALLED-EDITOR-PROBE-STALLS-BEFORE-STARTUP — Installed editor probe stalls before startup

- **Status:** Candidate
- **Section:** External
- **Area:** Installed editor acceptance
- **Impact:** The installed-extension workflow can spend nine minutes launching the editor without
  producing a test-host log or success receipt. Packaging and installation cannot establish the
  diagnostics, navigation, and disk-watch behavior this workflow is intended to prove.
- **Evidence:** On 2026-10-04, `./agent unsandboxed ide-extension-acceptance` ran with approved host
  access from migration commit `4bb9922c4`. Packaging, isolated installation of `devtao.tao@0.0.1`,
  version inspection, and probe compilation succeeded. Profile
  `.artifacts/tests/ide-installed/1791097238615-50132` recorded installation in
  `user/logs/20261004T030038/cli.log:7` and extension listing in the next CLI log, but no editor or
  extension-host log, `probe-passed.json`, or `receipt.json` appeared before the command failed:
  `/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code --user-data-dir failed: timed out after 540s`.
  The shared CLI spawns immediately and starts its timeout after spawning; the test process policy
  does not queue this launch. The exact host startup failure remains unknown.
- **Workaround:** None verified. Keep source checks and packaged language-server checks separate
  from installed-editor acceptance; do not treat an installed version listing as a passing probe.
- **Proposed change:** Diagnose the editor CLI/bootstrap stall, include the isolated profile path
  and bounded launch diagnostics in failures, and make the installed probe produce a clear startup
  verdict before its overall timeout.
- **Dependencies:** A host that can launch the installed editor and execute its extension test host.
- **Acceptance:** The named workflow produces a receipt from a fresh isolated profile proving
  activation, hover, definition, diagnostics, generated contracts, recovery, and source navigation;
  failed startup identifies the phase and its evidence directory without claiming acceptance.
- **Source:** Project/module/generated-TypeScript migration acceptance; launch helper in
  `packages/cli/dev-cli/dev-cli-src/release/InstalledEditorAcceptance.ts`.
