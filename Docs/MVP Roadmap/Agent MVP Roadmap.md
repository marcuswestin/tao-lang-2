# Agent MVP Roadmap

Everything that stands between today and a public MVP release and that an agent can execute without
a new decision from Ro. The companion list of judgments only Ro can make is
`Ro MVP Roadmap.md` beside this file; items here name the Ro decision they wait on where one exists.

The release these items serve: a small number of outside developers — a Hacker News audience — can
install Tao, build something, and tell us what they wanted. Tao does not need to be complete. It
needs to be installable, explorable, and honest about what it does not do yet.

Each entry states what it is, why it blocks or serves the release, where the context lives, and what
done looks like. None of them is a plan; each is enough to gather context and write one.

An item is marked **done** here only once it is on `main`. Work in progress lives on branches, which
this document deliberately does not name because they move faster than it does: `./agent board`
reports every worktree, its branch, and whether it carries a merge message, which is where to look
before starting an item so two agents do not build the same thing. As of 2026-09-19 that board shows
branches ready to land for `A1`, `A4`, `A10`, `A11`, and `A12`.

## Release blockers

Without these a visitor cannot use Tao at all.

### A1 — Diagnostics a newcomer can act on

`tao check` reports style warnings but stays silent on a reference to a view that does not exist,
and reports a syntax error as `Expected: Tao source without syntax errors when applying source
fixes` with no line, column, or description. Errors are most of what a person exploring a new
language sees.

- Context: `packages/validator`, `packages/tao-cli/cli-src`, the Errors section of `packages/AGENTS.md`, and the
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
- Still open from this item: `tao fmt` reports a file it cannot parse through the formatter's own
  assertion rather than a positioned diagnostic, and Chevrotain's parser wording ("Expecting token
  of type …") is passed through unchanged.

### A2 — A standalone cross-platform `tao` executable

Today `tao` is a zsh wrapper around `bun` inside this checkout's devenv profile, and every package
is `private`. Nobody outside the repository can install Tao.

- Plan: `Plan - Standalone Tao CLI.md` beside this file answers the shape below with measured
  evidence and a nine-slice sequence, and leaves eight questions to Ro.
- Shape: `bun build --compile` binaries for macOS, Linux, and Windows on both architectures; the
  files the CLI reads at runtime (stdlib, runtime sources, starters, grammar) either embedded or
  unpacked to a versioned directory; the Expo host and its `node_modules` downloaded per Tao version
  rather than embedded; Metro and the Expo CLI driven through the binary itself rather than a
  separate Bun or Node; an installer script, a Homebrew tap, and an npm wrapper; a per-project
  version pin so a project selects the Tao it was written against.
- Context: `packages/tao-cli`, `packages/runtime-toolchain` (the `_gen_tao-app` host and its
  dependency set), `tao`, `Docs/Spec/Tao Packages.md` on the CLI-bundled `@tao/*` modules.
- Waits on: nothing to start; the tap repository and what is published come from Ro (`R2`), and the
  code signing certificates from `R8`, which owns where signing happens.
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
- Waits on: Ro approves the pitch and positioning (`R3`), and the repository-publication decision
  (`R2`) settles which audience the README addresses.
- Done: a visitor who reads only the README knows what Tao is, whether it fits them, and what to run
  first.

### A4 — Retire Expo Go from the development loop

Tao moved to Expo SDK 57 on 2026-09-15, and the App Store's Expo Go carries SDK 54, which Expo has
been unable to move past. `tao dev` still opens Expo Go, so the physical-device lane is broken for
anyone outside this repository.

- Shape: remove or gate the Expo Go paths, point the device loop at the Tao-published development
  build, and correct every document and message that still promises Expo Go.
- Context: `Docs/Roadmap/Tao ship/Plan - Beta distribution in one command.md` (the lane table and
  slice 4), `packages/dev/dev-src/expo-dev-loop/`, `packages/studio-companion-app`.
- Waits on: the host-scope decision (`R7`) for the full prebuilt-host lane; retiring the broken
  promise does not.
- Done: no surface offers Expo Go, and the documented device path is one a newcomer can complete.

## First-hour quality

These decide whether the people who do install Tao enjoy the first hour.

### A5 — Tutorials and examples that cannot rot

The tutorial half has landed: `packages/tao-cli/cli-tests/tutorials.test.ts` replays
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
  `Apps/Test Apps/README.md`, `packages/tao-cli/cli-tests/tutorials.test.ts`.
- Done: every example a visitor is pointed at runs on a fresh install, and the documents that point
  at examples name only those.

### A6 — Release the IDE extension

Syntax, diagnostics, formatting, source actions, go-to-definition, and references exist in
`packages/ide-extension` and are unreachable outside this checkout. Editor support is a large part
of whether a new language feels real.

- Shape: packaging, versioning, and publication to the VS Code Marketplace and Open VSX, with the
  extension resolving a `tao` from the user's machine rather than a repository path.
- Context: `packages/ide-extension`, the **Polish the IDE MVP** entry in `Roadmap.md`.
- Waits on: Ro creates the publisher accounts; the license decision (`R1`) applies here too.
- Done: `ext install` on a clean machine gives working Tao editing.

### A7 — Feedback intake

