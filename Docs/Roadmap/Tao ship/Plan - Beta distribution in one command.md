# Plan - Beta distribution in one command

Status: **implemented software contract, reconciled 2026-09-16**. The dated research and original
slice proposals remain below to preserve how the direction was chosen; this status and _Command
surface_ describe what landed. External App Store/TestFlight success, an installed OTA, signed or
notarized Studio, and physical-device acceptance have not been established by repository tests.

**Direction settled, 2026-09-02.** Two spellings, ruled by Ro:

```bash
tao ship            # build locally, upload, and submit to App Store review, automating as much as possible
tao ship --beta     # the same build to TestFlight, with the recipients who should receive it
```

Over the day the ruling was refined three times; _Command surface_ below is authoritative. Plain
`tao ship` is the App Store motion and `--beta` is TestFlight. Shipping is filesystem-only: it
may inspect Git for provenance, but never stages, commits, tags, or pushes. Android and Expo/EAS
publishing are out of scope. The EAS and Android analysis below is historical research, not the
current implementation.

## The outcome

```bash
tao ship . --app WordFlowerInstantDB
```

With the developer's Apple prerequisites, that command compiles the variant in release mode,
derives native configuration from source and the project lock, builds a signed iOS binary locally
through Xcode, uploads it to App Store Connect/TestFlight, and prints the
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

The original Android/APK proposal did not land and remains out of scope.

## Historical research — TestFlight, APK, and alternative lanes

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

This comparison predates the local-Xcode ruling. EAS was not adopted; the implemented binary lane
uses local Xcode and App Store Connect, while OTA uses Tao's Expo-protocol update service.

## Where things stand

- `tao ship` implements release compilation, the no-Studio bundle proof, local Expo prebuild and
  Xcode archive/export, resumable App Store Connect/TestFlight lifecycle, and Tao-hosted OTA publish
  and compatible rollback.
- The command is serialized per repository and filesystem-only. It atomically writes the authored
  project version and the `ship` concern of `.tao-project/lock.jsonc`, while preserving concurrent
  lock concerns, the Git index, refs, and commit history byte-for-byte.
- Release provenance records the exact HEAD and dirty-tree fingerprint without requiring a clean
  checkout. Build numbers are monotonic over local and remote history.
- Runtime compatibility combines the native fingerprint used as the Expo runtime version with a
  canonical semantic data-schema fingerprint. Publication and rollback must be compatible with
  every supported binary; assets are exported and published as resolvable Expo artifacts.
- `tao dev` starts Metro with `expo start --host lan` and opens Expo Go on simulators and connected
  phones. Tao moved to Expo SDK 57 on 2026-09-15, so the physical-iPhone lane can no longer depend
  on the App Store's SDK 54 Expo Go; it now needs a development build. The build this plan produces
  is that build's natural ancestor, so slice 4 folds the two together.
- WordFlower already declares what the command derives from: `project { id "wordflower" name
  "WordFlower" … }`, `app WordFlower { Name … Datasource DeviceStore }`, and the sync variant
  `app WordFlowerInstantDB = WordFlower with { Name "WordFlower - InstantDB" Datasource
  WordFlowerInstantDBStore }`. Its InstantDB datasource points at `localhost:9020`, so the first
  real beta needs a hosted Instant app id; the local stack is not reachable from a tester's phone.
- The release bundle proof rejects Studio markers before native packaging.
- The previous repository ran a development client on physical devices with `expo prebuild` and
  `expo run:ios --device`, and pinned `eas-cli` as a dependency. Its `app.json` is a usable
  reference for the fields the derived configuration must fill.
- Repository tests prove orchestration and artifacts with injected clients. They do not prove a
  real App Store submission, TestFlight install, installed-binary OTA, or signed/notarized Studio.

## The design

### Command surface

**Settled by Ro on 2026-09-02**, in three refinements, superseding the earlier sketch:

```bash
tao ship [path] [--app NAME] [--patch | --minor | --major] [--yes] [--ignore-git] [--dry-run]   # App Store
tao ship [path] ... --beta[=a@example.com,b@example.com]                                        # TestFlight
tao ship [path] ... --update [--rollback]                                                        # compatible OTA
```

