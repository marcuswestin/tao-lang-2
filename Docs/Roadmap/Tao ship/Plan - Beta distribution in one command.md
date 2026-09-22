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
tao ship . --app WordFlowerInstantDB --beta
```

With the developer's Apple prerequisites, that command compiles the variant in release mode,
derives native configuration from source and the project lock, builds a signed iOS binary locally
through Xcode, uploads it to TestFlight through App Store Connect, and prints the state the developer
needs next:

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

| Lane                                   | Tester needs                                   | Developer needs                                  | Verdict                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------- | ---------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tao dev` + Expo Go on the LAN (today) | Expo Go, same Wi-Fi                            | nothing                                          | Not distribution. Stays the local dev loop.                                                                                                                                                                                                                                                                                                                              |
| EAS Update opened in Expo Go           | Expo Go, a free Expo account in the owning org | an Expo account, nothing from Apple              | **The only zero-Apple-account iOS lane, and a fragile one.** Since 2026-05-12 Expo Go loads updates only for projects the viewer's account or organization owns, so the friend joins the developer's Expo organization as a Viewer. Since 2026-09-03 the iOS App Store build also requires that viewer to be logged in to Expo Go itself, on top of the ownership check. |
| EAS internal distribution (ad hoc)     | one-time device registration link, then a URL  | Apple Developer Program, Expo account            | **iOS fallback, Android default.** Every new iPhone costs a device registration and a rebuild; Apple caps registrations at 100 per membership year. Android is just an APK link.                                                                                                                                                                                         |
| TestFlight                             | the TestFlight app; an invite or a public link | Apple Developer Program, Expo account            | **iOS default.** No device registration. Internal groups take up to 100 team members with no review; external groups take up to 10,000 with a one-time Beta App Review and a public link. Builds live 90 days.                                                                                                                                                           |
| Google Play internal testing           | a Play account, an opt-in link                 | Play Console (US$25 once, identity verification) | Later. Correct for a store-bound Android app; unnecessary ceremony for a first beta.                                                                                                                                                                                                                                                                                     |
| Expo Launch (browser, no terminal)     | as TestFlight                                  | a public GitHub repo                             | Not a fit: Tao owns the command line, and the host is derived, not checked in.                                                                                                                                                                                                                                                                                           |

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
hand-declared" compatibility gate _Versioning & identity — the braid_ below wants, so the update
slice inherits a working mechanism instead of designing one.

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
- `tao dev` starts Metro with `expo start --host lan` without opening a target by default; explicit
  targets and the interactive controls can open supported runtimes. The physical-iPhone lane can no
  longer depend on the App Store's Expo Go: since 2026-09-03 Expo Go 57 on iOS requires a
  developer to be logged in to both the Expo CLI and the Expo Go app, and `tao dev`'s Metro server
  runs under a repository-local Expo home directory that a developer's own `expo login` session
  never reaches, so that login can never be satisfied. The lane now needs a development build. The
  build this plan produces is that build's natural ancestor, so slice 4 folds the two together.
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
  of an Expo organization, only inside the Expo Go shell, and — since 2026-09-03 — only a viewer
  who is also logged in to Expo Go itself; TestFlight with recipients covers the need without
  asking a tester to hold an Expo account or session at all. Slice 2's update server is therefore Tao's own, on the Tao
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

Tests, in `packages/cli/tao-cli/cli-tests/ship-command.test.ts` and the toolchain suite:

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

### Slice 5 — schema fingerprint and the additive class

Scope, not started: make `schemaVersion` real (content-derived from the `data` declarations, not the
hardcoded `1` the runtime writes today), ship-held schema history, mechanical additive migration for
Local, the ship-time compatibility gate on `--update`. Act 3 (below) on-device. Continues in _Schema
migration_ below.

### Slice 6 — deploy configuration channel

Scope, not started: the `config`-resolution mechanism sketched in _Secrets & deploy configuration_
below, per-variant stores, credentials out of source. Blocks on the secrets-wording seam with the
authority program.

### Slice 7 — hosted provisioning v0

Scope, not started: managed InstantDB app-per-variant provisioning and the first derived rules push;
the provider protocol grows schema/rules lanes. Act 3 hosted, fleet gate included. Continues in
_The hosted runtime_ below.

### Slice 8 — beyond