The point of the release is to learn what people want. Nothing collects that today.

- Shape: issue and discussion templates aimed at "I tried to build X and could not" and "this
  confused me"; `tao doctor --json` extended into a `tao bug-report` that attaches an environment
  fingerprint (OS, architecture, Tao version, toolchain hashes, Xcode version) so environment-shaped
  reports are diagnosable.
- Context: `packages/dev` doctor output, `.github/` (absent today).
- Waits on: the channel decision (`R10`) for where discussion happens; templates and the fingerprint
  do not wait.
- Done: a frustrated visitor has an obvious, low-effort place to say so, and what they send is
  enough to reproduce.
- Landed: `.github/` carries both issue forms, a discussion form for the open-ended half of each
  framing, and `CONTRIBUTING.md`; `EnvironmentFingerprint` in `packages/dev` reports OS,
  architecture, Tao commit, toolchain versions, toolchain and lockfile hashes, and Xcode where
  present, and `doctor --fingerprint` prints it alone. Nothing personal can reach it: each value is
  parsed out of a tool's output and kept only when it already reads as a version, a hash, or a plain
  word, which `environment-fingerprint.test.ts` proves on hostile probe output and on the real host.
- Remaining: the fingerprint is reachable only from a checkout of this repository, because `tao`
  has no `doctor`; `tao bug-report` is deliberately not built, so a visitor who installed a released
  binary has a form to fill but no fingerprint to attach. Revisit once `A2` gives the CLI a shape
  worth adding a command to. The discussion links point at the default `ideas` and `q-a` categories
  pending `R10`.

## Environment reach

Reducing what a developer's machine must already have. The prebuilt-host half of this work waits on
`R7`; the rest does not.

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
- Context: `packages/dev` doctor, `packages/tao-cli/cli-src/ship-*`, the environment discussion this
  roadmap came out of.
- Done: `tao run android` on a bare machine explains what it needs, asks, installs it, and works;
  nothing it installs requires `sudo` except the Xcode steps that inherently do.

### A9 — Prebuilt host apps for simulators and devices

Tao controls its entire native module set, so one prebuilt host per Tao version can run any Tao
app's bundle: install it on a simulator, emulator, or phone and point it at Metro. This removes the
native build from the development loop, which no virtualization approach can do.

- Shape: build and publish host artifacts (iOS simulator app, Android APK, and the companion app
  for physical iPhones) in Tao's own CI; `tao dev` downloads, installs, and launches the right one.
- Context: `packages/studio-companion-app` (Slice 1 and 2 records under
  `Docs/Roadmap/Tao Studio companion app/`), `packages/runtime-toolchain`.
- Waits on: `R7` — whether the host is the companion app itself, and how host versions relate to Tao
  versions.
- Done: a developer with no Xcode runs a Tao app on an Android emulator and on a physical iPhone.

### A10 — Publication hygiene audit

Whatever becomes public carries the agent instructions, Ro's roadmap notes, machine-specific files,
and a committed `secrets/secrets.jsonc`.

- Shape: inventory what would become public and what it reveals; confirm the committed secrets file
  is encrypted and that history holds nothing else; list machine-specific files (`local.properties`,
  named devices in package READMEs) and personal references.
- Context: the repository root, `.rulesync/`, `agents/`, `Roadmap.md`.
- Waits on: nothing for the audit; `R2` decides what to do with its findings.
- Done: Ro has one list of everything a public repository would expose, with a recommendation per
  entry.

## Language program

The `Docs/Roadmap/Tao Revolution/Process.md` sequence continues through the release; these are its
agent-executable steps.

### A11 — Process step 2: rewrite the Revolution tier

WordFlower's `4 - Revolution` re-expressed in the decided dialect, with the `Apps/Tao Future/` apps
as sibling references. Transcription against a settled decision record, with Ro reviewing the result.

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
forcing feature for every capability — four of them `none — for Ro`, which are red flags for step 4
rather than contrived features. What remains is not agent work: the ten spellings the port had to
choose where `Decisions.md` is silent are listed in `Apps/Tao Future/README.md`, and the one place
where `Decisions.md` still disagrees with itself (two visibility modifiers versus five) waits on Ro
as `R14`. Step 2's rewrite settled the other one this pass reported, retiring `TabNav` for
`SelectionNav`.

- Context: `Apps/Tao Future/README.md`, `Docs/Roadmap/Tao Revolution/Coverage.md`.

### A13 — Tranches from the Current ↔ MVP gap

Process step 5: one tranche at a time, each ending in behavior tests written in Tao, until Current
equals MVP.

- Waits on: step 4 (`R5`) must settle the authority-cluster scope before the tranche list is known;
  tranches touching the deferred runtime contracts wait on `R6`.
- Context: `Coverage.md`'s tier column, `Apps/WordFlower/README.md` tranche mechanics.

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

WordFlower's InstantDB datasource points at `localhost:9020`, which no tester's phone can reach, so
the sync demo cannot be shown to anyone outside this machine.

- Waits on: Ro provisions a hosted InstantDB application (`R11`); the wiring and configuration do not.
- Context: `Docs/Roadmap/Tao ship/Plan - Beta distribution in one command.md`,
  `Docs/Roadmap/InstantDB datasource provider/`.