- **Project discovery.** `path` defaults to the current directory; `tao ship` climbs from there
  until it finds the Tao project root.
- **App selection.** `--app NAME` names the app declaration. Without it, the project's new
  `DefaultApp` field selects the app. Without either, the command prints every candidate app and
  asks the developer to choose.
- **Version.** The project declaration carries the project's semver, the version under
  development, and Apple sees it as the marketing version. A version is _consumed_ once a build
  of it has been submitted for App Store review. `tao ship` bumps only when it is about to build
  a consumed version: `--patch` by default, `--minor` or `--major` on request, or any of the
  three to force a bump of an unconsumed version. A `--beta` build of an unconsumed version
  never bumps, and neither does the first store submission of one, which is what makes a tested
  beta and the store release the same version. Every build gets a distinct build number, a UTC
  timestamp-derived floor made monotonic against every locally or remotely observed build number.
  The bump is written into source and the lock is updated atomically. The command never stages,
  commits, tags, or pushes. Every build embeds the exact HEAD plus clean/dirty provenance and a
  dirty-content fingerprint so a tester's report maps back to the bytes built. A dirty tree is
  rejected by default; `--ignore-git` permits it without weakening or hiding that provenance.
- **Ship what was tested.** When the current version already has a processed TestFlight build
  whose embedded commit is the working tree's commit, plain `tao ship` submits that build for
  review instead of building again; the action list says so. A dirty TestFlight artifact is never
  eligible for App Store promotion.
- **After the upload.** Apple processes a build for minutes before it can join a TestFlight
  group or a review submission. The command waits with progress by default, `--no-wait` returns
  at once, and every step is recorded in the lock so a rerun resumes where it stopped rather
  than uploading twice. TestFlight's "What to Test" text uses explicit `--notes` when provided
  and otherwise derives bounded notes from recorded release provenance. Drafts and partially
  completed submissions resume; a terminally failed or invalid build is rejected, not polled into
  apparent success.
- **Precursors, automated where possible.** Every step that needs the developer, such as the
  Apple membership, the App Store Connect API key, or the app record, is
  handled in order: automated when Apple's tooling allows, and otherwise the command states
  exactly what to do, with the URL, and waits for a keypress once it is done. Nothing ships until
  every precursor is satisfied. _What the developer provides_ below is that list.
- **The action list and the gate.** With precursors done, the command prints the actions it will
  take, in order: source/lock writes, prebuild, archive, upload, and either the
  App Store review submission or the TestFlight distribution. Unless `--yes` was passed, it asks
  whether to proceed, Y/n. `--dry-run` stops after the list, so the whole command up to the gate
  is exercised at no cost; implement it first and test against it.
- **Plain `tao ship`** uploads the build to App Store Connect, creates or reuses the App Store
  version for the bumped semver, attaches the build, and submits it for App Store review.
- **`--beta`** uploads the same build and distributes it through TestFlight instead. Recipients
  are email addresses: an address belonging to a member of the App Store Connect team joins the
  project's internal group and receives the build with no review; any other address joins the
  project's external group, which Apple reviews once per version before the first build reaches
  it. Both groups are created on demand and remembered by id in the lock; recipients given once
  are remembered on Apple's side, so a bare `--beta` re-ships to the groups as they stand. The
  command prints who will be notified as part of the action list. Recipient addresses are not
  written into the lock.
- **Dropped:** Android until Ro reopens it, and Expo entirely, ruled on 2026-09-02: no Expo
  publishing, no EAS build lane, no EAS Update. Publishing through Expo would reach only members
  of an Expo organization, only inside the Expo Go shell, and only while Tao stays on the SDK the
  App Store Expo Go carries, which Expo has been unable to move past since spring; TestFlight
  with recipients covers the need. Slice 2's update server is therefore Tao's own, on the Tao
  Lang servers the companion app needs anyway, speaking the open expo-updates protocol the
  runtime client already implements.
