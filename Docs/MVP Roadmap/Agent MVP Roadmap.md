# Agent MVP Roadmap

Everything that stands between today and a public MVP release and that an agent can execute without
a new decision from the Developer. The companion list of judgments only the Developer can make is
`Developer MVP Roadmap.md` beside this file; items here name the Developer decision they wait on where one exists.

The release these items serve: a small number of outside developers — a Hacker News audience — can
install Tao, build something, and tell us what they wanted. Tao does not need to be complete. It
needs to be installable, explorable, and honest about what it does not do yet.

**Scope revised 2026-09-26:** [five cumulative public releases](<Plan - Staged public releases.md>)
own the public sequence. This work inventory spans those releases and later work; it is not a list
of prerequisites for release 1. Existing implementation records do not establish current QA or
distribution readiness. The [QA register](../QA/README.md) holds on-demand evidence and findings.

Each entry states what it is, why it blocks or serves the release, where the context lives, and what
done looks like. None of them is a plan; each is enough to gather context and write one.

An item is marked **done** here only once it is on `main`. Work in progress lives on branches, which
this document deliberately does not name because they move faster than it does: `./agent board`
reports every worktree, its branch, and whether it carries a merge message, which is where to look
before starting an item so two agents do not build the same thing. As of 2026-09-19 that board shows
branches ready to land for `A1`, `A4`, `A10`, `A11`, and `A12`. The `A4` branch named there,
`feat/expo-go-deprecation-30c509`, never landed and was written against package paths that have
since moved; its work is superseded rather than pending.

## Release blockers

Without these a visitor cannot use Tao at all.

### A1 — Diagnostics a newcomer can act on

`tao check` reports style warnings but stays silent on a reference to a view that does not exist,
and reports a syntax error as `Expected: Tao source without syntax errors when applying source
fixes` with no line, column, or description. Errors are most of what a person exploring a new
language sees.

- Context: `packages/language/validator`, `packages/cli/tao-cli/cli-src`, the Errors section of `packages/AGENTS.md`, and the
  `tao check` entry under **Build the enforcement and diagnostics surface** in `Roadmap.md`.
- Done: validation errors and parse errors reach the CLI with file, line, column, and a readable
  message; the exit code reflects failure; tests cover both kinds; the roadmap line that says
  `tao check` only reports canonicalization is corrected.
- Landed on `feat/tao-check-error-reporting-400fde`. Every lexer, parser, linker, and validator
  diagnostic now reaches `tao check` with its file, line, column, severity, message, and the
  offending source line underlined; the exit code fails on any error; long `../` path prefixes are
  gone; and an unresolved reference is stated in Tao's words rather than by the grammar type
  Langium names. Surfacing errors also exposed two validators judging project-wide facts against one
  entry graph, which is fixed.
- `tao fmt` reporting an unparseable file through the formatter's assertion is fixed, on
  `0ac05257`: it now returns the first lexer or parser error as the same positioned `InPlace` result
  `check` and `fix` return, while `Formatter.formatCode` and `formatFile` keep throwing for callers
  that parsed the source themselves and have nowhere to report.
