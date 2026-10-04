# Decisions — Tao development, build, ship, and clean

Status: **decided product behavior; bare `tao run`, web/desktop build, and clean landed on `main`; later ship and native slices remain planned**. These decisions were made in the
September 2026 CLI workflow dialogue. They supersede conflicting _forward-looking_ command designs
in `Docs/MVP Roadmap/Plan - Standalone Tao CLI.md` and
`Docs/Roadmap/Tao ship/Plan - Beta distribution in one command.md`; much of the remaining contract
does not describe the current CLI. Implementation updates those documents and command help as behavior changes.

This is the durable record of the choices and implementation status. The planned CLI restructure has
landed on `main`; implementation should start from that post-restructure state, not from the
unrelated `feat/real-host-acceptance` history. The design discussion changed the personal dialogue
skill separately; no skill change is part of this CLI work.

The first implementation slice starts bare `tao run` without opening a target, places its generated
Expo host under the project, records session history at `.tao/local/sessions/`, and shares exclusive
project ownership with Studio. Slice two adds local web and desktop builds, live desktop opening,
and build cleanup. Ship, invite, native packaging, and installer behavior remain later slices;
command help describes what is implemented now.

## Product boundary and architecture

- `tao run`, `tao build`, `tao ship`, `tao invite`, and `tao clean` are the public workflow verbs.
  Do not add a public `tao package` or an app-OTA `tao update` command. `tao build --compile-only`
  replaces the old public `tao compile` once its callers have migrated.
- The CLI should expose the development and build capabilities that overlap with Studio. A shared
  development-session/build API sits beneath both surfaces; Studio must not shell out to the CLI as
  its core architecture. Keep Studio-only editor and preview behavior in Studio.
- Each project owns its generated state. Retain versioned, machine-readable dev-session records at
  `.tao/local/sessions/<id>.json`, including completed status, without secrets. Keep local build artifacts
  and their records under ignored `.tao/local/builds/`. The exact JSON schema and internal package split
  are implementation details, not product decisions.
- One project may have only one live development-session owner. A second CLI dev session refuses.
  Studio also refuses to open a project owned by a CLI session or another Studio window, identifying
  the existing owner. Shared multi-attachment behavior was considered but rejected for this work:
  the existing Studio compile/preview lifecycle would need extra synchronization and ownership.
- Include the standalone runtime/resource foundation necessary for these commands to work outside
  the repository. Installer channels, publishing the CLI, and per-project toolchain version pinning
  remain in the separate standalone-CLI program. Its toolchain-update command is named
  `tao check-for-updates` and asks whether to install when it finds an update; that command is not
  part of this implementation.

## `tao run`

- Bare `tao run` starts the live development session and Metro, but opens no simulator, browser,
  desktop window, or device. Startup flags `--ios`, `--android`, `--web`, and `--desktop` open only
  requested targets and may be combined. `--device <name-or-id>` opens a physical device directly;
  it accepts an iPhone/iPad name or ID, or an Android serial, and may accompany the other flags.
- TUI keys: `d` opens the desktop Tao app; `p` opens a connected physical device; `x` restarts the
  dev process; `i` opens an iOS simulator; `a` opens Android; `w` opens web; and `r` reloads the app.
  The previous meanings of `d` and `p` move to `p` and `x` respectively. Other useful dev controls
  need not be removed merely because these keys changed.
- `p` uses the sole connected device when there is one and asks which to use when there are several.
  Physical iOS opens the installed Tao Companion through its development-client link to the local
  Metro server, without Studio or scenario replay. Missing Companion or native launch failures
  produce actionable diagnostics and leave Metro running for a retry. Android keeps its existing
  prepared-runtime path. An explicit device selector never falls back to a different device, and
  duplicate device names require an ID. Phone and Mac must share a reachable network.
- Desktop is a first-class Tao target through Electrobun, not another name for a browser tab or for
  Tao Studio. The browser and desktop display the same Tao app; their bundles need not be byte-for-
  byte identical. Desktop-native capabilities are available only in the Electrobun host, and their
  absence in a browser must be handled explicitly. `tao run --desktop` and `d` use the live Metro
  session and Fast Refresh; they do not run a saved static build.

## `tao build`

- With no target flags, an interactive terminal presents a target picker; a noninteractive call
  without targets fails clearly. `--web`, `--desktop`, `--ios`, and `--android` may be combined.
  Multi-target work runs with a TUI showing the separate processes. Successful artifacts survive
  another target's failure; the final view gives detailed errors for every failed target and the
  command exits unsuccessfully if any failed.
- Every invocation creates a fresh build record and artifacts. It does not silently reuse a prior
  local build. A build may run alongside `tao run`: all selected targets compile the same copied
  source snapshot made before target work starts, and later source edits cannot change that build.
  Keep the human-facing progress view; machine-readable `--json` output is not in this slice.
- A build is local and produces an inspectable artifact; it does not ship or upload. `--compile-only`
  stops after generated source has been retained, before expensive packaging/native steps. There
  is no separate public bundle-only mode. The old `compile` surface retires after migration.