- **`--update` and `--rollback`.** An update publishes a real Expo bundle and resolvable assets only
  when its native runtime and canonical semantic schema are compatible with every supported binary.
  Rollback walks compatible publication history and republishes an earlier artifact; it never jumps
  outside that compatibility set.

Flags stay few on purpose. Profiles, credentials, and identifiers are derived or remembered,
never passed.

### Build lane: local first

Ro prefers building on the developer's own Mac, and the research supports it. A paid Apple
Developer Program membership and an Expo account are different things: Apple owns signing, App
Store Connect, and TestFlight; Expo's EAS is a separate cloud service for builds, submission,
and updates, with its own account and quota. Nothing in slice 1 needs EAS.

The local pipeline, all Apple-owned tooling, runs on the derived host:

1. `expo prebuild` generates the Xcode project from the derived app configuration; it is the
   Expo CLI from the repository's dependencies and needs no account.
2. `xcodebuild archive` with `-allowProvisioningUpdates` and the App Store Connect API key
   (`-authenticationKeyPath`, `-authenticationKeyID`, `-authenticationKeyIssuerID`) lets Xcode
   register the bundle identifier and create or refresh the signing certificate and provisioning
   profile itself, with no Apple ID sign-in and no two-factor prompt. Xcode 13 introduced the
   flags; the key must be an Admin team key, since App Manager keys cannot reach Certificates,
   Identifiers & Profiles.
3. `xcodebuild -exportArchive` with an export options plist whose `method` is `app-store-connect`
   and whose `destination` is `upload` signs the archive and uploads it to App Store Connect in
   one step with the same key. Xcode 15 or later is required: Xcode 14 accepted the key for
   signing only. Neither `altool`, rewritten and deprecated for uploads in Xcode 26, nor
   Transporter is involved. The derived configuration includes an export-compliance declaration
   only when source/configuration proves it; unknown status is omitted rather than falsely declared
   exempt, so Apple may require the developer to answer the question.
4. The App Store Connect API, called with the same key, does what Xcode does not: create the
   App Store version and submit it for review, create the TestFlight groups, add testers, assign
   the build, and invite people to the team. A small typed client over the handful of endpoints
   is the plan; the community `asc` CLI (`brew install asc`, key-authenticated, actively
   released) is the reference and fallback for the same calls. The one thing Apple's public API
   refuses is creating the app record, in Apple's own words: "Don't use this API to create new
   apps; instead, create new apps on the App Store Connect website." The tools that do it
   drive Apple's private web session with an Apple ID and two-factor code, and break every time
   Apple changes that flow, so the command dictates the New App form with its values and waits,
   once per app.

What EAS would have given, for the record: macOS builders for machines without Xcode and for
agents; managed credential custody; a maintained pipeline that tracks Expo SDK versions; a
submission service; and EAS Update as a server for compiled-bundle updates. It is not faster
than a warm Apple-silicon Mac, and its free tier meters builds. Local builds are unlimited and
offline from everything but Apple. Ro ruled Expo out entirely on 2026-09-02. The library that
exists for this automation is fastlane, whose `match`, `gym`, `pilot`, and `deliver` cover the
same four steps in Ruby over Apple's private session where the public API stops. Slice 1 uses
the Apple tooling directly because the four steps are short and typed, and keeps fastlane as
the documented fallback if a step proves brittle. Slice 2's update server is Tao's own, on the
Tao Lang servers.

### What the developer provides

Researched on 2026-09-02 against Apple's documentation and the tooling that exists; sources are
in `Research - Beta distribution lanes.md`. The table says what a local CLI can do unattended
and where a human remains.