- The wording and the `NaN` position both landed on `feat/tao-error-messages-78ff65`, which closes
  this item:
  - Every lexer and parser syntax error is Tao's own sentence. Tao registers all six of Chevrotain's
    message builders in `taoLanguageModule`, which reaches the core parser, the language server, and
    every workspace or session built on either, so `tao check`, `tao fix`, the LSP, and Studio read
    one set of sentences. Past three deduplicated alternatives a diagnostic names the construct it
    was parsing rather than listing what could start it, so the seventy-five-line list becomes one
    sentence. The four shapes now read:

    ```
    Expected a view member here, but found `Text`.
    Expected `(` or `=` here, but found `{`.
    Expected a name like `Greeting`, a value like `"hello"`, or a keyword like `render` here, but found `§`.
    Expected an open block for this `}` to close, but none is open here.
    ```
  - A report is also easier to read: an excerpt leads with the line above the mistake, and a file
    reports the first error on each line — its lexer error first, since a character Tao cannot read
    explains the parse that follows — capped at three with the rest counted.
  - The `NaN:NaN` position is fixed at its cause. `isPlaced` now rejects a non-finite position as
    well as a missing one, and an error against Chevrotain's end-of-file token is placed at the end
    of the source, so `view Broken() {` reports `a.tao:1:15` under the unclosed brace instead of
    `NaN:NaN` followed by the formatter's assertion.
- **Done.** The matching bullet under **Build the enforcement and diagnostics surface** in
  `Roadmap.md` is closed with it.

### A2 — A standalone `tao` executable

Today `tao` is a zsh wrapper around `bun` inside this checkout's devenv profile, and every package
is `private`. Nobody outside the repository can install Tao.

- Plan: `Plan - Standalone Tao CLI.md` beside this file answers the shape below with measured
  evidence, a nine-slice sequence, and the first-release decisions.
- Progress: slices 1–5, 7, and 8 have landed, and the binary leaves out `tao review` (slice 9).
  `just standalone-cli-release <version>` builds an unsigned macOS arm64 release with its checksum,
  index, and install script. That unsigned artifact is not publication-ready: signing/notarization
  and all applicable publication prerequisites remain required. Installed through
  `curl | sh`, the binary creates a project with its tests, then checks, compiles, tests, builds for
  web, and serves web from `tao dev` outside any checkout, and each project it creates runs under
  the release that made it; `just standalone-cli-acceptance` proves all of that. The plan's
  `tart` gate also passed a vanilla macOS guest on 2026-09-25. The plan's
  "Remaining work" orders what is still absent: the iOS Simulator and Android from `tao dev`, the
  move of `tao test` onto `bun test` and `tao ship` off Node so the
  release needs no Node at all, signing and notarization with the
  Foundation Models helper (both need the Developer ID certificate), a test for the interactive
  download of a pinned release, and publishing.
- First-release shape: a signed, notarized macOS arm64 `bun build --compile` binary; the
  files the CLI reads at runtime (stdlib, runtime sources, starters, grammar) either embedded or
  unpacked to a versioned directory; the Expo host and its `node_modules` downloaded per Tao version
  from a pinned lockfile rather than embedded; Metro and the Expo CLI driven through the binary
  itself rather than a separate Bun; a managed Node for `tao test`; an install script; and an exact
  per-project version pin that asks before downloading a missing version. Linux, Windows, Intel Mac,
  Homebrew, and npm distribution are later expansion work. The first binary omits `tao review`.
- Context: `packages/cli/tao-cli`, `packages/apps/expo-host` (the `_gen_tao-app` host and its
  dependency set), `tao`, `Docs/Spec/Tao Packages.md` on the CLI-bundled `@tao/*` modules.
- Waits on: nothing to start; public GitHub Releases hosting (`R11`), the final licence (`R1`), and
  macOS signing and notarization must be ready before publication. The credential-dependent build
  and hosted acceptance are parked until the near-release pass (`R12`).
- Done: a person with no Bun, Node, nix, or repository checkout installs `tao` with one command and
  runs `tao create` through `tao dev` on a clean machine.

### A3 — A front door: README and public documentation

The repository has no root `README.md`. There is no page that says what Tao is, what it can do
today, or how to start.

- Shape: a root README with the pitch, a short example, install and first-run steps; an honest "what
  works today / what is still design" page, because `Decisions.md` and `Apps/Tao Future/` describe
  much more than runs; a short language tour between the tutorial and `Docs/Spec/`; disposition for
  spec pages still marked WIP.
- Context: `Docs/README.md`, `Docs/Tutorials/`, `Docs/Spec/`, `Docs/Roadmap/Tao Revolution/`.
- Uses the decided 0.x positioning (`R3`) and whole-repository publication with public-audience
  edits (`R2`).
- Landed 2026-09-22: the root `README.md` — the Developer's pitch, a first app from the tutorial,
  the CLI's commands, install (the standalone binary marked as on its way, the checkout path until
  then), the 0.x promise, a plain statement that Tao is built by its author with coding agents, and
  the licence. `Docs/Spec/Tao Design.md` lost its WIP suffix, with each unimplemented section marked.
  The Developer deferred the honest "works today" page and the language tour. Remaining: the one-line
  install once `A2` ships.
- Done: a visitor who reads only the README knows what Tao is, whether it fits them, and what to run
  first.

### A4 — Retire Expo Go from the phone lane — **done**