- Web build: use Expo's web path to export a static, self-contained site folder rather than a live
  Metro preview. Include a minimal script in the artifact that serves those files locally. The
  `site/` folder itself is what a developer could later upload to a static web host, with files at
  the site root; the adjacent `run` and `serve.ts` need Bun but not a Tao installation. It has no
  real-time updates.
- Desktop build: produce a runnable local macOS `.app` with Electrobun, rather than merely a web
  bundle. The `.app` contains its static site and runtime; it needs no adjacent support folder or
  Apple signing credentials for local use. It runs the same Tao app with desktop-only capabilities
  where available. Building without the `.app` was considered and rejected as the public desktop
  artifact.
- iOS build: produce a locally runnable `.app`, not an App Store distribution archive. A normal
  `tao build --ios` always builds for the simulator. When a compatible physical device is connected
  and the machine has the prerequisites to build for it, also build the device artifact; do not
  choose one instead of the other. `--device` explicitly requires the physical build, produces
  only that artifact, and must not silently fall back to a simulator build. There is no separate
  force-simulator flag. Native local builds default to Release configuration, with Debug available
  explicitly through `--configuration debug`. `tao build --ios --configuration release` remains a
  valid explicit spelling for a locally runnable Release app, not an uploadable distribution build.
  Native artifacts do not require an install-and-run script.
- Android build: produce a locally installable APK, not a Play Store upload artifact. Native build
  targets may be added after web/desktop in implementation sequence; while unavailable, show them
  in the picker with a “not yet implemented” alert and make explicit flags fail clearly.
- Retain multiple build artifacts rather than overwriting the last one. Source identity and
  build-target/configuration identity must be sufficient to determine safe reuse during shipping.

## `tao ship`

- Like build, ship accepts target flags or an interactive picker; multiple flags are allowed. Show
  target progress and retain successful outcomes on partial failure. Missing targets in a
  noninteractive invocation fail clearly.
- `tao ship --ios` means a new TestFlight beta by default. Bare `--beta` remains a supported,
  redundant beta-mode alias. Move recipient arguments from the old `--beta=emails` form to
  `--to EMAIL`; reject the old recipient form with a migration message. A new beta uses the
  configured internal testers by default; additional recipients are explicit. Inviting someone
  to an _existing_ beta is a separate operation, not a new ship.
- `--prod` is required for an iOS production submission; a bare ship never means production.
  Production asks for confirmation with **No** as the default (unless an explicit noninteractive
  confirmation option is used). A developer may ship production directly without a prior beta.
  Every new production shipment creates a new production binary, even when using the same saved
  source snapshot as a beta. Existing versioning, provenance, preflight, resume, and Apple account
  behavior should be preserved where compatible with these decisions.
- Ship an eligible, matching distribution candidate if one already exists; create it if none does.
  A local simulator or physical-device `.app` is not uploadable to TestFlight/App Store Connect.
  Suitable generated source or compilation intermediates may be reused, but signing and the
  distribution archive are ship-time work. An interrupted compatible distribution attempt should
  resume without needless rebuild or duplicate upload.
- `tao ship --ios --update` publishes a beta-only OTA update; `--rollback` on that command
  republishes a compatible previous beta update. There is no separate app-update verb. OTA is for
  compatible fixes to existing app behavior. Runtime/native/data compatibility are hard gates;
  obvious semantic changes should be detected, and the developer must explicitly declare that
  the change is suitable for beta OTA. No automatic check can prove “fix rather than feature.”
  Significant beta changes require a new TestFlight build and review.