| Prerequisite                          | Unattended?    | How                                                                                                          | Human step, and how often                                                                                             |
| ------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Developer Program membership          | No             | none exists; enrollment is a web or Apple Developer app flow with identity verification and payment          | once ever; yearly renewal unless auto-renew is on                                                                     |
| Team ID                               | Yes            | `seedId` of any bundle identifier from `GET /v1/bundleIds`, or the `OU` of a signing certificate in Keychain | none; the tool derives it                                                                                             |
| Membership still active               | Heuristic      | a provisioning endpoint answers 403 with an agreements error when the license has lapsed                     | none                                                                                                                  |
| Program License Agreement accepted    | No             | Apple revises it a few times a year; keys cannot be created and provisioning calls fail until it is accepted | the Account Holder accepts it at developer.apple.com/account or appstoreconnect.apple.com/business, once per revision |
| App Store Connect API key             | No             | no public endpoint creates team keys; nothing in fastlane does either                                        | once per team: an Admin generates and downloads it                                                                    |
| Xcode installed                       | Partly         | `xcodes install --latest` or `mas install 497799835`                                                         | Apple ID with a two-factor code, or an App Store sign-in in the GUI, once per machine; `sudo`                         |
| Xcode license, first launch, platform | Yes            | `sudo xcodebuild -license accept`, `sudo xcodebuild -runFirstLaunch`, `xcodebuild -downloadPlatform iOS`     | the `sudo` password unless sudoers allows it; once per Xcode version                                                  |
| Bundle identifier                     | Yes            | `xcodebuild -allowProvisioningUpdates` with the key, or `POST /v1/bundleIds`                                 | none                                                                                                                  |
| Signing certificate and profile       | Yes            | the same `xcodebuild` flags                                                                                  | none                                                                                                                  |
| App record                            | No             | public API refuses; private-session tools are fragile                                                        | the New App form, once per app                                                                                        |
| Archive and upload                    | Yes, Xcode 15+ | `xcodebuild -exportArchive` with `destination: upload` and the key                                           | none                                                                                                                  |
| A person on the team                  | Yes, to send   | `POST /v1/userInvitations` with an Admin key                                                                 | the invitee clicks the activation link, once                                                                          |
| TestFlight groups and testers         | Yes            | `POST /v1/betaGroups`, `POST /v1/betaTesters`, `POST /v1/betaAppReviewSubmissions` for external groups       | a tester accepts the TestFlight invitation, once; Apple's beta review wait for externals                              |
| Export compliance                     | Only if proven | include the declaration only from authoritative project facts                                                | answer in App Store Connect when Tao cannot prove status                                                              |

So the developer provides three things, once per team, and one thing per app; `tao ship`
derives, creates, or dictates everything else.

1. **Apple Developer Program membership**, paid and active, at
   https://developer.apple.com/account. The tool derives the Team ID itself once a bundle
   identifier or certificate exists, which the first run creates.
2. **An App Store Connect API team key with the Admin role**, created at
   https://appstoreconnect.apple.com/access/integrations/api under Team Keys by an Admin or the
   Account Holder. Admin is required: App Manager keys cannot reach Certificates, Identifiers &
   Profiles, and only Admin keys can invite people to the team. Download the `.p8` once, note the
   Key ID shown beside it and the Issuer ID shown above the table, and place the file at
   `~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8`, where Apple's tools search by default.
   The tool records only the Key ID and Issuer ID in the lock, never the key. The agent sandbox
   can read the home directory except for `.ssh`, `.aws`, and `.config/gh`, so sandboxed runs
   sign.
3. **Xcode 15 or later**, with its license accepted and the iOS platform downloaded. The tool
   checks and prints the exact commands when anything is missing; installing Xcode itself needs
   an Apple ID or an App Store sign-in once per machine and `sudo`, which no tool removes.
4. **The App Store Connect app record**, once per app, at https://appstoreconnect.apple.com/apps
   with New App: platform iOS, the name, the bundle identifier the tool derived and printed, a
   primary language, and any SKU. `tao ship` states this precursor with those values and waits
   for a keypress.

Two further items are automated by the tool rather than provided: the developer's own Apple ID
on the App Store Connect team, which `tao ship` can invite through the API, though the
developer still clicks the activation email; and the hosted InstantDB app for the
WordFlowerInstantDB acceptance run. For that run Ro provided the app id
`9faf89c0-c15c-49b4-bf3f-3b5b2cd9a19f` on 2026-09-02 and allows the implementer any action on
it, including deleting its data. It is the id the repository already seeds into the local
InstantDB stack, so the implementer first confirms it exists on the hosted service at
https://www.instantdb.com/dash and otherwise creates a hosted app and records that id in the
lock; a phone on TestFlight cannot reach `localhost:9020`. Not needed at all: an Expo account.