Written on the premise that the App Store's Expo Go was stuck on SDK 54 while Tao had moved to SDK
57. That premise expired: App Store Expo Go 57.0.9 shipped on 2026-09-02, and Expo publishes SDK 57
clients for Android and the iOS Simulator as well. The lane that is actually closed to Tao is the
physical iPhone, for a different reason. Since
[2026-09-03](https://expo.dev/changelog/expo-go-57-login) Expo Go on iPhone requires an Expo account
signed in both on the phone and in the terminal serving the bundle, and `expo-config.ts` gives Metro
a repository-local Expo home, so a developer's own `expo login` never reaches it. Expo's own
statement that "Login is not required for development builds" is the argument for `A9`.

- Shape: refuse the physical iPhone with that reason and name the Companion instead; keep the
  simulator, emulator and physical-Android Expo Go lanes, which work and need no account, until
  `A9`'s prebuilt host replaces them; correct every document and message that rests on the SDK-54
  claim.
- Context: `Docs/Roadmap/Tao ship/Plan - Beta distribution in one command.md` (the lane table and
  slice 4), `packages/apps/expo-host/expo-host-src/dev-loop/`, `packages/ides/studio-companion-app`.
- Uses the shared companion host and compatibility-check decision (`R7`); retiring the broken phone
  promise does not wait on that host's completion. **Decided 2026-09-22:** Expo Go stays on the
  lanes where it works until the Companion beta exists, so "no surface offers Expo Go" is `A9`'s
  completion rather than this item's.
- Done: no surface offers Expo Go where Expo Go cannot work, every message and document gives the
  real reason rather than the SDK gap, and the phone path a newcomer is pointed at is the one Tao
  intends to support.
- Landed 2026-09-22: a physical iPhone is refused with the account-wall reason and the
  `studio-companion-install` command; the simulator remedy names the SDK it needs; Android installs
  a matching Expo Go itself and falls back to a skipped lane with its reason if that fails.
  `EXPO_SDK_VERSION` in `expo-config.ts` is the one SDK pin the loop measures clients against, and a
  test keeps it equal to the host package's `expo` dependency. The beta-distribution plan and lane
  research carry a dated correction of the SDK-54 claim.

### A20 — Re-enable the Studio HNReader Feed proof (complete)

The `verify-full` proof that drags generated HNReader Stories into a drawn view, keeps, discards and
undoes them (`studio-real-app.test.ts`, driven by `studio-hnreader-feed-journey.ts`) is enabled.
The Draw and Design sequence now waits for the relevant canvas and applied preview revision, and
the retained preview recovers a missing publication acknowledgement with bounded reloads.

- Acceptance (2026-09-28): ten consecutive `./agent unsandboxed studio-proof-real-app` runs passed
  from 07:23 through 07:35 UTC after merging current `main`, each overlapping a passing
  `./agent check --no-cache` lane. Every run covered physical Feed clicks and drags, the Design Title
  drop after Draw, Keep/Discard/Undo, and a persisted reopen. Studio now prepares its browser bundle
  before reporting server readiness.
  `DEVENV-STUDIO-REAL-APP-PROOF-FAILS-INTERMITTENTLY-UNDER-LOAD` retains its stricter concurrent
  `verify` acceptance.

## First-hour quality

These decide whether the people who do install Tao enjoy the first hour.

### A5 — Tutorials and examples that cannot rot

The tutorial half has landed: `packages/cli/tao-cli/cli-tests/tutorials.test.ts` replays
`Docs/Tutorials/Your First Tao App.md` snippet by snippet, formats and validates the file after every
step, reproduces the finished file from the steps, and runs its behavior test through the real
`tao test` runner. The dated two-week walkthrough is gone; this suite covers Your First Tao App.

What remains is the example set. The starters are proven byte-for-byte by their lowering test, but
nothing says which examples a visitor is pointed at, and the apps under `Apps/` mix public examples
with design material and test fixtures.

- Shape: choose the public example set (starters, HNReader, WordFlower Current), polish it, and label
  everything else as design material or test fixture in the README that owns it.
- Context: `Apps/Starters/README.md`, `Apps/HNReader/`, `Apps/WordFlower/README.md`,
  `Apps/Test Apps/README.md`, `packages/cli/tao-cli/cli-tests/tutorials.test.ts`.
- Done: every example a visitor is pointed at runs on a fresh install, and the documents that point
  at examples name only those.

### A6 — Release the IDE extension

Syntax, diagnostics, formatting, source actions, go-to-definition, and references exist in
`packages/ides/ide-extension` and are unreachable outside this checkout. Editor support is a large part
of whether a new language feels real.

- Shape: packaging, versioning, and publication to the VS Code Marketplace and Open VSX, with the
  extension resolving a `tao` from the user's machine rather than a repository path.
- Packaging progress: the VSIX carries a minified, bundled language server and standard library,
  its own README, and the repository licence. The editor/CLI version relationship still needs to
  follow the standalone CLI work. On 2026-09-24, host preparation installed the `0.0.1` VSIX in an
  isolated VS Code profile and confirmed `tao.tao-ide-extension@0.0.1` was listed. Opening a `.tao`
  file in that profile and both marketplace releases remain unproved.
- Release workflow progress: `./agent unsandboxed prepare-release ide-extension` packages and checks a clean VS Code
  installation; `just ide-extension-release-publish` uploads the same VSIX to both registries. Publication
  still needs editor activation acceptance, publisher accounts, and the final licence before use.
- Context: `packages/ides/ide-extension`, the **Polish the IDE MVP** entry in `Roadmap.md`.
- Waits on: The Developer creates the publisher accounts and the app-safe licence structure is settled (`R1`).
  Both marketplaces are in the first public-release scope, but their account-dependent publication
  and listing checks are parked until the near-release pass (`R12`). Local VSIX and editor checks
  can continue.
- Done: `ext install` on a clean machine gives working Tao editing.

### A7 — Feedback intake

The point of the release is to learn what people want. Nothing collects that today.

- Shape: issue and discussion templates aimed at "I tried to build X and could not" and "this
  confused me"; `tao doctor --json` extended into a `tao bug-report` that attaches an environment
  fingerprint (OS, architecture, Tao version, toolchain hashes, Xcode version) so environment-shaped
  reports are diagnosable.
- Context: `packages/cli/dev-cli` doctor output and the existing `.github/` forms.
- Uses GitHub Issues and Discussions for early feedback (`R10`).
- Done: a frustrated visitor has an obvious, low-effort place to say so, and what they send is
  enough to reproduce.
- Landed: `.github/` carries both issue forms, a discussion form for the open-ended half of each
  framing, and `CONTRIBUTING.md`; `EnvironmentFingerprint` in `packages/cli/dev-cli` reports OS,
  architecture, Tao commit, toolchain versions, toolchain and lockfile hashes, and Xcode where
  present, and `doctor --fingerprint` prints it alone. Nothing personal can reach it: each value is
  parsed out of a tool's output and kept only when it already reads as a version, a hash, or a plain
  word, which `environment-fingerprint.test.ts` proves on hostile probe output and on the real host.
- Earlier limit: the fingerprint was reachable only from a checkout, while an installed CLI had no
  report command. The discussion links currently point at the default `ideas` and `q-a` categories.
- Implemented in the installed CLI: `tao doctor`, `tao doctor --json` / `--fingerprint`, and
  `tao bug-report` expose a privacy-filtered fingerprint and a pasteable report draft with direct
  links to the existing issue forms. The fingerprint includes the release version, OS, architecture,
  available tool versions, Xcode where present, and a hash of the installed resource bundle. The
  commands run without a checkout and send nothing. The bundled CLI passed disposable-home
  acceptance without Bun, Node, or a checkout on `PATH`; a separate public release install remains
  part of release QA.

### A21 — Staged-release gates and on-demand QA

The [staged plan](<Plan - Staged public releases.md>) promises each release only what its evidence
proves, so a public build must hide later surfaces and a reviewer must be able to say what is proved.

- Shape: a release-capability catalog that classifies every CLI command, target, and option by phase
  and fails closed on anything unclassified; a QA register with an inventory of every surface, pinned
  runs, immutable observations, finding lifecycles, and per-release packets under `Docs/QA/`.
- Context: `Docs/QA/README.md`, `packages/cli/dev-cli/dev-cli-src/qa/`, `Plan - Initial release QA.md`.
- Progress: the first recheck at `0aa8ebcf` reviewed the release-1 front door, tutorial, starters,
  starter skills, and editor readme, and recaptured the reading-list, Notebook, and HNReader
  scenarios. The findings it records are report-only; product fixes are separately scoped. Phase-1
  cells were re-recorded at `442e6416` after the catalog began classifying subcommands by full path.
  On 2026-10-03 a screenshot whose own preview logs a console error became a failed screenshot, the
  surface kinds took plain names (release requirements, screenshot sets, dev checks), the starter
  column and sketch findings became fixed-awaiting-qa, and a re-recorded Notebook capture closed the
  panel-stretch finding. The Developer accepted the centered tablet column from the recorded
  screenshot on 2026-10-03. Source documentation repairs clarify release availability, checkout
  commands, tutorial entry and packaged skills; their required human and published-artifact checks
  remain separate. Further automated checks are A23.
- Remaining: human DOC1 and install passes, installed-artifact and marketplace evidence, the
  unreviewed starter skills, CLI help text, and Spec documents; recapturing HNReader's phase-2
  cells; declaring capture cells for story visual channels, which agents cannot pass until then.
- Done: every release packet reports current evidence for each applicable cell, and every open
  finding has an owner or a recorded decision.

### A18 — Liquid Glass by default

- [ ] **Before MVP:** implement Liquid Glass as Tao's default appearance, so newly created apps
      use it without opting in.
- Developer decision: requested 2026-09-26. Define platform fallbacks and accessibility behavior
  in the implementation plan, and verify the default in a newly created app before closing this item.
- Implementation plan: [Liquid Glass default](<Plan - Liquid Glass default.md>). The native runtime
  now follows system light/dark appearance and the iOS host requests automatic appearance;
  compatible system tabs, headers and controls supply Liquid Glass. Tao's custom toggle bar uses
  regular glass when available and an opaque surface under Reduce Transparency. The fresh-app
  creation test verifies the native imports and automatic tabs in one- and two-feature projects; the
  packaged CLI acceptance also created and checked a fresh starter outside a checkout.
  Remaining acceptance: observe the created app on a compatible iOS build with light/dark, Reduce
  Transparency, Increase Contrast, Reduce Motion, large text and VoiceOver before closing this item.
  The Developer accepted simulator observation in place of a physical device for A18 on 2026-09-28;
  build and launch evidence alone does not close the visual and accessibility checks.

### A22 — Light and dark mode in every app

- [ ] **Before MVP:** review every app under `Apps/` (starters, reference apps, the reading-list
      tutorial app, and test apps a visitor can reach) in light and dark appearance, and give each
      one a deliberate, legible design in both.
- Developer decision: requested 2026-10-02, deferred until after the staged-release QA branch. The
  reading-list tutorial app is the priority and must be excellent in both appearances, since it is
  the first app a newcomer builds.
- Context: `Docs/Tutorials/Your First Tao App.md`, `Apps/Starters/`, `Apps/HNReader/`, A18's
  appearance work, and `./agent unsandboxed storage qa` for a dated screenshot round to review.
- Done: a screenshot round shows every app correct in both appearances, and the tutorial's finished
  app has been reviewed by the Developer.

### A23 — Design checks a capture can make on its own

- [ ] **Before release 3:** extend the QA capture so it finds design defects without a reviewer,
      after the staged-release QA branch lands.
- Developer decisions, 2026-10-03:
  - Screenshot every app that declares scenarios, found automatically, so Pantry and new apps are
    covered without editing the QA inventory by hand.
  - Add element-tree checks to the browser capture: text contrast, tap-target size, overlapping
    elements, and content overflowing its container. They read the rendered elements, not pixels.
  - Let an app state its own design rules in a `rules` section of `Design.tao`, with Tao's defaults
    when it states none. This is language surface, so it goes through `2 - Next` and `Decisions.md`
    before it is built.
  - Agent visual review reuses the existing `--ai` lanes under the deferred `ai-assist` capability.
  - A separate `--suggest` report offers design recommendations and never creates findings.
- Context: `packages/ides/studio-tooling/studio-tooling-src/StudioReview.ts` (capture),
  `packages/cli/dev-cli/dev-cli-src/qa/QaInventory.ts` (the hand-listed screenshot sets),
  `TR-studio-preview.tsx` (computed styles), and `Docs/QA/README.md`.
- Done: a capture of every scenario app reports each check per screenshot, a failing check fails
  that screenshot, and the rules section is decided and implemented.

## Environment reach

Reducing what a developer's machine must already have. The prebuilt-host half follows `R7`'s
shared-companion decision.

### A8 — A managed toolchain and a requirements graph

Repository iOS setup is the first bounded slice: `just setup-ios` / the named `setup-ios` host
operation inspects explicit Xcode and simulator-runtime versions, supports a side-by-side local
Xcode archive installation with automatic detection in Downloads and a download-and-resume prompt,
Apple's runtime download/import, and hands off account, license,
and administrator steps. The [developer workflow documentation](../../packages/cli/dev-cli/README.md#ios-simulator-setup)
owns its commands and limits. Public CLI integration, a shared target requirements graph, Android
installation, and complete clean-machine acceptance remain open.

A build should never fail with a Gradle stack trace on a machine that was missing a JDK. Each target
(web, iOS simulator, iOS device, Android emulator, Android device, ship) declares its requirements,
each requirement knows how to detect, install, and verify itself, and the CLI shows one plan with
sizes and licenses before it downloads anything.

- Shape: installs under a Tao-owned directory without administrator rights wherever possible — the
  Android command-line tools, SDK packages, emulator, system images, and a JDK are fully
  automatable on every OS; Xcode combines archive installation and simulator runtime downloads
  with guided Apple account, license, and administrator steps; every download is pinned per Tao
  version and checksum-verified; `tao doctor` reports
  the same graph without installing.
- Context: `packages/cli/dev-cli` doctor, `packages/cli/tao-cli/cli-src/ship-*`, the environment discussion this
  roadmap came out of.
- Done: `tao run android` on a bare machine explains what it needs, asks, installs it, and works;
  nothing it installs requires `sudo` except the Xcode steps that inherently do.

### A9 — Prebuilt host apps for simulators and devices

Tao controls its native module set, so a compatible prebuilt host can run a Tao app's bundle:
install it on a simulator, emulator, or phone and point it at Metro. This removes the native build
from the development loop, which no virtualization approach can do.

- Shape: use the companion app as the shared host, release its native shell infrequently, and check
  bundle compatibility explicitly. Build the applicable simulator/emulator artifacts in Tao's CI;
  `tao dev` obtains and launches a compatible host. The physical-iPhone companion is an invitation
  beta in release 4. iOS Simulator is release 2; Android is deferred beyond release 5.
- Context: `packages/ides/studio-companion-app` (Slice 1 and 2 records under
  `Docs/Roadmap/Tao Studio companion app/`), `packages/apps/expo-host`.
- Uses the host-scope decision in `R7`; physical-device acceptance and beta distribution remain
  implementation and release proofs. Carries the rest of `A4`: the simulator, emulator and
  physical-Android Expo Go lanes are removed as this host replaces each one.
- Done: a developer with no Xcode runs a Tao app on an Android emulator and on a physical iPhone,
  and no surface offers Expo Go.
- Landed 2026-09-22: the Companion carries every native module an app host can reach, at the same
  version, which `companion-native-parity.test.ts` enforces, and claims the iCloud (CloudDocuments,
  CloudKit) and push entitlements `tao-icloud` asks for. `.github/workflows/pull-request.yml` proves
  the pull-request trigger with a job that verifies nothing, and `./agent open-pr` pushes a branch,
  opens or reuses its pull request, and watches the pushed commit's checks to a verdict. Since
  2026-09-25 both workflows run only when a pull request opens, never on a later push to its branch.
- Landed 2026-09-22, the Android emulator lane: `just companion-host-build` builds the Companion as
  a debug APK into `.artifacts/hosts/<version>-<kit digest>/android/` beside a `tao-host.json` naming its native
  kit, and `tao dev --android` installs a host whose kit covers its own and opens the app in it in
  place of Expo Go, passing over any other host by name. Compatibility is the manifest's kit, never
  the cache path. Proven with HNReader on the `Tao_Pixel_API_36` emulator.
- Landed 2026-09-23, distribution (`R7`): `just companion-host-publish` puts a built host on a
  prerelease tagged `companion-host-<version>-<kit digest>`, and when no cached host fits, `tao dev`
  lists those releases without signing in and downloads the newest whose kit covers its own into
  the Tao home's `hosts/` (`~/.local/share/tao/hosts` by default). The download is proven against a
  fake GitHub only: until the repository is public
  the listing answers 404, and `tao dev` says so and uses Expo Go.
- Landed 2026-09-23, the iOS Simulator lane: `just companion-host-build --platform ios-simulator`
  builds the Companion for both simulator architectures, signed ad hoc so its entitlements are
  embedded, and `tao dev --ios` installs a compatible host unless the simulator already has that
  build and opens the app in it. Publishing zips it beside the Android host on the same release.
  Proven with HNReader on an iPhone 17 simulator; the first, unsigned build carried no entitlements
  and CloudKit aborted it, which the build now refuses.
- Landed 2026-09-25, physical Android: `tao dev`'s phone path prepares a phone the way it prepares an
  emulator, installing a compatible Companion only when the phone's copy differs, and reaches Metro
  over `adb reverse` on the phone's own loopback, or at the Mac's LAN address when that fails.
  Unit-tested only; the Developer asked for it to land before a device run.
- Expo Go retirement plan (2026-09-25; leave these paths in place until the repository is public,
  compatible Android and iOS Simulator hosts are published, and a fresh Tao home has downloaded and
  opened each one):
  1. In `expo-runner/android.ts`, replace the `prepareRuntimeOnSerial` fallback to `ensureExpoGo` /
     `ensureExpoGoOnSerial` with a Companion-only result. Remove the Expo Go APK lookup, cache,
     installation, version check, `openExpoGoOnSerial`, and the `expo-go` runtime branch only after
     the host path covers both emulator and phone. A missing, incompatible, or un-installable host
     should name the reason and leave that target unopened while Metro stays available; it must not
     silently launch another runtime. Update the Android preparation and opening messages accordingly.
  2. In `expo-runner/run-targets.ts`, replace the iOS Simulator's Expo Go branch (`/_expo/open`,
     `expoLink('ios')`, then `EXPO_GO_URL`) and the install-failure fallback with the Companion
     development-client URL. If the host is unavailable or installation fails, report that and skip
     opening the simulator. Replace `simulatorOpenFailure`'s `bunx expo start --ios` Expo Go remedy
     with a host installation or download remedy, while retaining its useful LaunchServices detail.
  3. In `expo-runner/physical-device.ts`, replace the Android phone's Expo Go URL for USB reverse and
     LAN fallback with the Companion's development-client URL for the selected Metro host. Replace
     `Try ... in Expo Go` and the no-device Expo Go wording with Companion recovery steps. Keep the
     current physical-iPhone refusal until the invitation beta can install and open a signed
     Companion; then replace that refusal with the device-host path.
  4. Remove `EXPO_GO_URL` from `expo-config.ts` and the Expo Go-only facade in `ExpoRunner.ts` after
     callers are migrated. Keep the Expo SDK pin for host compatibility. Prune the unused Expo Go
     link helpers in `metro.ts`, then update focused runtime tests, the Companion README, and active
     dev-loop documentation so no command or message offers Expo Go as a Tao app runtime. Verify
     both cache-hit and fresh-download launches, missing-host and failed-install messages, and the
     Android USB-reverse and LAN cases before declaring the retirement done.
- CI host-build workflow (2026-09-25; hosted run still unproved): opening a relevant pull request
  checks the Companion's native-kit parity and build Android on `ubuntu-24.04` and iOS Simulator on `macos-26`.
  It does not publish a host; the first hosted result must establish that both runners can build it.
- Local host proof 2026-09-25 from `68a36b1a`: after `./agent unsandboxed direnv allow`, the named
  `companion-host-build --platform ios-simulator` operation completed with `** BUILD SUCCEEDED **`
  and wrote `Tao Companion.app` and `tao-host.json` to
  `.artifacts/hosts/1.0.0-6449773e3a7a/ios-simulator/`. CocoaPods used shared React Native tarballs,
  so a separate fresh download fetched the exact 0.86.3 dependencies debug artifact from Maven:
  18,746,275 bytes, SHA-256 `fa019419384f6f859655fec80b2d20736bb0441bb911cb1944b91719322ae512`,
  byte-identical to the cached tarball. This proves local build and artifact network access; hosted
  CI and a published-host download remain unproved.
- Remaining: the first published host and a live download once the repository is public; proving
  physical Android on a phone; the physical-iPhone invitation beta; live CI host-build proof; and
  retiring the Expo Go lanes as each is covered. The entitlements need the iCloud container and push
  enabled on the app id before a device build signs. The account-dependent device build and release
  proof are parked until the near-release pass (`R12`); simulator and Android work can continue.

### A10 — Publication hygiene audit — **done**

Whatever becomes public carries the agent instructions, the Developer's roadmap notes, machine-specific files,
and a committed `secrets/secrets.jsonc`.

- Landed: `Report - Publication audit.md` beside this file, and on 2026-09-22 the fixes `R2` left
  mandatory — the WordFlower ship lock untracked and ignored (`P15`; rotating the App Store Connect
  key it named is the Developer's manual step), `roPhone` and the personal absolute paths gone from
  docs, comments, and fixtures (`P16`, `P18`), the full AGPL-3.0 text with a copyright holder and
  `AGPL-3.0-only` declared in every `package.json` (`P24`; SPDX headers wait for `R1`'s split) — and
  the public-audience edits: the instruction set, the skills, and every document say "the Developer"
  rather than a name (`P1`), `Roadmap.md`'s personal sections are reworded (`P7`, `P8`), and the
  README states plainly how Tao is built (`P2`). `P17` — the login name Watchman's socket path puts
  in the generated harness config — is its own project, since neither harness accepts a
  user-agnostic socket rule.

- Shape: inventory what would become public and what it reveals; confirm the committed secrets file
  is encrypted and that history holds nothing else; list machine-specific files (`local.properties`,
  named devices in package READMEs) and personal references.
- Context: the repository root, `.rulesync/`, `agents/`, `Roadmap.md`.
- Waits on: nothing for the audit; `R2` decides what to do with its findings.
- Done: The Developer has one list of everything a public repository would expose, with a recommendation per
  entry.

## Language program

The `Docs/Roadmap/Tao Revolution/Process.md` sequence continues through the release; these are its
agent-executable steps.

### A11 — Process step 2: rewrite the Revolution tier

WordFlower's `4 - Revolution` re-expressed in the decided dialect, with the `Apps/Tao Future/` apps
as sibling references. Transcription against a settled decision record, with the Developer reviewing the result.

- Context: `Docs/Roadmap/Tao Revolution/Decisions.md`, `Process.md` step 2, `Apps/WordFlower/README.md`.
- Landed: the tier is written to the decisions section by section — §13's `colors`/`sizes`/`text`/
  `screens`/`styles`/`rules` in place of the token-and-recipe stack, §5's single app-scoped `guard`,
  §8's `check` as the action's early exit, §7's write-through `bind` and composed `draft`, §10's
  `CollapseOrder`, `Width`, `Compact`, `reveal`, and `link`, §15's foreign action and view heads in
  place of `unsafe ts`, and §16's `fixture`, devices, store-query assertions, and `prepare`.
  `4 - Revolution/Open questions.md` carries the eleven things the decisions do not answer; the one
  that costs most to defer is Q9, whether empty argument lists on containers are omitted, because
  §9 and §10's own example disagree and `3 - MVP` inherits whichever wins. `Decisions.md` gained
  three repairs of its own contradictions, and a fourth candidate turned out to be a decision argued
  on merits rather than a repair, so it went to Q9 instead of being taken. `Coverage.md` rows stay
  with `A12`, which owns that file.

### A12 — Process step 3: consolidate the Tao Future apps

Landed. Skillet, Hearth, and Wayfare read as `Decisions.md` decides, and `Coverage.md` names a
forcing feature for every capability — four of them `none — for the Developer`, which are red flags for step 4
rather than contrived features. What remains is not agent work: the ten spellings the port had to
choose where `Decisions.md` is silent are listed in `Apps/Tao Future/README.md`, and the one place
where `Decisions.md` still disagrees with itself (two visibility modifiers versus five) waits on the Developer
as `R14`. Step 2's rewrite settled the other one this pass reported, retiring `TabNav` for
`SelectionNav`.

- Context: `Apps/Tao Future/README.md`, `Docs/Roadmap/Tao Revolution/Coverage.md`.

### A13 — Tranches from the Current ↔ MVP gap

Process step 5: one tranche at a time, each ending in behavior tests written in Tao, until Current
equals MVP.

- Scope: `R5` defers the authority cluster to the later app expansion. `R6` leaves the three runtime
  contracts experimental at 0.x launch; settle each when a forcing slice reaches it.
- Context: `Coverage.md`'s tier column, `Apps/WordFlower/README.md` tranche mechanics.
- Scope settled in the 2026-09-25 decision rounds (`Coverage.md` carries the tiers): MVP ships
  `required` forms with `create … with` and `Problems(…)`, `check`, `when do` with `saved` /
  `rejected` / `error` and declared-case branches plus the unhandled-failure warning, the
  runtime-supplied app-scoped `guard`, query `search`, plural `phrase`s, the bridge metadata module, a
  document export behind `fails`, and the test world's `on`/`with`, `network`, `wait for sync`,
  and `datasource fails after`. Deferred: `validate` and `refuse when`, `queued`, `group by`,
  preferences with `Me` and `@tao/auth`, copy extraction and `words`, clock and collaborator
  controls, and multi-target interaction. Action-level `guard` is retired in favour of `check`.
- Language tranche status (2026-09-25): the settled language subset above is implemented, tested in
  Tao journeys, absorbed by WordFlower Current, and landed. This includes the Markdown export's
  declared failures, provider-faithful test world controls, and checked TypeScript bridge contracts.
  A13 remains open for the other MVP rows that `Coverage.md` still marks partial, pending, or absent;
  these in-process journeys do not establish live-provider, device Share-sheet, or release acceptance.
- The reactive editing implementation has a separate [deferred follow-up](../Roadmap/Reactive%20editing%20follow-up.md):
  snapshot-provider mutation recovery, authoritative validation decisions, and live-provider/device
  acceptance. These are not implied by the implemented projected inputs and writable parameters.

### A14 — Plans already written

Work with an existing plan that needs implementation rather than decision: the design system MVP
(`Docs/Roadmap/Add Tao design system MVP/`, except the caller-override question in `R9`), the
keyboard and accessibility ledgers, the navigation follow-ups, `tao test` hardening, and the
shell-completion tail. Each is a plan-and-execute task on its own.

- Design system status (2026-09-25): **MVP done**. The `bg`/`fg` and flat-catalog deprecations,
  WordFlower "DESIGN VALUES" tranche, casing errors, `selected`, `color` parameters, and `tao fix`
  migration are implemented. Styles and sizes used by a shared view are checked across every
  mounted design, including refinements. `rules { }` and rule checks are deferred past MVP. The
  plan's "Design values tranche" and "Design rules — deferred past MVP" sections carry the detail.

Follow-ups requested in the 2026-09-26 auth design review; the later staged-release decision places
auth/access/account-backed offline app data beyond release 5:

- **Drafts and completeness, separate from auth:** keep the new/edit draft and queued-submission
  lifecycle discussion separate from auth. Main already provides required-field completeness;
  auth reuses that implementation rather than introducing a second contract.

- **Auth and account data:** follow the sequenced
  [implementation plan](<../Roadmap/Plan - Auth and account data.md>) for syntax, provider-neutral
  sessions, backend-enforced owner/member rules, supplied/custom UI, and offline data.
  This plan does not settle the remainder of R5's authority cluster and is not a prerequisite for
  releases 1–5. CloudKit's narrower release-4 offline/account-switch acceptance remains required.

**Post-MVP deferrals:** text truthiness and named audiences. Neither is an auth prerequisite.
Scope and review history: [Auth syntax review](<../Roadmap/Auth syntax review.md>).

### A15 — Studio's simulated-user lane — **done**

Closed by `34132956`. The journey ran ten consecutive green runs in a normal terminal and
`studio-smoke-simulated-user` is an ordinary member of `VERIFY_FULL_GATES` again; `VERIFY_FULL_SKIPPED`
is empty, so the release no longer carries a quarantined lane. The editor-ownership, source-identity,
canvas geometry, pointer-release, drag-in, and sketch transaction defects it found landed with it.
It then failed the first `verify-repo` it was part of, on a last defect of its own: Unsnap pressed on
a selection an authoritative render had discarded unsnaps the whole flow. That is fixed, and the ten
consecutive green runs were re-established on 2026-09-20, which closed DEVENV-042.

### A16 — A reachable datasource for the public demo

**Scope revised 2026-09-26:** this InstantDB evidence is retained as implementation history. The
five-release public plan uses local data first and CloudKit private same-person sync at release 4;
a public hosted InstantDB demo is deferred beyond release 5. It cannot satisfy CloudKit acceptance.

`WordFlowerInstantDB` now selects an Instant Cloud datasource with a hard-coded app ID;
`WordFlowerLocalInstantDB` preserves the `localhost:9020` fixture for development. Hosted app
existence is confirmed. On 2026-09-22, a direct Expo web export of the hosted variant loaded an
empty library, created a disposable workspace, retained it after reload, and delivered a second
workspace to a second browser origin without reload. On 2026-09-23, the development build ran
`WordFlowerInstantDB` on a connected iPhone: a phone-created workspace (`P923A`) appeared in an
independent browser client, and a browser-created workspace (`B923A`) appeared on the phone after
the app was relaunched. This accepts live hosted sync on a physical device; TestFlight installation
and distribution remain separate release checks.

- Uses local Instant for development and Instant Cloud for the production demo (`R11`). Cloud
  onboarding requires an existing account because new signups are closed, and the production demo
  needs a migration before Instant Cloud shuts down on August 31, 2027.
- Context: `Docs/Roadmap/Tao ship/Plan - Beta distribution in one command.md`,
  `Docs/Roadmap/Multiple datasources/Plan - Multiple datasources.md`'s "InstantDB" section.

### A19 — Configure an InstantDB backend through the Tao CLI

- [ ] **Before MVP:** a Tao developer configures an app's InstantDB backend with the `tao` CLI alone:
      store the app's InstantDB admin or platform token as a Tao CLI secret, register auth clients
      such as Clerk, and push the compiler-emitted schema and permission rules as a migration.
- The Tao CLI has a project-scoped encrypted secret store, separate from the repository development
  store behind `./agent setup-clerk`. `tao instantdb push` can read its admin token from that store.
  The remaining work in this item is backend configuration and migration flow through the CLI;
  tokens stay out of app source, generated output, and logs.
- Developer decision: requested 2026-09-27. The first InstantDB-with-auth demo runs on the
  Developer's existing Instant Cloud account and may be configured by hand before this lands.

### A20 — Finish the InstantDB auth pairing

Auth Review runs on Instant Cloud with InstantAuth and with Clerk and no server of ours (landed in
`fd4c1012` and `f7ecb086`); the Developer ran both variants on a physical iPhone on 2026-09-27.
Deferred that day, to finish before MVP:

- [ ] **Before MVP:** implement the answers to `R15`'s five questions once the Developer settles
      them.
- [ ] **Before MVP:** a Clerk sign-in's InstantDB session must not outlive the Clerk session. The
      datasource signs that session out on release, failure, and cancel, and only the session it
      opened, but an app killed while signed in leaves it persisted in the InstantDB client, and
      InstantDB refresh tokens do not expire. A launch whose Clerk session has ended can still find
      the client signed in as that user until something signs it out. `R15`'s offline-launch
      question decides whether a launch reuses that session or discards it.
- [ ] **Before MVP:** hosted acceptance that checks stored data. The phone runs are the Developer's
      report only. Repeat the local live test's admin-query checks (the account row keyed by the
      InstantDB user, an owned note, another account denied) against the Instant Cloud app for both
      variants.
- [ ] **Before MVP:** an automated journey for `AuthReviewInstantClerk`. A local InstantDB cannot
      verify a Clerk token without a real Clerk instance, so the Clerk pairing has only provider
      unit tests.
- [ ] **Before MVP:** WordFlower's hosted push. Store its Instant app's admin token as
      `WORDFLOWER_INSTANT_ADMIN_TOKEN`, add a recipe like `instant-review` that pushes with it, and
      push once the app is confirmed to be WordFlower's own. `Apps/WordFlower/README.md` holds the
      token and shared-app hazards.
- Instant Cloud shuts down on 2027-08-31 (`R11`, `A16`); `Docs/Roadmap/Hosted data provider
  candidates.md` weighs the replacement and is the next slice. The dev client aborting when it
  reloads with the InstantDB websocket open is
  `DEVENV-DEV-CLIENT-CRASHES-RELOADING-WITH-AN-OPEN-WEBSOCKET`.
- Context: `Docs/Roadmap/Plan - Auth and data pairing.md` (progress, Developer actions, InstantDB
  facts), `Apps/Test Apps/README.md` (Auth Review), `packages/apps/providers/instantdb/README.md` (live
  tests), and `DEVENV-TAO-TEST-WAITS-FOREVER-ON-A-JEST-WORKER-LEFT-OPEN` for why `tao test` cancels a
  journey file's leftover timers.
- Done: every box above is checked on `main`.

## Project tracking

### A17 — In-repository issues with git-bug, synced to GitHub Issues

Open work is tracked today in Markdown — `Roadmap.md`, these roadmap files, and the
developer-environment ledger — and `R10` makes GitHub Issues the place outside developers report
problems. Nothing connects the two, and agents working offline in a worktree cannot read or file an
issue. [git-bug](https://github.com/git-bug/git-bug) stores issues as Git objects under `refs/bugs/`,
so they travel with the repository, work offline, and are scriptable from a shell; its GitHub bridge
imports and exports issues and comments.

- Shape: two steps, in order. First adopt git-bug locally: add it to the devenv profile (a dependency
  change the Developer approves), expose the commands agents need through `./agent`, make sure
  landing and worktree creation carry `refs/bugs/` and `refs/identities/`, and state which tracked
  work moves into issues and which stays in Markdown. Then configure the GitHub bridge so issues
  filed on GitHub arrive in the repository and local issues reach GitHub, with the token kept out of
  the repository and a documented pull/push cadence.
- Context: `Roadmap.md`, `Docs/Roadmap/Developer environment upgrades.md`, `A7`'s `.github/` issue
  forms, `R10`.
- Waits on: the Developer's approval of the dependency, and of what migrates out of Markdown; the
  bridge needs a GitHub token with issue access.
- Done: an agent in a fresh worktree lists, files, and comments on issues through `./agent`, and an
  issue opened on GitHub appears there after a sync, and the reverse.
