# DEVENV-INSTALLED-EDITOR-PROBE-STALLS-BEFORE-STARTUP — Installed editor probe stalls before startup

- **Status:** Resolved
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
  does not queue this launch. The original run did not establish the host startup cause.
  On `feat/installed-editor-startup`, fresh `main` `85442713446e` reproduced the silent bootstrap
  stall in profile `.artifacts/tests/ide-installed/1791130831283-79652`: installation/listing finished,
  while the launch retained only the shell CLI and its Node-mode `cli.js` child, with no application
  or extension-host logs. The vendor test runner launches the native executable for extension tests;
  the previous workflow used the CLI plus `--wait`.
  The first native launch then failed immediately with `listen EINVAL`: the profile-derived
  `1.13-main.sock` pathname exceeded VS Code's 103-character IPC limit. This confirms that the
  profile location must be shortened; the new failure report preserved the executable, profile,
  phase, and stderr instead of silently waiting for the overall deadline.
  Short-profile runs now reach the test host. Trace run
  `.artifacts/tests/ide-installed/1791133110643-77835` proves that the renderer scans the isolated
  extension index and finds Tao, but the probe's extension registry omits it. Its telemetry records
  `workspaceTrustStateChanged` with `isTrusted: 0`; Tao, Git, TypeScript language features, and terminal
  suggestions are all filtered because they do not support an untrusted workspace. The probe itself
  is a development extension and therefore remains visible. The vendor runner's
  `--disable-workspace-trust` flag is required for this disposable, workflow-owned test workspace.
  Run `.artifacts/tests/ide-installed/1791133760374-70423` then registered and activated the installed
  Tao extension with the actual Tao language association, but timed out waiting for hover. The
  server was healthy; `Repo.filesUnder` honors Git ignores outside explicitly requested scratch
  projects, so it omitted the ignored fixture's cross-file definition. The installed fixture must
  use `.artifacts/scratch`, like the packaged language-server test.
  Scratch run `.artifacts/tests/ide-installed/1791134179313-55681/hover-state.json` recorded the exact
  expected hover text and no Tao errors, while the probe's JSON comparison still rejected it.
  The assertion now reads returned hover strings or their `value` fields directly.
  Final run `.artifacts/tests/ide-installed/1791134359776-86045/receipt.json` passed on VS Code
  `1.139.1` with installed `devtao.tao@0.0.1`, proving activation, hover, cross-file definitions,
  source-origin navigation, current Tao errors, generated contracts, incorrect sidecar signatures,
  and recovery after disk edits. `external-profile.json` confirms archived logs and profile removal.
- **Workaround:** None needed after the launch and fixture repairs. Source checks and packaged
  language-server checks remain separate from installed-editor acceptance.
- **Proposed change:** Launch extension tests through the native editor executable with a short,
  owned temporary user profile; preserve its logs in the worktree and clean up the temporary profile.
  Report phase progress, include the executable/profile and bounded output in failures, and enforce
  a separate startup deadline before the overall probe timeout. Disable updates and workspace trust
  only in the isolated test instance, record its editor version, and preserve installed-origin checks.
- **Dependencies:** A host that can launch the installed editor and execute its extension test host.
- **Acceptance:** The named workflow produces a receipt from a fresh isolated profile proving
  activation, hover, definition, diagnostics, generated contracts, recovery, and source navigation;
  failed startup identifies the phase and its evidence directory without claiming acceptance.
- **Source:** Project/module/generated-TypeScript migration acceptance; launch helper in
  `packages/cli/dev-cli/dev-cli-src/release/InstalledEditorAcceptance.ts`.

Archived 2026-10-04 after real installed-editor acceptance passed.