Not sequenced: automation execution host, error-report store, derived analytics, the managed
commercial front, Play/store expansion, desktop lane. Short self-contained implementation prompts
for any of slices 5–8 on request, after their decisions settle.

## The acceptance narrative, three acts

The acceptance narrative for the whole program, in the canonical app, per the tranche rule — a
capability exists only if a real feature in one of the four apps forces it — so WordFlower's
`2 - Next` tier grows the ship-forcing features as slices land:

1. **Clean checkout → installable build.** `tao ship . --app WordFlowerInstantDB --beta` on a fresh
   clone: derives name/bundle-id/targets/permission strings, builds locally with Xcode and the
   developer's accounts, submits to TestFlight. A phone installs it; documents sync through
   InstantDB. _(Slice 1, landed.)_
2. **A one-line copy change, over the air.** Edit a string; `tao ship . --app WordFlowerInstantDB
   --update`. Runtime fingerprint unchanged, schema fingerprint unchanged → the update publishes to
   the variant's channel; the installed app picks it up on next launch. No store review, no build.
   _(Slice 2, landed.)_
3. **A `data` field addition that loses no one's document.** Add `Starred boolean` to `Documents`;
   ship an update. The schema gate classifies it additive; devices upgrade their envelope on load;
   the hosted snapshot upgrades once; a teammate's un-updated phone is gated honestly rather than
   overwriting. Every document survives. _(Slice 5's first proof; not started — acts 1–2 needed no
   migration machinery, act 3 is what would prove it.)_

## Versioning & identity — the braid

Five versions coexist and must be told apart, not unified:

1. **Store version** ("1.4.2") — marketing, authored or auto-bumped. Implemented: `project { version
   "…" }`, bumped per _Command surface_ above.
2. **Build number** — monotonic, derived; `tao ship` counts it. Implemented.
3. **Runtime fingerprint** — derived from the native closure; gates OTA compatibility. Implemented,
   computed from the host rather than hand-declared (the `runtimeVersion` an EAS pipeline would have
   made the developer author).
4. **Schema fingerprint** — derived from `data`; gates data compatibility (see _Schema migration_
   below). Distinct from the runtime fingerprint: a copy change moves neither; a new sidecar moves 3
   but not 4; a new field moves 4 but not 3. The fingerprint itself is computed (`ship-executor.ts`);
   the migration machinery that acts on a change in it is not built — see below.
5. **Project version** — `tao publish`'s package-registry version (`Docs/Spec/Tao Packages.md`), a
   different product surface that happens to share the word.

## Secrets & deploy configuration

Not started. Two different things currently share one word, and the first act of this section is to
split them:

1. **`secret` the value type** (`Decisions.md` §2–§4): capability-grade, rotatable, lives in user
   data, already decided. Owned by the authority program. Not this document's subject — except that
   the ship pipeline must honor its guarantees (a `secret` never serializes into a prompt, never into
   an error report — see _Error reports in production_ below).
2. **Deploy credentials and provider configuration**: App Store Connect keys (the accepted ones —
   `issuerId`, `keyId` — already live in `.tao-project/lock.jsonc`, per _Precedent: accepted project
   metadata_ below), Play service-account keys, InstantDB admin tokens, API keys a sidecar needs. No
   general owner yet; an app's `AppId` values are still hardcoded in `.tao` source, survivable only
   because InstantDB app ids are public client values.

Design sketch for (2), to be settled in dialogue: configuration values referenced by name in
provider bindings, resolved at ship time from a per-project store that is never source:

```tao
datasource WordFlowerStore = InstantDB { AppId config InstantAppId }
```

with `tao ship` resolving `InstantAppId` per variant from the ship service's config store (or a
local `.tao-project/` file for the fully-local lane), prompting on first miss. Admin-grade values (an
Instant admin token, an ASC key) never reach the client bundle at all — they are consumed
server-side by the ship/backend service; the type system can enforce the split (client-config vs
server-credential) because the compiler knows which side each consumer runs on. **Seam flag**: the
word `config` vs overloading `secret`, and the InstantDB provider's config surface, are shared with
the authority & multiplayer program — collision to surface, not decide here.

## The hosted runtime — a backend derived, not configured

Not started, beyond the InstantDB provider status recorded in `Docs/Roadmap/Multiple datasources/Plan

- Multiple datasources.md`. The server-shaped parts of a declared Tao app, and where each comes from:

| Hosted piece        | Derived from                                                    | Firebase/Vercel equivalent           |
| ------------------- | --------------------------------------------------------------- | ------------------------------------ |
| Data store + schema | `data` declarations                                             | hand-authored schema/collections     |
| Store rules         | `validate` lowering, access rules, publish projections (§2, §4) | hand-written security rules          |
| Scheduled work      | `automation` — trigger, `while`, `once per`, audience, payload  | cron config + job code + dedup logic |
| Push delivery       | `notify` payloads + `Notifications` provider                    | FCM/APNs glue                        |
| Auth service        | `use auth from @tao/auth`, account references in access rules   | Auth product config                  |
| Error-report store  | the error architecture's capture bundles                        | third-party crash SDK                |
| Analytics           | declared commands/transactions/scenes (see _Derived analytics_) | event-tracking SDK + taxonomy doc    |

Two grounding facts give this section its shape. First, `Decisions.md` §12 decides `automation` is
"provider-owned scheduled work … explicitly not a timer on one mounted device" — but no decision
names the machine it runs on when every device is off. There is exactly one honest answer: a hosted
service. The hosted runtime is not an optional accessory; it is the **unnamed execution host the
language already promised.** Second, §4's publish machinery is decided as "(none of it is server
code)" — lowered to provider-native rules. So the hosted runtime's job is narrow and derivable: hold
the store, enforce the derived rules, evaluate automation schedules, deliver push, answer auth — and
_not_ run app code. An automation cannot write (§12); it `do`es a transaction, whose authority
question (§12 gap: what identity does a server-side scheduled `do` carry?) is a real language
decision this program must put to Ro.

Provisioning is a ship-time act: `tao ship` diffs the derived backend (schema, rules, indices,
automation schedules, push config) against what the service currently runs for that variant, shows
the diff, applies it. The InstantDB provider is the precedent and the gap: today it pushes nothing
(one opaque row, empty rules; see its status in `Docs/Roadmap/Multiple datasources/Plan - Multiple
datasources.md`). The path runs through making the provider protocol provisioning-aware — schema
push, rules push, and a migration lane (see _Schema migration_) — regardless of whether the store
under the Tao service is InstantDB, Postgres, or provider-per-plan.