- Production OTA is forbidden by Tao product policy. Reject `--prod --update`. Future production
  binaries must omit OTA machinery, not merely hide an update button. Beta and production update
  identities/channels must not overlap. Existing installed production binaries cannot be changed
  retroactively; stop publishing to any legacy channel they share with beta. This is deliberately
  stricter than a blanket claim about Apple's rules: Apple's [license agreement](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/)
  permits interpreted-code downloads under conditions, while the [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
  restrict feature-changing downloads and require review for significant TestFlight changes.
- `tao ship --web` fails until a web-hosting integration exists. Android and desktop shipping are
  deferred. Show unavailable ship targets in the picker with a clear alert rather than pretending
  the commands succeed.
- Shipping history and accepted deployment configuration belong in the existing project lock
  (`.tao/store/lock.jsonc`) or a clearly separate durable shipping store, not in disposable local
  build records. Do not make `tao clean` remove that history.

## `tao invite`

- `tao invite EMAIL` invites a recipient to an existing beta without creating or shipping a new
  build. Platform flags, such as `--ios`, select the invitation destination explicitly and may be
  combined when multiple destinations exist. With no platform flag, an interactive picker lets the
  developer select one or more platforms; a noninteractive invocation without a platform fails
  clearly. Initially, iOS/TestFlight is the only implemented destination. Other platforms must be
  marked unavailable until their invitation flow exists.

## `tao clean`

- Bare `tao clean` interactively lists and selects retained local build artifacts. Include old and
  dirty-source builds in that selection without a special warning. Before deleting, show the exact
  selected paths and sizes and ask for permanent deletion; **Yes** is the default answer.
- Delete each selected build folder and its local record. Keep no “cleaned build” tombstone. Do not
  delete shipping history, `.tao/store/lock.jsonc`, source, credentials, deployed records, or
  session records. Current source can usually be built again, but historical or dirty-source
  artifacts may not be byte-for-byte reproducible; the choice to show no special warning was
  deliberate. `tao clean` is interactive-only in this slice; it does not accept a noninteractive
  bulk-delete option.

## Use cases and intended CLI shape

These examples are the compact regression checklist for the command design. Only the dev,
web/desktop build, compile-only, and clean examples are implemented so far.

| Use case                                            | Invocation or operation                             |
| --------------------------------------------------- | --------------------------------------------------- |
| Start a live session without opening a target       | `tao run`                                           |
| Open selected live targets at startup               | `tao run --web --desktop`                           |
| Build local static web files and serve them         | `tao build --web`, then the artifact's `run` script |
| Build a local desktop app                           | `tao build --desktop`                               |
| Build local iOS simulator and available device apps | `tao build --ios`                                   |
| Build a physical iOS app explicitly                 | `tao build --ios --device`                          |
| Build a locally runnable iOS Debug app              | `tao build --ios --configuration debug`             |
| Build a local Android APK                           | `tao build --android`                               |
| Inspect generated source before native packaging    | `tao build --ios --compile-only`                    |
| Build several targets together                      | `tao build --web --desktop --android`               |
| Ship a new iOS beta                                 | `tao ship --ios`                                    |
| Ship a new beta and name a recipient                | `tao ship --ios --to alice@example.com`             |
| Invite a recipient to an existing iOS beta          | `tao invite alice@example.com --ios`                |
| Pick invitation platforms interactively             | `tao invite alice@example.com`                      |
| Update an existing beta over the air                | `tao ship --ios --update`                           |
| Roll back a compatible beta update                  | `tao ship --ios --update --rollback`                |
| Ship production                                     | `tao ship --ios --prod`                             |
| Attempt web shipping before hosting exists          | `tao ship --web` fails clearly                      |
| Select retained local builds for deletion           | `tao clean`                                         |

The remaining product-level CLI questions recorded in the prior version of this document are now
settled: default iOS builds include a simulator artifact and an available device artifact; local
native builds default to Release; and existing-beta invitations use `tao invite EMAIL`.

## Implementation sequence

These are implementation priorities, not claims that every command already works. Slice 2 follows
the landed slice 1 and delivers all of web/desktop/clean on one branch. The later bullets
give priority order, not a rule against all parallel preparation.

1. Standalone `tao run`: a live Metro session that opens no target by default, with project-local
   session ownership shared with Studio and the standalone runtime resources it needs.
2. Local web and desktop builds plus `tao clean`: deliver the static web folder, runnable macOS
   `.app`, retained artifact records, and selective cleanup together in one landing.
3. Local iOS build artifacts, including the simulator and an available physical-device build.
4. New iOS TestFlight beta shipping and `tao invite` for an existing beta.
5. iOS production shipping.
6. Local Android APK builds.
7. Beta-only OTA shipping and rollback.

For slice 2, the Developer may approve landing on green automated checks before a live smoke of the served web
artifact and opened desktop `.app`. Perform that smoke after landing and track any failure as
follow-up work; the landing report must say plainly that visible runtime behavior was not yet
proved. Do not infer from this exception that mocked Apple responses prove TestFlight, signing, or
App Store acceptance.

Slice 2 verification before landing: a real Clockwork Expo web export served HTTP 200 through its
artifact launcher; a real Electrobun command produced a `.app` containing the site and Bun runtime;
the combined web/desktop invocation retained both results; and selective `tao clean` was exercised
with both No and default Yes. A visible `.app` window and Metro-backed desktop Fast Refresh remain
unproved in this managed shell: LaunchServices returned `kLSNoExecutableErr` even for Calculator,
and Metro could not
start because Watchman could not write its LaunchAgent and Node watching reached `EMFILE`.

## Implementation and acceptance boundary

- The CLI restructure has landed on `main`: the Expo loop is in `packages/apps/expo-host`,
  TUI/reporting in `packages/cli/cli-kit`, developer commands in `packages/cli/dev-cli`, agent
  commands in `packages/cli/agent-cli`, verification in `packages/testing/verification`, and Studio
  tooling in `packages/ides/studio-tooling`. Start the workflow implementation from this structure;
  do not port the unrelated real-host branch.
- Record and reconcile this contract in the older plans and command help, then implement a shared
  project-local service, dev ownership, web/desktop builds, native local builds, ship policy, and
  clean. Keep command adapters thin. Add or change workspace packages only through the repository's
  `./agent setup --refresh-lockfile` path.
- Prove parser/help/flag compatibility, cross-process ownership and stale recovery, secret-free
  records, partial multi-target results, static web output without Metro, desktop `.app`, native
  artifacts, exact clean scope, saved ship reuse, beta/production isolation, and Studio behavior.
  Mocked Apple responses and generated-code tests do not prove TestFlight installation, device
  signing, a visible desktop window, or App Store acceptance; report those host/external boundaries
  separately.