Xcode cannot create the App Store Connect API key: keys exist only on the App Store Connect
website, under Users and Access, Integrations, Team Keys, and an Admin makes them. Xcode's own
Apple ID sign-in would cover signing and upload, since `xcodebuild -allowProvisioningUpdates`
and the upload-on-export use Xcode's account session when no key is given, but the TestFlight
groups, testers, and review submission are API calls that only a key authorizes, so the key is
the one credential the tool needs.

### The run, step by step

1. **Preflight.** A doctor-shaped check, pure and reported before anything mutates: Xcode 15 or
   later with its license accepted and the iOS platform present, the App Store Connect API key
   file at its conventional path with the Key ID and Issuer ID in the lock, the Program License
   Agreement accepted (Apple's 403 `REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED`, and the "API Keys
   cannot be created due to an invalid Program License Agreement" message seen on 2026-09-02, are
   this precursor, named with the two URLs where the Account Holder accepts it), the app name
   resolving to one declaration, `project { id, name, version }` present, the lock's accepted
   identifiers complete, exact Git/dirty provenance when a repository exists, and for the InstantDB variant a
   non-localhost `ApiURI`. Every miss is a `UserInputError` or `HostEnvironmentError` with the
   exact fix; in an interactive terminal the missing accepted identifiers are prompted and
   written, and each dictated precursor waits for a keypress.
2. **Version and provenance.** Decide whether the version is consumed and bump it per _Command
   surface_; allocate a monotonic build number; record exact HEAD and dirty content. The source and
   lock writes are one serialized filesystem transaction. Git index, refs, and history are never
   mutated. Nothing here runs before the action list and gate; preflight only reports what will happen.
3. **Release compile.** `Runtime.generateApp` with `validationMode: 'release'` and no Studio
   preview, into the host's `_gen_tao-app/` as today, plus a generated `_gen_tao-app/ship.json`
   carrying the derived configuration: name, bundle identifier, version and build number, the
   embedded commit hash and dirty fingerprint, proven export-compliance metadata when known, icon
   and splash. The
   checked-in host gains an `app.config.js` that reads `ship.json` when present and falls back to
   today's "Tao Runtime" values when absent, so `tao dev` and every existing test see no change.
4. **Bundle proof.** `expo export` of the release bundle, then an assertion that no Studio module
   marker appears in it. This is the missing production-bundle assertion the exploration calls
   for, and it runs before the archive.
