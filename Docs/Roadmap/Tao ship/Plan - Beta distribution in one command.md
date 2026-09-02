# Plan - Beta distribution in one command

Status: **plan with every decision settled** as of 2026-09-02; slice 1 is ready for an
implementation prompt. This plan cuts the first implementable slice out of `../Tao ship.md` — the exploration
that owns the whole ship program — and narrows it to one outcome: a developer runs one `tao`
command, and a beta tester installs the app on their phone. Nothing here is language law; where
it touches grammar it proposes and defers to `../Tao Revolution/Decisions.md`.

**Direction settled, 2026-09-02.** Two spellings, ruled by Ro:

```bash
tao ship <App>          # build and submit to the app stores, automating as much as possible
tao ship <App> --beta   # deliver to the project's invited members through the Tao Studio companion app
```

Plain `tao ship` is the store motion: iOS through App Store Connect, where TestFlight is the
store's own pre-release stage, and Android through Google Play. `--beta` is the companion app's
motion: the compiled bundle reaches the members a developer invited to the project on the Tao
Lang servers, with no store, no Apple account, and no native build in the path. The sections
below were written before that ruling; where they say TestFlight is "the beta channel", read it
as the store's pre-release stage, and where they describe an Expo Go bridge, that lane is
superseded by `--beta` and not built.

## The outcome

```bash
tao ship WordFlowerInstantDB
```

From a clean checkout, with the developer's own Expo and Apple accounts, that one command
compiles the variant in release mode, derives the native app configuration from the
declarations, builds a signed iOS binary in the cloud, uploads it to TestFlight, and prints the
state the developer needs next:

```text
Compiled WordFlowerInstantDB (release)                       2s
Built com.acme.wordflower.instantdb 1.0.0 (build 7)         14m
Submitted to TestFlight; Apple is processing the build      ~10m
Testers in the internal group are notified when it is ready.
Manage testers: https://appstoreconnect.apple.com/apps/<id>/testflight
```

The tester's experience: an email from TestFlight, one tap to install, the app under its own
icon and name. The second and later rounds get faster in the next slice: a compiled-bundle update
reaches the installed build in about a minute without a new binary or a store upload.

Android rides the same command with a flag, `tao ship WordFlowerInstantDB --android`, and ends
in an install link and QR code for an APK, because that path needs no store account at all.

## Why TestFlight plus an APK link, and not the alternatives

The research behind this section was done on 2026-09-01 against Expo's and Apple's current
documentation; the facts are in `Research - Beta distribution lanes.md` beside this file. The
lanes, from least to most ceremony:

| Lane                                   | Tester needs                                   | Developer needs                                  | Verdict                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------- | ---------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tao dev` + Expo Go on the LAN (today) | Expo Go, same Wi-Fi                            | nothing                                          | Not distribution. Stays the local dev loop.                                                                                                                                                                                                                                                                                                                                                     |
| EAS Update opened in Expo Go           | Expo Go, a free Expo account in the owning org | an Expo account, nothing from Apple              | **The only zero-Apple-account iOS lane, and a fragile one.** Since 2026-05-12 Expo Go loads updates only for projects the viewer's account or organization owns, so the friend joins the developer's Expo organization as a Viewer. The App Store Expo Go is SDK 54; Expo's SDK 55+ builds have waited on Apple's approval since spring 2026 with no timeline. Works while Tao stays on SDK 54. |
| EAS internal distribution (ad hoc)     | one-time device registration link, then a URL  | Apple Developer Program, Expo account            | **iOS fallback, Android default.** Every new iPhone costs a device registration and a rebuild; Apple caps registrations at 100 per membership year. Android is just an APK link.                                                                                                                                                                                                                |
| TestFlight                             | the TestFlight app; an invite or a public link | Apple Developer Program, Expo account            | **iOS default.** No device registration. Internal groups take up to 100 team members with no review; external groups take up to 10,000 with a one-time Beta App Review and a public link. Builds live 90 days.                                                                                                                                                                                  |
| Google Play internal testing           | a Play account, an opt-in link                 | Play Console (US$25 once, identity verification) | Later. Correct for a store-bound Android app; unnecessary ceremony for a first beta.                                                                                                                                                                                                                                                                                                            |
| Expo Launch (browser, no terminal)     | as TestFlight                                  | a public GitHub repo                             | Not a fit: Tao owns the command line, and the host is derived, not checked in.                                                                                                                                                                                                                                                                                                                  |

Who needs which account is worth stating plainly, because it is the question every beta tester
asks. On iOS the tester never needs a developer account: TestFlight needs the TestFlight app and
an Apple ID, Expo Go needs a free Expo account. The developer needs the paid Apple Developer
Program for every lane that installs a native binary on a remote phone, TestFlight and ad hoc
alike; the free personal team signs only cabled devices for seven days, the tester-side
sideloading tools re-sign weekly and need a computer, and the EU and Brazil alternative
distribution rules still require the program plus notarization. On Android an APK link needs no
account on either side today; Google's developer verification adds a free twenty-device
"limited distribution" account from August 2026, a US$25 full account, a regional deadline of
2026-09-30 in Brazil, Indonesia, Singapore, and Thailand, and a global rollout in 2027.

Two substrate facts make the single command cheap to build. First, the whole motion already
exists in EAS: `eas build --platform ios --submit` is what Expo's own `npx testflight` wraps, and
since eas-cli 14.6 through 22.0 that motion registers the bundle identifier, creates the App
Store Connect record, creates an internal TestFlight group, and invites the account's admins. Tao
does not reimplement any of that; it derives the inputs and drives the tool. Second, EAS Update's
runtime version can be a computed native fingerprint, which is exactly the "computed, not
hand-declared" compatibility gate `../Tao ship.md` wants, so the update slice inherits a working
mechanism instead of designing one.

The substrate ruling this plan assumes is the exploration's recommendation: EAS underneath,
the developer's own accounts, no Tao service in the path. Everything below is the mechanics of
that lane, and every mechanism is one a later Tao-managed front can reuse unchanged.

## Where things stand

- `tao compile` writes `_gen_tao-app/` into one checked-in Expo host, `packages/runtime-toolchain`,
  whose `app.json` names the app "Tao Runtime" and declares no bundle identifier, no version
  source, no updates client, no icon. There is no `eas.json` and no `expo-updates` dependency.
- `tao dev` starts Metro with `expo start --host lan` and opens Expo Go on simulators and connected
  phones. Physical iPhones therefore depend on the App Store Expo Go, which is SDK 54 today with
  newer SDKs stuck in Apple's review; the day Tao moves past SDK 54, the phone lane of `tao dev`
  needs a development build. The build this plan produces is that build's natural ancestor, so
  slice 4 folds the two together.
- WordFlower already declares what the command derives from: `project { id "wordflower" name
  "WordFlower" … }`, `app WordFlower { Name … Datasource DeviceStore }`, and the sync variant
  `app WordFlowerInstantDB = WordFlower with { Name "WordFlower - InstantDB" Datasource
  WordFlowerInstantDBStore }`. Its InstantDB datasource points at `localhost:9020`, so the first
  real beta needs a hosted Instant app id; the local stack is not reachable from a tester's phone.
- The compiler already has a `release` validation mode, exercised only by design tests. Nothing
  proves a release bundle carries no Studio machinery; the exploration names that proof as a ship
  requirement.
- The previous repository ran a development client on physical devices with `expo prebuild` and
  `expo run:ios --device`, and pinned `eas-cli` as a dependency. Its `app.json` is a usable
  reference for the fields the derived configuration must fill.
- The agent sandbox already allows egress to `expo.dev` hosts and writes to `~/.expo`, so an agent
  can run the cloud lane from a sandboxed shell. Apple's hosts are not on the allowlist, which only
  matters for `eas build --local`, where signing talks to Apple from the developer's machine.

## The design

### Command surface

`tao ship` is the working verb, matching the exploration; decision 1 below asks Ro to ratify it
against the `tao publish --app` placeholder and the `tao build --profile` recipes in
`Apps/WordFlower/3 - MVP/Justfile`. One positional argument, an app declaration name, resolved the
way `tao compile --app` and `tao dev --app` resolve one today.

```bash
tao ship <App> [path]            # build and submit to the stores: iOS via App Store Connect, Android via Google Play (slice 1)
tao ship <App> --beta            # compiled bundle to the project's invited members through the companion app (after the app exists)
tao ship <App> --update          # compiled-bundle update to installed store builds (slice 2)
tao ship <App> --invite <email>  # add a TestFlight tester (slice 3)
tao ship <App> --local           # same pipeline on this Mac through eas build --local (slice 4)
```

Flags stay few on purpose: beta, update, invite, local. Profiles, channels, credentials, and
identifiers are derived or remembered, never passed. Ro's ruling of 2026-09-02 settled the two
spellings at the top of this document; the plain command targets both stores, so the earlier
`--android` flag is gone and slice 1 covers Android as the Play internal track when a Play
account is configured, falling back to the APK link when none is.

### Derived, remembered, prompted

| Fact                                  | Source                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Display name                          | the variant's `Name`, else the project `name`                                                                                                           |
| Expo slug and EAS project link        | `project { id }` plus the variant name, e.g. `wordflower-instantdb`; the EAS project id is remembered after `eas init` links it                         |
| Bundle identifier and Android package | a remembered reverse-DNS namespace plus the project id, plus the variant suffix — `com.acme.wordflower.instantdb` (decision 2)                          |
| Version                               | remembered per project, prompted once with a default of `1.0.0`; build numbers auto-increment on EAS (`appVersionSource: remote`)                       |
| Update channel and runtime version    | the variant name and the computed native fingerprint (slice 2)                                                                                          |
| Icon and splash                       | a Tao default asset until an `Icon` slot exists (decision 4); variants that are not the primary app get a badged default                                |
| Device families and orientation       | `project { targets }` once the grammar implements it; until then phone plus tablet                                                                      |
| Usage strings                         | none in slice 1; the compiled module graph shows which capability sidecars are reachable, and the derivation waits on the permissions spelling decision |
| Signing, provisioning, ASC API key    | EAS-managed credentials under the developer's Apple account; created on first run, never stored by Tao                                                  |
| Expo login                            | `eas login` on first run or `EXPO_TOKEN`; EAS's own state, never stored by Tao                                                                          |

The remembered facts are secret-free accepted project metadata and live in the project's
`.tao-project/` folder as the `ship` section of the committed `lock.jsonc`, keyed by variant and
written by `tao ship`, never by hand; _Precedent: accepted project metadata_ below gives the contract it
follows. `tao ship` fills it on the first run from its prompts and reads it afterwards, so a
fresh clone ships without prompting. The exploration's `config` resolution channel reads the
same lock when that seam settles. The file never holds a credential; the Apple, Expo, and
hosted-Instant secrets stay in the substrate's stores.

### The run, step by step

1. **Preflight.** A doctor-shaped check, pure and reported before anything mutates: `eas-cli`
   resolvable, an Expo login, the app name resolves to one declaration, `project { id, name }`
   present, the remembered facts complete, and for the InstantDB variant a non-localhost `ApiURI`.
   Every miss is a `UserInputError` or `HostEnvironmentError` with the exact fix; in an
   interactive terminal the missing remembered facts are prompted and written.
2. **Release compile.** `Runtime.generateApp` with `validationMode: 'release'` and no Studio
   preview, into the host's `_gen_tao-app/` as today, plus a generated `_gen_tao-app/ship.json`
   carrying the derived configuration.
3. **Derived host configuration.** The checked-in host gains an `app.config.js` that reads
   `ship.json` when present and falls back to today's "Tao Runtime" values when absent, so `tao
   dev` and every existing test see no change. `eas.json` is generated beside it with three
   profiles: `preview` (internal distribution, APK on Android), `production` (store build,
   auto-submit, remote version source), and later `development` (slice 4).
4. **Bundle proof.** `expo export` of the release bundle, then an assertion that no Studio module
   marker appears in it. This is the missing production-bundle assertion the exploration calls
   for, and it runs before any minute of paid build time is spent.
5. **Build and submit.** `eas build --platform ios --profile production --submit --non-interactive
   --json` through the shared `CLI.run`, with output streamed in the dev loop's prefixed style.
   The JSON result carries the build id, artifact URL, and submission state that the summary
   prints. `--android` runs the `preview` profile without submission and prints the artifact URL
   and a terminal QR code.
6. **Summary.** The block shown under _The outcome_, plus the App Store Connect TestFlight URL.
   The command exits non-zero on any failed stage with the substrate's own message quoted, never
   paraphrased.

Two upload details decide whether step 5 works at all and are worth stating here so the slice
does not rediscover them. EAS uploads the project through its git client by default, which skips
ignored files, and `_gen_*` is ignored; the ship command runs EAS in no-VCS mode with a generated
`.easignore` that excludes `node_modules`, `.artifacts`, Studio, and every package the host does
not import. And the host resolves `@runtime/TR` and `@shared/core` through Metro aliases into
sibling packages, so the upload root is the repository, the install is the root `bun install`,
and the build runs from `packages/runtime-toolchain`; EAS detects Bun from `bun.lock`.

### Cost and time per round

| Round                                  | Wall clock                                       | Plan cost                                               |
| -------------------------------------- | ------------------------------------------------ | ------------------------------------------------------- |
| First binary to TestFlight             | cloud build 10–20 min, Apple processing 5–30 min | 1 of 15 free iOS builds per month, low-priority queue   |
| Android APK link                       | cloud build 5–15 min                             | 1 of 15 free Android builds per month                   |
| Update to an installed build (slice 2) | about a minute, picked up on next launch         | free to 1,000 monthly active users                      |
| Local build on this Mac (slice 4)      | as fast as Xcode                                 | no build quota; needs Xcode, fastlane, and Apple egress |

The update round is the one a beta tester's feedback loop actually runs on, which is why slice 2
follows slice 1 immediately rather than waiting for the migration program.

## Slices

Each slice lands per the repository's ordinary definition of done: focused tests while working,
`./agent verify` green, and a recorded live acceptance in this document, in the style of the
InstantDB provider's _Live acceptance_ section. No slice needs a WordFlower tranche: none adds
grammar. The one spot that would — `project { targets }`, `version`, `Icon` — is deferred to
decisions 2 and 4 and can be pulled into a tranche independently.

### Slice 0 — retired

An Expo Go bridge was planned here for the zero-account case. Ro's ruling of 2026-09-02 gives
that case to `tao ship --beta` through the companion app instead, so the bridge is not built.
The account walkthrough it carried is preserved in `Research - Beta distribution lanes.md`.

### Slice 1 — `tao ship <App>` to TestFlight, and `--android` to an APK link

Scope: the command, preflight, remembered facts, derived host configuration, generated `eas.json`
and `.easignore`, release compile, the bundle proof, the EAS wrapper, and the summary. The
InstantDB variant ships against a hosted Instant app whose id is provided through the remembered
facts rather than edited into source.

Tests, in `packages/tao-cli/cli-tests/ship-command.test.ts` and the toolchain suite:

- Derivation is pure and tested by table: declaration in, `ship.json` out, including the name and
  identifier rules for primary apps versus variants.
- The EAS driver takes an injected command runner; tests assert the exact `eas` argument vectors
  and parse recorded `--json` outputs for the summary, so no test touches the network.
- The bundle proof runs as a slow lane beside the Studio smokes, exporting the WordFlower release
  bundle and asserting the Studio marker is absent; a deliberate preview compile is the positive
  control.
- Preflight tests cover every miss and its message, interactive and non-interactive.

Live acceptance: from a fresh clone, `tao ship WordFlowerInstantDB` installs on Ro's phone from
TestFlight and documents sync through the hosted Instant app; `tao ship WordFlowerInstantDB
--android` yields a link a second phone installs. Act 1 of the exploration's driving use case.

### Slice 2 — `--update`

Scope: `expo-updates` in the host, `updates.url` and the fingerprint runtime-version policy in the
derived configuration, a channel per variant baked into the `production` and `preview` profiles,
`eas update --channel <variant>` with the release bundle, and rollback as `eas update:republish`.
The summary states whether the update is compatible with the installed builds: same fingerprint
means it lands, a changed fingerprint means a new binary is required and the command says so
instead of publishing an update nothing will load.

Tests: the fingerprint is computed from the host and asserted stable across a copy-only change and
changed by a new native dependency; the driver tests extend to the update and republish vectors.

Live acceptance: a one-line copy change reaches the phone from slice 1 on next launch with no
build. Act 2 of the driving use case. The exploration's schema gate stays out of this slice; a
`data` change today is refused by the runtime envelope on device, and `--update` should say so in
preflight rather than let the migration program's problem surface as a bricked beta.

### Slice 3 — testers

Scope: `--invite <email>` adds a tester to the variant's TestFlight group through the App Store
Connect API with the key EAS already created; an external group with a public link and the
one-time Beta App Review submission for testers outside the team; TestFlight feedback surfaced
through `eas testflight:feedback` in a summary line. Android gains an optional Play internal
testing track through `eas submit --platform android` for projects that have a Play account.

### Slice 4 — one host for dev and ship

Scope: a `development` profile with `expo-dev-client`, so the same derived host is the phone lane
of `tao dev` once Tao leaves SDK 54 and the App Store Expo Go behind; `--local` through `eas build
--local` for developers who prefer their own Mac and no build quota; and the internal-distribution
iOS lane with `eas device:create` for the rare tester who will not use TestFlight. This is also
where an EAS Workflow file becomes an option: one `.eas/workflows/ship.yml` chaining fingerprint,
conditional build, submit, and update, run by `eas workflow:run`, is the substrate's own version
of this command and a candidate replacement for the driver once Workflows minutes are in budget.

### Handoff

Slices 3 through 6 of `../Tao ship.md` — schema fingerprint and the additive class, the deploy
configuration channel, hosted provisioning — pick up from here unchanged. Slice 1 and 2 here are
the exploration's slices 1 and 2 made concrete.

## Decisions for Ro

Each has a recommended default so slice 1 can start on the ruling alone.

1. **The verb.** Settled on 2026-09-02: `tao ship` for the app motion, with `--beta` for the
   companion app. `tao publish` stays the package registry's verb. The MVP Justfile's
   `tao build --profile` recipes and the Tao Future Justfiles' `build` and `publish` recipes are
   replaced by `tao ship` recipes.
2. **Where the identifier facts live.** Settled on 2026-09-02, after the search Ro asked for;
   see _Precedent: accepted project metadata_ below. The ship facts are accepted project metadata
   in the project's `.tao-project/` folder: the `ship` section of one committed `lock.jsonc`,
   written by `tao ship` and never hand-edited, with the bundle identifier rule
   `<namespace>.<project id>[.<variant>]`. Ro's follow-up ruling the same day: one lock file for
   the whole project, sectioned, rather than one file per concern with a shared envelope.
   A `bundle` or `version` fact in the `project` block stays a possible later grammar addition
   for the one or two values a developer authors rather than accepts.
3. **Variants and store records.** Settled on 2026-09-02: a non-primary variant is its own bundle
   identifier and App Store Connect record, a distinct channel and persisted-state identity as §10
   already gives it.
4. **The icon.** Settled on 2026-09-02: a Tao default asset and a badged variant default now; an
   `Icon` slot on `app` is argued separately as a grammar addition.
5. **The Expo Go bridge.** Settled on 2026-09-02: not built; `tao ship --beta` through the
   companion app covers the zero-account case.
6. **The Tao Studio companion app.** Settled on 2026-09-02: build it, for the development
   experience first and for pre-release testing by invited project members with Tao Lang
   accounts. See _The Tao Studio companion app_.

## Precedent: accepted project metadata

Ro recalled an earlier specification of a per-project metadata directory full of Tao-generated
data that nobody edits by hand, introduced partly for automatic AI design decisions. The search
on 2026-09-02 found it in three places, and together they say what decision 2 should be.

- **The old repository's design lock**, in `Docs/Tao Language Design/UI Design Inference
  Specification.md` (§10 and §11) and `packages/compiler/compiler-src/design/design-lock.ts`,
  with committed examples under its test apps. Two files: `tao.design.lock`, the accepted design
  metadata production builds read, and a hidden `.tao.design.lock`, a full copy plus the
  suggestions dev mode generates and previews but production ignores. Every entry carries an
  identity, an input hash for staleness computed from design inputs only, an `accepted` or
  `suggested` status, the semantic and resolved payloads, and provenance with the pinned analyzer,
  model, and profile versions, so an analyzer upgrade never stales accepted entries by itself.
  Explicit source wins over the lock, the accepted lock wins over defaults, and a production
  build fails when an accepted entry is stale or missing. Accepting is one operation that
  promotes the hidden file over the committed one. The later "Look Great By Default" plan on the
  old repository's `app/meny-proto` branch grew the same lock with a template selection and a
  schema version bump, and gave it `tao design update` and `--reroll` commands.
- **This repository's design-system plan**, `Docs/Roadmap/Add Tao design system MVP/Design
  tooling and rollout.md`, carries the same idea as a lockfile sketch: a theme with generation
  provenance and an acceptance time, an app fingerprint, generated tokens and recipes marked
  `locked` or `modifiedByUser`, per-screen render hashes and baselines, and an AI section whose
  `maxEditScope` bounds what generation may touch. Its rules are the useful ones: never rewrite a
  user-locked value, keep generated changes explainable, prefer edits at the token and recipe
  level.
- **This repository's packages spec**, `Docs/Spec/Tao Packages.md`, already names the directory:
  `.tao-project/` at the project root, holding `installs/`, `installs-lock.jsonc`, `cache/`, "and
  more". The ship exploration's deploy-configuration sketch points at the same folder for the
  fully-local lane.

What the precedent settles for ship. The identifier facts are exactly this category of data:
Tao derives or accepts them once, production builds read them, nobody types them into source,
and a stale or missing entry must fail the build rather than ship something wrong. So they
belong in `.tao-project/`, not in a bespoke file beside the entry declaration, and they follow
the design lock's contract rather than inventing one:

- `.tao-project/lock.jsonc` is the project's one Tao-written lock, committed, with a top-level
  section per concern. `tao ship` owns the `ship` section: per app variant, the bundle
  identifier and Android package, the EAS project link, the version, the update channel and
  runtime fingerprint, and provenance, which `tao ship` version wrote each entry and when. Every
  entry has an identity, an input hash over the declarations it was derived from, and a status.
- Prompted values arrive as `suggested` and are promoted to `accepted` by the same run that
  confirms them, which is the accept operation the design lock defined; `tao ship` refuses to
  build from a suggested or stale entry. Slice 1 may keep suggestions in memory rather than in a
  hidden sibling file; the sibling is the design lock's answer for suggestions that outlive a run.
- Secrets never enter the folder. Credentials stay in the substrate's stores, as this plan
  already says; the exploration's `config` resolution for provider ids reads the same lock.
- The ship-held schema history the exploration wants for the migration gate is the same kind of
  record and takes its own section when that slice lands; the design lock and the installs lock,
  both unimplemented today, take sections of the same file when they arrive. That dissolves the
  question of a shared envelope across files: there is one file, and the first section written
  sets the entry shape the others reuse.

## The Tao Studio companion app

**Direction settled, 2026-09-02.** Ro decided to create a Tao Studio companion app. It exists
for an improved development experience first, paired with Tao Studio while developing, and
also for pre-release testing and feedback by members a developer has invited to their project
on the Tao Lang servers, where every member must have created an account. The sections below
are the assessment that preceded the decision and the design rules it carries; the program
itself is opened in `Roadmap.md`.

The original proposal: an iOS app published by Tao, paired with Tao Studio while developing,
whose first job is to put a build of your own Tao app on your phone without a native install,
and whose second job is collaboration: invite people to your Tao project, and anyone with the
app can accept the invitation, join the project, and run the app for beta testing. The key is
that the app carries real value for developing Tao apps; joining others' projects is an
additional feature.

**Could it work?** Yes, and it converges three things the repository already wants. It is Expo Go
with Tao's runtime baked in: one fixed native binary holding the Tao runtime, the curated device
kit, and Expo's module set, loading compiled bundles of projects the signed-in account belongs
to. It is the native-device Studio canvas the Studio v1 exploration already designed, whose
first verdict was "Expo development build on the LAN, adopt": pairing, the control plane, cell
assignment, and source actions all ride the same binary. And it removes the SDK 54 dependence
of the Expo Go bridge, because Tao ships its own shell and updates it on its own schedule. The
Studio pairing, the LAN and tunnel development-server lanes, and the compiled-bundle update
lane all reuse what slices 1 and 2 build; the new pieces are the shell itself, project
membership, and the invitation flow.

**Does it make sense?** As a developer's tool, strongly. A Tao developer today needs the App
Store Expo Go on their phone, and Expo has been unable to ship a new one since spring. The Tao
app is the phone lane of `tao dev` and of Studio, under Tao's control, and it is where the
on-device visual edit mode lives if that ever ships. As a beta channel it is the Expo Go model
exactly: the tester installs the Tao app, accepts a project invitation, and runs the app inside
Tao's shell with no Apple account on either side. It is not a replacement for TestFlight when
the beta is a store rehearsal: the app runs under Tao's icon and name, not its own.

**Would it be allowed?** The research in `Research - Beta distribution lanes.md` says yes for the
shape described, with two cautions:

- **The surviving pattern is a signed-in developer tool that loads only projects the account
  belongs to.** Expo Go, Thunkable Live, Draftbit Preview, and Bravo Vision are all on the App
  Store today in that shape, and Expo Go's rule since May 2026 is literally project ownership
  or organization membership. Project membership by invitation is that rule. On-device editing
  has precedent in Play, Codea, and Swift Playgrounds, and compiled JavaScript executed by the
  platform's engine is what the program license agreement permits.
- **The line Apple enforced in March 2026 is distribution to the public.** Replit, Vibecode, and
  Anything were struck under guideline 2.5.2 for putting user-made apps on other people's phones
  and marketing themselves as app makers. The Tao app must never offer a public link, a store
  inside the app, or "share to anyone"; membership stays explicit, revocable, and framed as
  collaboration on a project. Framing and behavior matter as much as the mechanism: the app's
  listing describes a development tool, and the first screen is the developer's own projects.
- **The review queue is the operational risk.** Expo Go's SDK 55 and later builds have waited
  on Apple since spring 2026 with no cause published. A Tao app inherits that uncertainty: one
  Apple account, one review queue, and a shell every Tao developer's phone lane depends on.
  The mitigation Expo used is available to Tao too: distribute the shell to developers through
  TestFlight's external group and public link, up to ten thousand testers, while App Store
  review runs, and keep the native surface stable so the shell needs few releases.

**Design rules the decision carries.** Projects and membership on the Tao Lang servers as the
only access model, with an account required of every member; no public sharing surface of any
kind; compiled bundles only, never a compilation path on the device, matching the repository's
standing production posture; the Studio native-device canvas as the first customer; and a
shell release cadence that is rare and deliberate. The program needs slices 1 and 2 here, the
derived host and the compiled-bundle update lane, and sequences after them.

## Limits recorded honestly

- iOS requires the developer's paid Apple Developer Program membership and a first interactive
  Apple login with two-factor authentication, once; no design removes either.
- Cloud builds on the free plan queue at low priority; a slow day can push the first round past an
  hour. `--local` exists for that reason.
- Internal TestFlight testers must be App Store Connect team members; a friend who is not one is
  an external tester, and external testers wait on a one-time Beta App Review per version.
- An APK link works for a friend anywhere today, but Google's developer verification reaches
  four countries on 2026-09-30 and every certified device in 2027; from then the developer needs
  at least the free limited-distribution account, and Google's own pages disagree on whether
  direct APK installs in the four pilot countries are blocked at the regional deadline.
- Any `data` change between rounds still refuses every existing snapshot until the migration
  program lands. Slice 2's preflight must say so.
- `tao ship` in slice 1 runs from this repository, as `tao dev` does today; a Tao user's own
  project outside the repository is a later concern of the toolchain packaging, not of this plan.
