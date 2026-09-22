# Agent MVP Roadmap

Everything that stands between today and a public MVP release and that an agent can execute without
a new decision from the Developer. The companion list of judgments only the Developer can make is
`Developer MVP Roadmap.md` beside this file; items here name the Developer decision they wait on where one exists.

The release these items serve: a small number of outside developers — a Hacker News audience — can
install Tao, build something, and tell us what they wanted. Tao does not need to be complete. It
needs to be installable, explorable, and honest about what it does not do yet.

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
- Progress: slices 1 and 2 have landed. The binary unpacks its stdlib, runtime, and host files on
  first run and creates, checks, and compiles a project outside any checkout;
  `just standalone-cli-acceptance` proves that much. `tao dev` and `tao test` do not yet work from
  it.
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
  macOS signing and notarization must be ready before publication.
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

## First-hour quality

These decide whether the people who do install Tao enjoy the first hour.

### A5 — Tutorials and examples that cannot rot

The tutorial half has landed: `packages/cli/tao-cli/cli-tests/tutorials.test.ts` replays
`Docs/Tutorials/Your First Tao App.md` snippet by snippet, formats and validates the file after every
step, reproduces the finished file from the steps, and runs its behavior test through the real
`tao test` runner. `Tao now - two-week walkthrough.md` stays a dated record whose repository paths,
`just` recipes, `--app` names, and `tao` subcommands the same suite checks still exist.

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
- Context: `packages/ides/ide-extension`, the **Polish the IDE MVP** entry in `Roadmap.md`.
- Waits on: The Developer creates the publisher accounts and the app-safe licence structure is settled (`R1`).
  Both marketplaces are in the first public-release scope (`R12`).
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
- Remaining: the fingerprint is reachable only from a checkout of this repository, because `tao`
  has no `doctor`; `tao bug-report` is deliberately not built, so a visitor who installed a released
  binary has a form to fill but no fingerprint to attach. Revisit once `A2` gives the CLI a shape
  worth adding a command to. The discussion links currently point at the default `ideas` and `q-a`
  categories.

## Environment reach

Reducing what a developer's machine must already have. The prebuilt-host half follows `R7`'s
shared-companion decision.

### A8 — A managed toolchain and a requirements graph

A build should never fail with a Gradle stack trace on a machine that was missing a JDK. Each target
(web, iOS simulator, iOS device, Android emulator, Android device, ship) declares its requirements,
each requirement knows how to detect, install, and verify itself, and the CLI shows one plan with
sizes and licenses before it downloads anything.

- Shape: installs under a Tao-owned directory without administrator rights wherever possible — the
  Android command-line tools, SDK packages, emulator, system images, and a JDK are fully
  automatable on every OS; Xcode is a guided walkthrough (App Store or Apple download, license
  acceptance, `xcodebuild -runFirstLaunch`, simulator runtime download) because it cannot be
  automated; every download is pinned per Tao version and checksum-verified; `tao doctor` reports
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
  beta for the first public release.
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
  opens or reuses its pull request, and watches the pushed commit's checks to a verdict.
- Landed 2026-09-22, the Android emulator lane: `just companion-host-build` builds the Companion as
  a debug APK into `.artifacts/hosts/<version>/android/` beside a `tao-host.json` naming its native
  kit, and `tao dev --android` installs a host whose kit covers its own and opens the app in it in
  place of Expo Go, passing over any other host by name. Compatibility is the manifest's kit, never
  the cache path. Proven with HNReader on the `Tao_Pixel_API_36` emulator.
- Remaining: the iOS Simulator host (its build waits on CoreSimulator, unavailable on this Mac until
  a restart); publishing hosts to GitHub Releases and downloading them into `~/.tao/hosts`; physical
  Android through the Companion; the physical-iPhone invitation beta; building hosts in CI; and
  retiring the Expo Go lanes as each is covered. The entitlements need the iCloud container and push
  enabled on the app id before a device build signs.

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
  `screens`/`styles`/`rules` in place of the token-and-recipe stack, §5's single `guard default`,
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
- The reactive editing implementation has a separate [deferred follow-up](../Roadmap/Reactive%20editing%20follow-up.md):
  snapshot-provider mutation recovery, authoritative validation decisions, and live-provider/device
  acceptance. These are not implied by the implemented projected inputs and writable parameters.

### A14 — Plans already written

Work with an existing plan that needs implementation rather than decision: the design system MVP
(`Docs/Roadmap/Add Tao design system MVP/`, except the caller-override question in `R9`), the
keyboard and accessibility ledgers, the navigation follow-ups, `tao test` hardening, and the
shell-completion tail. Each is a plan-and-execute task on its own.

### A15 — Studio's simulated-user lane — **done**

Closed by `34132956`. The journey ran ten consecutive green runs in a normal terminal and
`studio-smoke-simulated-user` is an ordinary member of `VERIFY_FULL_GATES` again; `VERIFY_FULL_SKIPPED`
is empty, so the release no longer carries a quarantined lane. The editor-ownership, source-identity,
canvas geometry, pointer-release, drag-in, and sketch transaction defects it found landed with it.
It then failed the first `verify-repo` it was part of, on a last defect of its own: Unsnap pressed on
a selection an authoritative render had discarded unsnaps the whole flow. That is fixed, and the ten
consecutive green runs were re-established on 2026-09-20, which closed DEVENV-042.

### A16 — A reachable datasource for the public demo

`WordFlowerInstantDB` now selects an Instant Cloud datasource with a hard-coded app ID;
`WordFlowerLocalInstantDB` preserves the `localhost:9020` fixture for development. Hosted app
existence and live two-device sync still need confirmation before outside testers can use the demo.

- Uses local Instant for development and Instant Cloud for the production demo (`R11`). Cloud
  onboarding requires an existing account because new signups are closed, and the production demo
  needs a migration before Instant Cloud shuts down on August 31, 2027.
- Context: `Docs/Roadmap/Tao ship/Plan - Beta distribution in one command.md`,
  `Docs/Roadmap/Multiple datasources/Plan - Multiple datasources.md`'s "InstantDB" section.