5. **Prebuild, archive, upload**, the local pipeline of _Build lane_, through the shared
   `CLI.run` with output streamed in the dev loop's prefixed style: `expo prebuild --platform
   ios` into the host, `xcodebuild archive` with automatic signing through the API key flags,
   then `xcodebuild -exportArchive` with `method: app-store-connect` and `destination: upload`.
   Every invocation's argument vector is a pure function of `ship.json` and the lock, so tests
   assert it exactly.
6. **After the upload**, through the App Store Connect client: wait for Apple's processing of
   the build unless `--no-wait`; then for plain `tao ship` create or reuse the App Store version
   for the semver, attach the build, and submit it for review; for `--beta` ensure the project's
   internal and external groups, add the recipients to the right one by team membership, set
   "What to Test", assign the build, and for the external group submit the beta app review when
   this version has none. Each completed step is recorded in the lock so a rerun resumes.
7. **Summary.**.** The block shown under _The outcome_, plus the App Store Connect TestFlight URL.
   The command exits non-zero on any failed stage with the substrate's own message quoted, never
   paraphrased.

### Cost and time per round

| Round                                  | Wall clock                                | Direct cost                                |
| -------------------------------------- | ----------------------------------------- | ------------------------------------------ |
| First binary to TestFlight             | local Xcode build + Apple processing      | no build quota; Apple Developer membership |
| Update to an installed build (slice 2) | upload plus the client's next-launch poll | Tao update-service hosting                 |

The update round is the one a beta tester's feedback loop actually runs on, which is why slice 2
follows slice 1 immediately rather than waiting for the migration program.

## Slices

Each slice lands per the repository's ordinary definition of done: focused tests while working,
`./agent verify` green, and a recorded live acceptance in this document, in the style of the
InstantDB provider's _Live acceptance_ section. No slice needs a WordFlower tranche: none adds
grammar. The one spot that would — `project { targets }`, `version`, `Icon` — is deferred to
decisions 2 and 4 and can be pulled into a tranche independently.

### Slice 0 — now the `--expo` flag

**Historical proposal, not implemented.**

An Expo Go bridge was planned here for the zero-account case. An intermediate 2026-09-02 ruling
gave that case to `tao ship --beta` through the companion app, then considered `tao ship --expo`.
Neither proposal landed; `--beta` is TestFlight and there is no Expo ship lane. The account
walkthrough for it is preserved in `Research - Beta distribution lanes.md`.

### Slice 1 — `tao ship` to the App Store and `--beta` to TestFlight

Scope: the command as _Command surface_ settles it — project discovery, app selection through
`--app`, `DefaultApp`, or a prompt, the filesystem-only semver/lock transaction, precursors with their
automation and keypress waits, `--dry-run`, the action list and the Y/n gate — plus preflight,
the lock, derived host configuration, release compile, the bundle proof, the local pipeline of
_Build lane_, the App Store Connect client for review submission and TestFlight groups and
testers, and the summary. No Android, no EAS, no `eas.json`. The InstantDB variant ships
against a hosted Instant app whose id is provided through the lock rather than edited into
source.

Tests, in `packages/tao-cli/cli-tests/ship-command.test.ts` and the toolchain suite:

- Derivation is pure and tested by table: declaration in, `ship.json` out, including the name and
  identifier rules for primary apps versus variants.
- The pipeline takes an injected command runner and an injected App Store Connect client; tests
  assert the exact `expo prebuild` and `xcodebuild` argument vectors and export options, replay
  recorded API responses for the review and TestFlight steps, and never touch the network.
- The bundle proof runs as a slow lane beside the Studio smokes, exporting the WordFlower release
  bundle and asserting the Studio marker is absent; a deliberate preview compile is the positive
  control.
- Preflight tests cover every miss and its message, interactive and non-interactive.

Acceptance boundary: repository tests cover orchestration, atomic writes, unchanged Git index/refs,
resumption, and derived artifacts. A real TestFlight submission/install and hosted-data device run
remain external acceptance and are not claimed by this record.

### Slice 2 — `--update`

Scope: `expo-updates` in the host, Tao's Expo-protocol update service, a channel per variant, real
exported assets, and compatible rollback. Runtime identity comes from the native fingerprint and
schema identity from canonical semantics rather than CST text. Publication and rollback are checked
against every supported binary, not only the most recent build.

Tests: the fingerprint is computed from the host and asserted stable across a copy-only change and
changed by a new native dependency; the driver tests extend to the update and republish vectors.

Acceptance boundary: repository artifact/protocol tests cover runtime headers, exported assets,
semantic schema hashing, fleet compatibility, and rollback history. An installed-binary OTA remains
external acceptance and is not claimed here.

### Slice 3 — testers

Scope: `--invite <email>` adds a tester to the variant's TestFlight group through the App Store
Connect API with the configured App Store Connect key; an external group with a public link and the
one-time Beta App Review submission for testers outside the team; TestFlight feedback surfaced
through `eas testflight:feedback` in a summary line. Android stays out of scope.

### Slice 4 — one host for dev and ship

Scope: a development build of the same derived host with `expo-dev-client`, so the phone lane of
`tao dev` no longer depends on the App Store Expo Go; it is the companion app's ancestor and
converges with that program. The EAS lanes this slice once listed are dropped with Expo.

### Handoff

Slices 3 through 6 of `../Tao ship.md` — schema fingerprint and the additive class, the deploy
configuration channel, hosted provisioning — pick up from here unchanged. Slice 1 and 2 here are
the exploration's slices 1 and 2 made concrete.

## Decisions for Ro

Each has a recommended default so slice 1 can start on the ruling alone.

1. **The verb.** Settled on 2026-09-02: `tao ship` for the app motion, with `--beta` for
   TestFlight. `tao publish` stays the package registry's verb. The MVP Justfile's
   `tao build --profile` recipes and the Tao Future Justfiles' `build` and `publish` recipes are
   replaced by `tao ship` recipes.
2. **Where the identifier facts live.** Settled on 2026-09-02, after the search Ro asked for;
   see _Precedent: accepted project metadata_ below. The ship facts are accepted project metadata
   in the project's `.tao-project/` folder: the `ship` section of one repository-tracked
   `lock.jsonc` that the developer commits,
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
5. **The Expo Go bridge.** Settled on 2026-09-02: not built; `--beta` is TestFlight, not a
   companion-app delivery path.
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
- **This repository's packages spec**, `Docs/Spec/Tao Packages.md`, names `.tao-project/` at the
  project root. The single Tao-written `.tao-project/lock.jsonc` has independent `installs` and
  `ship` concerns plus top-level `schemaVersion`; writers atomically merge fresh state.

What the precedent settles for ship. The identifier facts are exactly this category of data:
Tao derives or accepts them once, production builds read them, nobody types them into source,
and a stale or missing entry must fail the build rather than ship something wrong. So they
belong in `.tao-project/`, not in a bespoke file beside the entry declaration, and they follow
the design lock's contract rather than inventing one:

- `.tao-project/lock.jsonc` is the project's one Tao-written lock, with a top-level section per
  concern. `tao ship` owns the `ship` section: per app variant, the bundle identifier, lifecycle
  checkpoints, build provenance, update channel, supported binaries, runtime identity, and
  semantic schema identity. Every
  entry has an identity, an input hash over the declarations it was derived from, and a status.
- Prompted values arrive as `suggested` and are promoted to `accepted` by the same run that
  confirms them, which is the accept operation the design lock defined; `tao ship` refuses to
  build from a suggested or stale entry. Slice 1 may keep suggestions in memory rather than in a
  hidden sibling file; the sibling is the design lock's answer for suggestions that outlive a run.
- Secrets never enter the folder. Credentials stay in the substrate's stores, as this plan
  already says; the exploration's `config` resolution for provider ids reads the same lock.
- Package resolution owns the implemented `installs` section (`lockfileVersion`, `requires`, and
  `projects`), while shipping owns `ship`; neither writer interprets or erases the other's concern.

## The Tao Studio companion app

**Direction settled, 2026-09-02.** Ro decided to create a Tao Studio companion app. It exists
for an improved development experience first, paired with Tao Studio while developing, and
also for pre-release testing and feedback by members a developer has invited to their project
on the Tao Lang servers, where every member must have created an account. The sections below
are the assessment that preceded the decision and the design rules it carries; the program
itself is opened in `Roadmap.md`. Its dedicated product and implementation plan is
`../Tao Studio companion app/Plan - Tao Studio companion app.md`.

**Historical companion assessment.** The original proposal was an iOS app published by Tao, paired with Tao Studio while developing,
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
on-device visual edit mode lives if that ever ships. As a proposed collaboration preview channel it is the Expo Go model
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

## Historical research limits, and current acceptance boundary

- iOS requires the developer's paid Apple Developer Program membership and a first interactive
  Apple login with two-factor authentication, once; no design removes either.
- EAS cloud-build queue and APK observations below are retained research; the implemented iOS lane
  builds locally with Xcode.
- Internal TestFlight testers must be App Store Connect team members; a friend who is not one is
  an external tester, and external testers wait on a one-time Beta App Review per version.
- An APK link works for a friend anywhere today, but Google's developer verification reaches
  four countries on 2026-09-30 and every certified device in 2027; from then the developer needs
  at least the free limited-distribution account, and Google's own pages disagree on whether
  direct APK installs in the four pilot countries are blocked at the regional deadline.
- OTA schema compatibility is derived from canonical semantic schema identity and checked against
  every supported binary. Incompatible changes require a new binary rather than publishing an update
  that existing installs cannot consume.
- Repository tests include a relocated CLI/runtime artifact; that proof does not imply a signed,
  notarized, installed, or store-accepted application.