**Error vocabulary is a contract, not a style.** Everything the hosted runtime emits speaks the
established language: provider failures are `fails <Case> "<sentence>"` — a case declared in Tao,
never a server-authored string ("English never crosses into TypeScript" extends to "English never
crosses out of the server"); a server-side write rejection arrives shaped exactly like a local
`validate`/`refuse when` outcome (`rejected` with a sentence, not an `error`); offline is never an
error. A backend whose failures are ordinary Tao cases is a backend whose failures are renderable,
translatable, and testable with the existing scenario machinery.

### Auth hosting

`Decisions.md` §11 decides the surface (`use auth from @tao/auth`, `auth.Account`, sign-in flows);
InstantDB brings its own auth (magic codes); the authority program owns access semantics. Ship's
narrower questions: who operates the identity service under a Tao-managed backend, whether accounts
are per-app or Tao-wide (recommended: per-app — a WordFlower account is WordFlower's; Tao-wide
identity is a product decision nobody has made), and how auth config (OAuth client ids, Apple
Sign-In keys) rides the deploy-configuration channel above. Flagged as a seam; not designed past
here.

## Schema migration — the honest option space

Not started. The hardest unsolved question in the language. First, the ground truth, verified in
code: **today, any change to any `data` declaration is fatal to all existing data.** The runtime's
`parseEnvelope` (`packages/apps/runtime/TaoRuntime-src/TR-data-persistence.ts`) demands _exact_ equality
between the persisted shape's `schemaVersion` and the compiled shape's — entity sets and per-row
field sets must match by name; even a purely additive field trips it on the first row. `schemaVersion`
is wired end-to-end through the envelope but still hardcoded to `1` by the compiler; it has never once
gated anything, and no `migrate` keyword exists in the grammar. The outcomes:

- **Local datasource**: the app blocks behind a modal whose only working button is **"Reset app
  data and reload"** — one tap, total data loss. The old data is not corrupted — it sits intact
  and unreadable on disk while the app offers to erase it.
- **InstantDB**: the connection deliberately grants no `reset()` (correct in isolation — a
  client must not wipe a shared store it can't read), so the only button is a retry that can
  never succeed. **Shipping a schema change to a hosted Tao app today permanently bricks every
  existing client.**
- **Mixed-version fleet**: a running client that receives a peer's newer-shaped snapshot
  degrades to a recoverable sync error — and then the two clients last-snapshot-wins overwrite
  each other's divergent data, because the store is an opaque blob that cannot arbitrate.

And one structural fact that shapes every option: **the store cannot help.** The hosted snapshot is
one JSON string InstantDB never parses; there is no server-side representation of entities to
migrate. Any migration is a read-transform-write by something that understands both shapes — a
client, or a Tao-aware service.

### The theaters

Any answer must play in three places at once:

1. **The device** — a Local snapshot upgraded in place when the app updates.
2. **The hosted store** — shared state that must change shape exactly once, not once per client.
3. **The fleet** — during any rollout (and forever, for users who never update), old and new
   binaries coexist against the same store.

### The option space

- **O0 — Status quo (refuse + wipe).** Honest, implemented, and disqualifying for a shipped
  app. Recorded because it is the baseline every option is measured against: anything shipped
  must strictly dominate "brick or wipe."

- **O1 — Derived compatibility: make `schemaVersion` real.** The compiler derives a schema
  fingerprint from the `data` declarations' content. The ship service keeps every shipped
  schema (this is the uniquely-Tao move: **schema history is a ship artifact**, so `tao ship`
  always holds both shapes and can classify the diff _before anything reaches a user_).
  Additive-compatible changes — new entity; new field with a derivable default (optional,
  defaulted, or case-with-none) — migrate mechanically: fill on read, write back upgraded.
  Anything else is refused at ship time until the developer says what it means. The lenient
  half of the classifier is small, checkable, and covers the overwhelming majority of real
  app evolution.

- **O2 — Declared migrations, in Tao.** For the refused class, the developer states meaning in
  source, next to the entity, in the language's own vocabulary:

  ```tao
  data Documents / Document {
     Title text
     Body text
     Starred boolean            // added in the same change as:
     migrate from 3 { Starred: no }          // sketch — spelling entirely unsettled
     migrate from 2 { Title: Name }          // a rename is a statement, not a guess
  }
  ```

  Checked at ship time against the _actual_ previous shipped schema (not a guessed one — the
  service has it), chainable across skipped versions, testable with the scenario machinery
  against captured fixtures from the old shape. The design bar: a migration is a total,
  deterministic, store-only function of the old row — no I/O, no model calls, so it can run
  anywhere (device or service) with identical results.

- **O3 — Eager server-side migration on deploy.** The ship service transforms the hosted
  snapshot(s) once, at `tao ship` time, using the O1/O2 rules. Solves theater 2 exactly once;
  requires the provider protocol to grow a migration lane (or the service to own the store
  outright), and requires the fleet gate below, because the moment the store is new-shaped,
  old binaries can no longer be allowed to write.

- **O4 — Lazy client-side migration on load.** Each client upgrades whatever it reads (old
  envelope → chained migrations → new shape) and writes back. Perfect for theater 1 (Local:
  this is simply what "app update" should mean). Dangerous alone in theater 2: with
  last-snapshot-wins blob storage, a lagging old client can overwrite the upgraded snapshot
  wholesale — lazy migration of a shared store is unsound without the fleet gate.

- **O5 — Expand/contract (dual-shape tolerance windows).** The industrial answer for
  zero-downtime services: ship shapes that read both, contract later. Maximum availability,
  maximum ceremony — it forces every developer to think in three-phase deploys, which is
  precisely the class of burden Tao exists to delete. Recorded as the escape hatch for the
  hosted service's _own_ internals, not as the developer surface.

- **The fleet gate (orthogonal, required by O3/O4).** The schema fingerprint becomes a sync
  gate the way the runtime fingerprint gates OTA: the store carries its shape's version; a
  client behind it does not brick and does not overwrite — it renders an honest, decided-vocabulary
  state ("This app needs updating to keep working with your data"), read-only at best. The
  current mixed-fleet mutual-overwrite behavior is thereby retired. Old binaries that never
  update stay in theater-3 purgatory honestly instead of corrupting theater 2 silently.

### Recommended composite (to seed the dialogue, not to end it)

O1 as the spine (derived fingerprint, ship-held schema history, mechanical additive class) +
O2 for everything the classifier refuses + O4 for Local + O3-with-fleet-gate for hosted stores
once the provider protocol has a migration lane. The WordFlower acceptance test falls out (see act 3
above): adding `Starred boolean` is O1's additive class — no declaration, no ceremony, and **no user
loses a document**, on device or hosted. Renaming `Name` to `Title` is one O2 line. Deleting a
field is a decision (`migrate` says drop, or the ship refuses) — never an accident.

What this composite deliberately does not solve, kept visible: reversible rollback past a
migration (refused unless the migration declares an inverse); migrations that need I/O or
human judgment (out of the model — that is an app feature, not a migration); and the long tail
of never-updated clients (gated read-only, forever, honestly).

## Error reports in production

Not started. The PROD half of the error architecture, deferred to this program by the Studio work.
The vocabulary and the capture machinery already exist; ship adds transport, storage, and defaults.

- **A capture bundle is the existing Studio capture, produced in the field**: the datasource
  snapshots (the only implemented capture domain, extended per the error architecture),
  persisted state, nav state, the action log, and environment values — exactly the ingredients
  Studio already replays as fixture + scenario. A production error report is therefore _a
  reproducible test case_, not a stack trace: opened in Studio, it becomes a named state and a
  failing scenario.
- **Structural exclusions, not scrubbing lists**: `secret`-typed values never serialize into a
  capture (the same language-level guarantee that keeps them out of prompts); credentials are
  excluded by construction because the capture domains simply do not include a credential
  store. Reports carry account _identity_ (whose session) because replay and support need it —
  identity is data the app already holds; credentials are not.
- **Scrubbing defaults for the rest**: user-content fields are the app's actual data, and a
  full-snapshot capture of them is radioactive. Default posture to settle in dialogue —
  leaning: report capture is **opt-in per app** (`Reports` slot or similar), with a declared
  redaction level (shape-only / sampled / full), surfaced to the developer at ship time and to
  the user in the platform-standard consent surface.
- **The report store is part of the hosted runtime**, keyed by shipped version + runtime
  fingerprint + schema fingerprint (so a report is replayable against the exact source that
  produced it — the ship service holds every shipped artifact). Report-store auth rides the
  same account model as the rest of the backend.
- **Errors speak the vocabulary**: a report's headline is a `Case + sentence` when the app
  refused/failed honestly, and only unhandled exceptions arrive as raw `error` — making the
  ratio of the two the first derived quality metric.

## Derived analytics

Not started. Tao apps need no analytics SDK because the taxonomy is the source: every titled
command, transaction, and scene is a named event with declared parameters; the navigation graph is
the funnel diagram. The hosted runtime counts them.

- **Counts, not content**: the derived event is the declaration name + timestamp + anonymous
  session key — parameters and payloads stay out unless explicitly opted in, matching the
  deny-by-default posture everywhere else in the language.
- The dashboard is derivable too: scenes over the nav graph, commands per scene, the
  `rejected`-vs-`saved` outcome ratio per transaction (which doubles as the health metric the
  error section wants).
- Open: whether analytics is on-by-default-anonymous or opt-in like reports; app-store privacy
  ("nutrition label") declarations are themselves derivable from these choices — a genuinely
  novel derivation (the compiler can _prove_ what the app collects).

## The commercial shape

What people pay for, and why it is defensible:

- **Free**: the language, the compiler, Studio, local/BYO shipping (`tao ship` over your own
  Apple/Google accounts, Local datasources, self-hosted anything). The loop must be
  walkable end to end for $0 — the funnel is the product.
- **Paid — the managed path** (per app per month, tiered by MAU/usage, in the shape of the
  hosting market: free dev tier → ~$19 hobby → ~$99+ production):
  1. **Hosted backend** — the Cloud datasource, derived rules, automation execution, push,
     auth, error-report store, analytics. The recurring engine; none of it exists without a
     server, and Tao's server is provisioned by the compiler.
  2. **Managed pipeline** — signing custody, schema-gated OTA, schema history and migration
     checks, sold as "ship without ever seeing four consoles."
- **Tenancy**: the `project id` is the tenant key (already decided as the stable identity that
  "travels with clones and published artifacts", with `--replace` as the explicit fork/sever
  operation); variants are environments _within_ a project's tenancy; a Tao account owns
  projects. Per-app auth (recommended above) keeps end-user accounts inside the app's tenancy.
- **The moat is derivation, not hosting.** Hosting is commodity; what Firebase/Vercel/Supabase
  cannot do is _see the app_: derived rules that cannot drift from `validate`, OTA gated by a
  schema the platform actually understands, migration checked against held history, analytics
  with a compiler-proven privacy label, error reports that replay as test cases. Every paid
  feature above is a compiler feature wearing a service; that is the pitch and the defense.

## Cross-program seams (flagged, not decided)

- **Studio v2 / error architecture**: this program owns the PROD half (capture transport,
  report store, scrubbing defaults) and must emit the settled vocabulary exactly; the fixture +
  scenario replay path is consumed as-is. The desktop Studio shell (Electrobun-packaged;
  signed/distributable packaging explicitly beyond Studio v1) is the eventual publish cockpit and
  the most demanding ship customer — recorded as a known lane; phone-first is v1. The missing
  production-bundle assertion (no Studio machinery in release builds) is proven by slice 1, landed.
- **Authority & multiplayer**: the `secret` value type vs deploy-config wording; the InstantDB
  provider's config/auth surface; per-app account semantics. Shared dependencies — collisions
  get surfaced to Ro, not designed past.
- **AI in Tao apps**: hosted agent execution, agent access to production data, on-device model
  entitlements in store builds, and eval runs against shipped model versions are intersections;
  noted here, owned there.

## Open questions, gathered

1. Migration composite: ratify O1+O2+O4+O3-with-gate? What may the additive classifier accept
   without a declaration? `migrate` spelling and its ship-held-history check.
2. Automation authority: what identity does a server-side scheduled `do` carry? (A §12 gap
   that needs a `Decisions.md` amendment, not just implementation.)
3. Error-report capture default (opt-in level, redaction tiers) and analytics default
   (anonymous-on vs opt-in).
4. Permissions spelling reconciliation (§11 `Reason` vs demos' `while using … because`) —
   needed before usage-string derivation is implementable.
5. Per-app vs Tao-wide end-user accounts (flagged to the authority seam).
6. Listing-asset derivation (Studio-rendered screenshots, `Icon` slot) — provided for now, later
   derived? The icon half is settled: a Tao default with a badged variant default now, the `Icon`
   slot argued separately as a grammar addition.
7. Web delivery (the browser is a medium, not a target): where `tao ship` puts the web build,
   and whether it is slice-worthy before the stores are solid.

## Deferred (liked, not scheduled)

- Studio as publish cockpit: the ship motion with a face — diff of the derived backend, channel
  dashboards, migration previews over captured fixtures.
- Screenshot derivation from named states; store-listing copy through the translation pipeline.
- Compiler-proven privacy nutrition labels submitted with the listing.
- Reversible migrations with declared inverses enabling gated rollback across schema changes.
- Self-hosted update server lane (open protocol) as an enterprise posture.
- Desktop Electrobun app shipping — signed, notarized, auto-updating — the Studio shell itself as
  first customer.

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
- **This repository's design-system plan**, `Docs/Roadmap/Add Tao design system MVP/Plan - Add Tao
  design system MVP.md`, carries the same idea as a lockfile sketch: a theme with generation
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
- The single lock reserves the `installs` section (`lockfileVersion`, `requires`, and `projects`) for
  package resolution, while the implemented shipping path owns `ship`; neither concern's writer may
  interpret or erase the other.

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
assignment, and source actions all ride the same binary. And it removes the account-login
dependence of the Expo Go bridge — Expo Go 57 now requires its own signed-in session, which
`tao dev`'s isolated Expo home directory can never present — because Tao ships its own shell and
updates it on its own schedule. The
Studio pairing, the LAN and tunnel development-server lanes, and the compiled-bundle update
lane all reuse what slices 1 and 2 build; the new pieces are the shell itself, project
membership, and the invitation flow.

**Does it make sense?** As a developer's tool, strongly. A Tao developer today needs the App
Store Expo Go on their phone, and since 2026-09-03 that Expo Go requires its own `expo login`
session that `tao dev`'s isolated Expo home directory can never present to Metro, closing the
lane on a physical iPhone regardless of SDK. The Tao
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
- **The review queue is the operational risk.** Expo Go's SDK 57 build (57.0.9) did reach the App
  Store, on 2026-09-02, but Apple's queue for a tool this widely used can still take months with
  no cause published. A Tao app inherits that uncertainty: one Apple account, one review queue,
  and a shell every Tao developer's phone lane depends on.
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
