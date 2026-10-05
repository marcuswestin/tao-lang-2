# Hosted provider continuation

This handoff is for a new feature branch created from the committed tip of
`feat/hosted-provider-free-tier-acceptance`, which itself grew from `feat/hosted-provider-candidates`.
Read the [candidate roadmap](<Hosted data provider candidates.md>), the
[Hosted CRUD guide](../../Apps/Hosted%20CRUD/README.md), and `A21`/`A22` in the
[Agent MVP Roadmap](<../MVP Roadmap/Agent MVP Roadmap.md>) before changing code.

## State at handoff — 2026-10-03

### Done and committed

- **Firebase automation.** `./tao connect firebase 'Apps/Hosted CRUD'` uses the bundled Firebase CLI
  and a local Google sign-in. It creates or reuses a project and web app, Firestore, and
  Email/Password Auth, and deploys the pilot rules. The pilot project is `tao-hosted-crud-79c429`.
- **Appwrite automation.** `./tao connect appwrite 'Apps/Hosted CRUD'` uses the bundled Appwrite CLI
  28.1.0 (`appwrite-provision.ts`). Return automates; `manual` keeps the older pasted-key path. It
  works as follows:
  - Browser sign-in.
  - Picks the organization.
  - Reuses the saved project, or any existing `tao-hosted-crud-*` project, before offering to create
    one. The Free plan allows **2 projects**, and the Developer's organization has both in use:
    `My first project` and `tao-hosted-crud-160214` in `fra`.
  - Issues a 15-minute ephemeral project key that it never stores.
  - Configures the platform, Auth, and the TablesDB `tao_notes`/`notes` table, retrying 401/503
    while a new project warms up.

  Appwrite 2.3 takes index fields as `attributes`.
- **Public IDs** for both stacks are committed in `Apps/Hosted CRUD/tao.connections.json`.
- **Expo Go runs on the Developer's iPhone for both stacks.** The Developer confirmed that sign-in
  and basic note CRUD work. Since Expo SDK 57, Expo Go on a physical iPhone needs the **same Expo
  account** signed in to both Expo CLI and Expo Go; `tao connect run` checks this and asks. This is
  a first-experience cost to report.
- **Provider switching** no longer requires signing out. Each provider keeps its own session
  (`App.tsx`).
- **Tao's own run screen.** `tao connect run` no longer shows Expo's terminal UI
  (`hosted-crud-metro.ts`).
  - How it runs: Expo starts headless as `node --require <preload> <expo> start --go --port N`,
    with stdin ignored.
  - The preload (`metro-events-preload.cjs.txt`, copied to the app's ignored
    `.tao/connect-run/`) wraps Metro's `MetroTerminalReporter.update` and writes events as JSON
    lines.
  - The screen shows:
    - Expo's own Expo Go URL, from `GET /_expo/open?platform=ios` with an `Origin` header.
      The QR appears after `d` Device is chosen; `c` shows only the address until then.
    - Per-platform bundling progress.
    - Bundling errors with file, line and column.
    - `client_log` lines.
  - Keys: `r` reloads (`/message?method=reload`); `i` opens the iOS Simulator
    (`POST /_expo/open?platform=ios`); `a` requests the Android emulator through the same route
    with `platform=android`; `c` reprints the connection; `d` shows device guidance and the QR;
    `?` aliases `c`; `q` or Ctrl-C stops the process tree.
  - It takes a free port when 8081 is busy.
  - When Expo stops early, it prints Expo's output tail and writes it to `.tao/connect-run/expo.log`.
  - Verified so far: against real Metro headlessly (QR, URL, bundle event, reload, stop) and by
    focused tests.
  - On 2026-10-04 the Developer confirmed that the larger repaired QR scans on an iPhone.
    The smaller paired-row rendering needs a fresh scan; launch, reload, logs, and clean stop
    on devices and simulators remain separate acceptance gates.
- **Spike findings** behind the screen are recorded under A22. Expo's `/events` socket is broken,
  and `CI=1` disables watching. The reporter hook depends on Expo internals.

### Not done

1. **Developer device checks of the new run screen** (the steps below).
2. **Acceptance evidence** ("Acceptance work after setup" below): the Developer reports all
   Firebase manual tests passed and accepts Firebase for continuation. Preserve that report
   separately from direct hostile-request evidence, which remains inconclusive. Appwrite host
   debugging is deferred until the full Firebase Tao flow works.
3. **Run the prepared hostile-request probe script.**
   `Apps/Hosted CRUD/scripts/hostile-probe.ts` authenticates two existing test accounts per stack
   and attempts direct cross-account reads, writes, forged ownership, deletes, and Appwrite
   permission changes. The Developer types passwords at hidden local prompts. The first local run reached authentication only and was inconclusive;
   see the continuation decision below. Never ask for passwords in chat or create accounts or
   enter passwords yourself.
4. **The comparison write-up**: which stack is the easier first experience, plus the unmet gates.
   Put it in this document and the [candidate roadmap](<Hosted data provider candidates.md>).
5. **Repository gates and finalize.**
   - `main` has moved past this branch (`origin/main` is not an ancestor). Bring it in with
     `./agent merge-main`, or `./agent unsandboxed merge-main` if it refuses, before `verify`.
   - In the sandbox, `verify`'s dev-cli `contributor-linux-test` fails on an xcrun cache error;
     that is tracked separately and is not this branch's defect.
   - Then run `./agent unsandboxed finalize`. **Do not land without the Developer's explicit
     authorization.**

### Developer decisions

1. Landing this source slice was authorized on 2026-10-04. New-app device and server acceptance
   remain separate gates.
2. Whether the dev loop should get the same run screen. It is an unchecked A22 item, together with
   a test that starts real Metro and checks the event and URL shapes so that an Expo upgrade fails
   loudly.
3. The existing all-provider repository installation policy was approved for this slice;
   selective provider installation is deferred.
4. The Developer is adding a rule-break reporting bullet to `AGENTS.md` by hand; agents are blocked
   from editing it.

### Constraints and environment notes

- **Secrets.** Never paste or commit Google tokens, service-account JSON, or Appwrite keys. The
  Developer completes browser sign-ins and key entry locally. Appwrite's manual-path key lives in
  the ignored, owner-only, **unencrypted** `.tao/connect-secrets.json`.
- **The older source checkout.** `/Users/ro/.codex/worktrees/0629/tao-lang-2` holds a
  Developer-owned uncommitted `Apps/Hosted CRUD/tao.connections.json`. Never alter it or carry it
  over.
- **Unsandboxed runs.** Appwrite CLI network calls (the sandbox breaks its TLS) and Metro both need
  an unsandboxed shell.
- **Headless smoke test.** To smoke-test the run screen without a device, call `runMetroSession`
  from a scratch Bun script under `.artifacts/tmp/`, unsandboxed. Use a `PassThrough` input marked
  `isTTY` with a no-op `setRawMode`, `interactive: true`, `openSimulator: false`, and a spare
  `port`. Fetch the Expo Go manifest's bundle URL to trigger a build, then write `r` and `q`.
- **Busy ports.** Other worktrees' dev loops often hold 8081. One for `Apps/HNReader` in the
  primary checkout was running on 2026-10-03. Do not stop another checkout's process.
- **Cosmetic issue.** A prompt printed twice during connect is noted in A22 and not fixed.

## Developer verification steps

Run these from the new worktree root. Tell the Developer its absolute path first.

```sh
./tao connect run 'Apps/Hosted CRUD'
```

1. **iPhone:** press `d` for Device, complete any required local Expo account steps,
   then scan the QR code with the camera.
   - a. **Verify:** `iOS bundled in …s` appears and the app opens in Expo Go.
   - b. Press `r`. **Verify:** `Reloading connected apps.` appears and the app reloads.
   - c. Add `console.log('hi')` to `src/App.tsx`. **Verify:** `app log: hi` appears.
   - d. Break the syntax. **Verify:** `Bundling failed in …:line:col` appears with a code frame.
     Undo both edits.
   - e. Press `q`. **Verify:** `Shutting down…` appears immediately, then `Metro stopped.`
     appears after the process tree and pending actions finish.
2. **Simulator:** rerun the command and press `i`. **Verify:**
   `Opened Expo Go in the iOS Simulator.` appears and the app runs there.

If `connect firebase` or `connect appwrite` must be rerun, press Return to reuse the existing
projects. Do not create new Appwrite projects; the Free plan limit is already reached.

The 2026-10-04 QR report showed that the terminal theme mapped the renderer's palette black and
white to nearly identical greys. The repaired rendering uses explicit black/white colors and a
four-module quiet zone. The Developer confirmed that the full-cell rendering scans on an iPhone,
but reported that it was too large. The compact version pairs two module rows per terminal cell;
solid pairs use background-colored spaces and mixed pairs use half-block glyphs. This halves
width and height while keeping solid areas continuous. Source tests cover the matrix and geometry;
a fresh physical scan of the compact version remains pending. The QR is hidden until `d` Device
is chosen; startup and Simulator/emulator actions show no QR. Android emulator launch now uses
Expo's POST endpoint; its real-emulator acceptance remains pre-MVP work in A22. The run screen uses one compact `Actions:` line: `r` reload,
`i` iOS Simulator, `a` Android emulator, `c` Show connection, `d` Device (Android/iPhone), `q` quit.
The generic shared numbered-menu convention applies to other choice prompts.

The development auth screen has a temporary **Fill email + password** button using sample
validation values. It only fills inputs; the Developer performs sign-in/account creation locally.
Remove it when validation is complete.

## Acceptance work after setup

1. For **each** free-tier stack, measure first account to first synced note and record manual
   setup actions. On two devices (the iPhone and the Simulator are enough), create, edit, toggle and
   delete notes and confirm updates in both directions. Then disconnect one device, queue a create,
   an update and a delete, kill and relaunch Expo Go, reconnect, and verify durable replay and one
   final state on both devices.
2. Sign out and switch between two accounts, including while offline with cached rows. Check that
   notes from the other account never appear. Use direct Firebase/Appwrite client requests
   authenticated as the second account to attempt cross-account reads, writes, forged ownership, and
   deletes; record server responses separately from UI filtering. Examine Appwrite's
   client-controlled `ownerId` and whether its row permissions actually enforce isolation.
3. Inspect failures for missing Expo Go modules, authentication restoration, conflict handling,
   duplicate rows, partial sync, data leaks, and errors after an app restart. Compare actual setup
   effort and behavior, then recommend which stack is the easier first Tao experience. Record a
   failed gate as a finding; do not declare a Tao capability from this standalone app.
4. Keep the original Jazz/Convex/Pylon pilot gates separate.
   - Jazz alpha.57 cannot currently reject a direct same-value write to a protected field based on
     submitted field intent, and server-enforced `(owned)` deletion remains unresolved; keep
     `supports { }`.
   - Convex needs a disposable deployment and hosted direct-request and device proof.
   - Pylon needs a hosted deployment, native sign-in, direct-request proof, and full offline
     working-set, replay and account-switch proof.

   The [pilot findings](<Hosted data provider candidates.md#pilot-findings--2026-09-28>) have
   details.

## Acceptance evidence branch — 2026-10-03

`feat/hosted-provider-acceptance-evidence` starts at `0575e5d80`. Setup passed in the new
worktree. On 2026-10-04 the Developer confirmed the larger repaired QR scans on iPhone.
Screenshots show the iOS Simulator opening, reload requests acknowledged, completed iOS builds,
and a native startup log. These are partial run-screen observations: compact QR scanning and
clean stop still need confirmation. The Developer then confirmed `app log: Hi` after saving
and reloading the app; the event capture contains the message. A lingering progress line was
caused by retaining a completed build's status; completion/failure now clears it or restores
another active build, and late progress for completed IDs is ignored. Focused regression tests pass. The Developer reports Appwrite + Legend sign-in and notes appearing on iPhone and Simulator
after switching screens or reloading, but incoming notes do not appear live: realtime sync fails.
Its source repair is prepared, with device debugging now deferred. The later continuation decision
records the Developer's Firebase manual acceptance; direct hostile-request evidence remains
inconclusive. There is no measured setup-time comparison yet. Preserve the separate Jazz/Convex/Pylon gates above.

The direct-request probe is prepared for a Developer-run check after the device steps:

```sh
bun run "Apps/Hosted CRUD/scripts/hostile-probe.ts"
```

Run it from this branch's repository root in a normal local terminal. It reads only this checkout's
public configuration, allows the existing Firebase/Appwrite pilot projects, and never provisions
accounts or projects. Passwords use hidden prompts. It writes redacted response observations and
fixture cleanup status under `.artifacts/hosted-provider/`; authentication response bodies are not
written. Transport failures, failed positive controls, and ambiguous responses are inconclusive.
Appwrite ownership forgery and explicit permission grants are separate cases from baseline foreign
row access. Server responses are separate from UI filtering. Firebase probe tombstones may remain
because the pilot rules prohibit physical deletion; consult the actual cleanup report.

The app's local mock-test lane and typecheck passed during preparation. Those checks prove probe
behavior with simulated responses. The initial real server report is inconclusive, while the Developer accepts Firebase
manual tests as enough to continue. Do not treat this as server-authorization proof or a timed
first-experience comparison. Integration with main, final gates, commit, and finalization remain
repository steps. Landing, the shared dev-loop screen, and selective provider-dependency installation
remain Developer decisions.

## Later: move the winning stack into Tao and the CLI flow

The spike app still holds provider code a Tao app must never write itself. Before either stack
becomes a Tao datasource:

1. Move the adapter into a `packages/apps/providers/` package, so an app created by the CLI
   carries no custom provider code. That includes runtime workarounds the spike found. For
   example, RxDB's default hash calls `crypto.subtle.digest`, which Hermes in Expo Go lacks. The
   spike passes a `@noble/hashes` SHA-256 as `hashFunction`, and the provider must own that choice.
2. Make `tao connect <provider>` and `tao connect run` work on an app the CLI created,
   end to end, with no hand edits to its `package.json`, `app.json`, or source.
3. Install provider dependencies only when they are used, not in every app. The proposed
   default: the compiler already knows which providers an app declares, and the provider package
   pins its own dependency versions. Setup then adds exactly those dependencies. Always
   installing every provider would add install time, conflicting peer and native-module version
   constraints, and larger Expo Go compatibility checks. Metro's bundle would not shrink either
   way. Confirm this choice with the Developer before implementing it.

## Repository checks and completion

After fixing any observed issue, run the **focused changed test** while editing, then the branch
gates from the worktree root:

```sh
./agent test-file packages/cli/tao-cli/cli-tests/hosted-crud-run.test.ts
./agent test-file packages/cli/tao-cli/cli-tests/connect-command.test.ts
./agent verify-changed
./agent verify
```

App tests run with `bun test --cwd "Apps/Hosted CRUD" src`. Never label a local test, generated
backend, native compile, or cached verification result as hosted, device, or offline proof. Stage
and commit only reviewed changes. If a connect run modifies `tao.connections.json`, ask the
Developer before committing the change. With a clean worktree and completed review, run
`./agent unsandboxed finalize`.

Final completion means:

- A committed, reviewable branch.
- A documented winner, or a bounded failure, for the Firebase/Appwrite first-experience comparison,
  backed by real cloud, two-device, offline-restart, and hostile-client evidence.
- Accurate roadmap and app guides.
- The required repository gates passed, and clean finalization.
- A clear statement of the remaining gates for Jazz, Convex, and Pylon.

Do not claim provider readiness or land an unmet required gate.

The Developer initially confirmed Firebase + RxDB realtime sync in the iPhone/Simulator check,
then reported that all Firebase manual tests worked. This is Developer-reported evidence for
continuation; the direct hostile-request gate remains separate.

The Appwrite source diagnosis found only a 30-second polling subscription in Legend sync,
with no Appwrite realtime event subscription. The repair adds the installed SDK's dedicated
Realtime row channel to trigger refreshes and dispose with the connection. This is source work;
repeat the iPhone/Simulator create, edit, toggle, and delete checks before closing the failed gate.

### Continuation decision — 2026-10-04

The Developer reports that all Firebase manual tests worked and explicitly accepts Firebase + RxDB
as good enough to continue into the first full Tao adapter and CLI-created-app flow. This is a
Developer-reported acceptance and sequencing decision, not a measured setup-time comparison.
The direct-request report `hostile-probe-32b15cba-c69d-433c-9460-c472406d94b6.json` remains
inconclusive: Firebase account A authenticated (200), B did not (400); Appwrite A/B did not (401).
No hostile requests or fixtures were created, so server authorization is not proven by that run.
Appwrite device debugging is deferred until the full Firebase flow works; its prepared realtime
source repair remains unaccepted on devices. Keep Jazz/Convex/Pylon gates separate.

The first Tao flow will target private account-scoped Notes with full CRUD through existing
auth/data contracts. General authored access grants remain unsupported until separately proven;
this does not change Tao language semantics or establish provider capability conformance.

The Developer approved the existing all-provider installation policy for the Firebase-first slice
and ignored project-local public connection settings at `.tao/local/connections.json`. Selective
provider installation is deferred. The named Firebase/RxDB/SQLite/hash/persistence dependency pins
and workspace wiring are approved; this does not authorize later version changes.
Sharing the run screen with the dev loop remains pending. The Developer authorized landing the
source slice on 2026-10-04.

Repository integration also reproduced the known ignored orphan-directory lint issue. The
obsolete task-generated Effect Outcomes contract and bridge-check config were removed after
checking ownership, inactivity, ignored status, and absence of authored source. The
[developer-environment ledger](<Developer environment upgrades.md>) records this issue and the
standalone app-test command gap; these are separate from hosted acceptance.

Main also introduced immutable public release classifications. The inherited `connect`, Jazz,
Convex, and Pylon pilot commands are classified under the existing development-only hosted-data
capability. They remain available in the development CLI and excluded from public release phases;
this integration does not approve a new public release phase.

### First Tao Firebase application — implementation and remaining proof

The development CLI can create a Firebase-backed app with `tao create ... --provider firebase`.
`--validation-tools` adds the temporary synthetic credential-fill button only when explicitly
requested. The committed validation app is `Apps/Hosted Firebase`, generated through that CLI.
It has separate sign-in and registration actions, a signed-in account gate, private scalar item
CRUD, and sign-out. It uses `@tao/auth/firebase` and `@tao/data/providers/firebase`; general access
grants, references, unique fields, and migrations remain unsupported rather than advertised.

Ordinary Tao projects save public Firebase settings at `.tao/local/connections.json` and receive
those settings during app generation. Their connection flow now uses API setup by default: it compiles the selected app before cloud
setup, reuses local Google sign-in and saved project/web-app identity, and configures Email/Password
Auth, the default Firestore database, and private rules. `--manual` retains Console setup with
direct project links. The standalone Hosted CRUD pilot retains its handwritten rules input. Missing or
invalid local configuration produces a diagnostic; no developer project IDs are checked into
this new validation app.

Focused source checks cover configuration containment, generated rules, auth cancellation,
account-scoped data mapping, shared database lifecycle, and generated app behavior. Five local
Memory/TestAuth journeys pass in the CLI-created app. A headless Metro run produced an iOS bundle
(1,869 modules); its owned dev loop was stopped. These are compilation and local behavior proofs,
not device execution, SQLite restart durability, hosted realtime, or server authorization proofs.

Developer verification, from this worktree:

```sh
cd /Users/ro/.codex/worktrees/hosted-acceptance-evidence/tao-lang-2
./tao connect firebase 'Apps/Hosted Firebase' --app FirebaseNotes
```

Select the existing Firebase project locally and review the CLI setup plan before deployment.
The exact known Hosted CRUD notes rules can be preserved alongside the generated store rules.
Unfamiliar rules stop automation with downloaded current rules and a generated candidate for
local review; resume with `--rules` pointing at the reviewed combined file. Keep password entry
and Google sign-in local. `--manual` is available for Console setup; generation alone does not
enforce rules.

After reviewing and deploying the combined rules locally:

```sh
cd /Users/ro/.codex/worktrees/hosted-acceptance-evidence/tao-lang-2
./tao run 'Apps/Hosted Firebase' --app FirebaseNotes --ios
```

In that dev loop, press `p` to choose a connected physical device. Sign in locally on iPhone and
Simulator for the live-sync sender/receiver check. Validate create/edit/toggle/delete, restart
offline with queued writes and reconnect replay, then switch accounts online and offline without
foreign rows or writes crossing sessions. Each required manual verification may be performed on
either iPhone or Simulator; do not duplicate the checklist on both. The two temporary account-fill
buttons at the bottom of sign-in fill the Developer-selected accounts without submitting. Existing
pilot acceptance does not automatically accept this generated Tao application.

The earlier hostile probe targets the standalone pilot's row layout. Direct server acceptance
for the new `users/{uid}/stores/{store}/{entity}/{id}` layout remains open and needs matching probe
requests against deployed rules; do not substitute UI filtering or local rule assertions. Appwrite
realtime device debugging remains deferred. Jazz/Convex/Pylon gates remain separate. Sharing the
compact run screen with the regular dev loop remains a pending Developer decision. The Developer
authorized landing this source slice on 2026-10-04; new-app acceptance remains separate.

Main's project/module migration is integrated: the generated app uses literal identity and
`.tao/project.json`, and the regular launch command is now `tao run`. Firebase stays a built-in
`@tao` provider backed by its private workspace package, following the existing provider seam.
This preserves the approved repository SDK installation policy; it does not add authored npm
requirements or selective provider installation. Installed standalone CLI packaging is a separate
unproved boundary. The regenerated app's five local journeys pass after that integration.
The merged app also generated backend files and an iOS Metro bundle without launching a device.
Package-discovery fixtures required explicit project markers after the migration; their 19
focused tests pass with all assertions preserved. Two sidecar host fixtures also now live outside
the repository; their seven tests pass. The resolved finding is archived in the ledger.

The integration also gives the Convex/Pylon review variants distinct app identities. An external
sidecar build snapshot inherited the worktree project boundary; those snapshots now use temporary
host storage with finally cleanup, while ordinary builds keep worktree scratch. The publication
and build regression suites pass with their original assertions. These repairs establish no new
hosted-provider acceptance.

Post-merge verification exposed more fixtures that assumed no containing project. Their isolated checks pass after explicit project markers or host temporary
roots. A reproduction refreshed the untracked worktree root and wrote synthetic connection state
there before the fixtures were corrected. That root `.tao/` state caused Studio external sidecar imports to cross a project boundary. Its original ownership is unconfirmed. The Developer approved preserving
that directory, generated root `tsconfig.json`, and task-created root `tao.connections.json` under
ignored `.artifacts/hosted-provider/root-state-backup/`; the move is complete with contents intact.
No secrets were read. Keep the production ownership rule. The repaired tree passes changed verification, including Studio and the Tao app suites. Full
verification, the integration commit, and finalize record repository readiness separately from
hosted device or server acceptance. The Developer authorized landing on 2026-10-04. The first
landing attempt caught a Studio preview packaging defect: its Expo config retained a local Jazz
plugin reference while the isolated runtime omitted the plugins directory. Preview creation now
copies that directory, with a regression assertion for the configured plugin. The focused Studio
suite and an isolated real headless Studio launch pass. The repair is recorded in the
[developer-environment archive](<Developer environment upgrades archive.md>). The full landing
workflow must establish the final host gates before publishing.

A later landing integrated main 20bbeff06 (managed development loops and native acceptance
ownership). The additive merge resolutions preserve Firebase configuration injection alongside
managed publication identity, source revision checks, and release guards, and retain both shared
file-URL helpers. Their focused runtime, shared, and Studio tests pass after frozen setup. The
seam review also found that build snapshots excluded local Firebase connection settings; those
settings now pass through the strict public-settings reader into the snapshot and source digest.
The synthetic compile-only build regression reproduces the old failure and passes after the fix,
including changed settings, key reordering, and exclusion of unrelated local data. This source
proof does not establish installed standalone packaging or hosted/device acceptance.

Integrated changed verification also exposed a main-native diagnostic fixture whose socket
address exceeded the Unix socket path limit under this worktree. Its nonexistent socket address
now uses a short unique path without creating external files or changing native registration
behavior. All 55 focused fixture tests pass; the original diagnostic assertions remain intact.

### Validation follow-up — 2026-10-04

The source slice landed on main as `883ea9ee8`. The validation app now has two temporary
account-fill buttons at the bottom of sign-in for the Developer-selected accounts; they fill
without submitting. The reusable CLI generator still uses generic synthetic values.

For the new Firebase app, the Developer accepts each manual verification on either iPhone or
Simulator; do not duplicate the checklist on both. Realtime observation still needs one sender
and one receiver. Hosted CRUD/realtime, offline restart/replay, online/offline account isolation,
and direct server authorization against the new store layout remain unproved. A matching
hostile-request probe still needs implementation; the standalone pilot probe is insufficient.
Remove the temporary account buttons after acceptance. Appwrite's realtime repair still needs
host acceptance, followed by offline/restart/replay, account isolation, and direct requests that
separately test forged ownerId and explicit row permissions. Its full Tao adapter and CLI-created
app flow are later implementation work after the Firebase flow is accepted.

### CLI input guidance follow-up — 2026-10-04

Firebase connection now explains where to obtain the Web SDK configuration before its first
paste prompt, including reuse of an existing Web app, registration only when missing, accepted
paste format, and the manual-field source. Ordinary Tao projects receive concrete Console
steps for Auth, Firestore, and publishing reviewed combined rules after saving local settings.
Appwrite's manual guidance starts from an existing project. Those instructions remain available behind `--manual`; API setup is now the default. Neither
source checks nor a saved configuration establish hosted acceptance.

The CLI UX requirement is recorded in the owning skill: input guidance must precede the prompt
and cover acquisition, prerequisites, and format. The CLI audit also covers named credentials,
shipping/signing identifiers, database location choice, encrypted-secret entry/authorization,
release authentication/token prerequisites, Firestore deployment prerequisites, and phone LAN addressing.
Cloud accounts, passwords, and native approvals remain Developer actions. API deployment runs
only after the Developer reviews and confirms the concrete plan locally.

### API-first Firebase connect follow-up — 2026-10-04

`tao connect firebase` defaults to automated setup for ordinary Tao projects as well as the
standalone pilot. The current-directory project path is optional. `--app` selects the app whose
compiled schema supplies the backend rules; compilation must succeed before cloud setup. The
manual config-paste and Console flow is selected explicitly with `--manual`. Its instructions
link directly to the selected project's Authentication and Firestore pages, and use the visible
labels `Get started`, `Sign-in method`, `Email/Password`, `Save`, `Create database`, and `Rules`.

Google sign-in stays in the official Firebase CLI's local browser flow. CLI/API account identity
must remain consistent, credentials must never be copied into app settings, and project/web-app
choices offer saved and existing resources before explicit creation. The workflow prints progress
through inspection, generation, deployment, and verification. Existing indexes are preserved:
the currently generated empty index file is retained as a local artifact rather than deployed
as a request to delete project indexes.

Deployed rules are project-owned. The CLI downloads them, preserves a local before-copy, and
checks for a concurrent change before deployment. A narrowly recognized exact Hosted CRUD
policy permits adding the generated store rule as a disjoint sibling while preserving the old
notes route. An unknown policy stops for a locally reviewed combined file via `--rules`; this
is not a general rules merger. Ordinary generated policies still cover wildcard store keys, so
multiple different ordinary app policies in one Firebase project require a separate composition
design and remain unsupported by this automatic compatibility case.

`.tao/firebase-backend` means a local generated deployment directory, containing
`firestore.rules`, `firestore.indexes.json`, and `firebase.json`. No custom backend server is
required. From the app folder, manual generation is `tao firebase generate --app FirebaseNotes
--output .tao/firebase-backend`; the default API flow performs generation itself.

Focused tests cover resource reuse, deployment cancellation, rule preservation on reconnect,
concurrent-change detection, and partial failure. Isolated vendor fixtures also execute the real
Node inspection bridge, covering account selection, paginated provider configuration, first-time
Auth initialization, email-link preservation, and exclusion of secret values from process output.
The Developer reported successful API connection to an existing project, including database,
Auth, deployed rules verification and local config saving. This is cloud setup evidence, not
new generated-store device or hostile-request acceptance. A newly created project subsequently
failed at initial inspection; the original inspector hid the failing API stage, so its exact
live cause was not established.

The follow-up accepts only the explicit `CONFIGURATION_NOT_FOUND` Auth response (HTTP 400/404)
as uninitialized Auth, and prints sanitized API stage/status/code for other inspection errors.
Immediately after project creation, transient permission/rate-limit/server responses are rechecked
up to ten times with ten-second waits; an unsuccessful inspection never authorizes deployment.
Existing-project permission failures stop immediately. Creation progress follows the official
CLI's actual Google Cloud project and Firebase resource stages; retries announce actual rechecks.

Continue is first and is the Enter default for every Firebase setup confirmation. Project creation
proposes a valid ID with a random suffix; Enter accepts it and a typed ID overrides it. Resource
selection still defaults to reusing an existing project/app. Successful ordinary app setup prints
the next run command with the selected app and a wrapper/path appropriate to the current folder.
The fresh-project repair has source and fixture coverage; its live rerun remains pending. Reuse
`tao-autocreate-test` on that rerun rather than creating another project. This follow-up is not
authorized to land.

### Ordinary Firebase validation defects and retained requests — 2026-10-04

The Developer's web run signs in but fails to load with `Persisted field
'Account.DisplayName' has an invalid text value.` The ordinary provider creates a missing
local Account row by assigning null to every field. The app declares nonoptional
`DisplayName text`; this is incompatible with the existing runtime validation contract.
Both the seed and app declaration entered main in `883ea9ee8`. Required-text validation
predates that slice, and the later `580f88cc5` integration did not change the causal files.
Earlier accepted Hosted CRUD tests exercised the handwritten notes-only pilot, not this
Account bootstrap. Which exact earlier build the Developer remembers testing is unknown.

TypeScript accepts the seed because `FirebaseRow` is a dynamic `Record<string, unknown>`,
not a generated Account record type. The provider load contract returns serialized JSON
as a string; static checking of that string cannot validate its persisted field values.
RxDB schema generation allows null for every field,
and generated Account rules also allow required fields to be null. The principal provider
fixture uses an optional `Name` and injected fake replicas; the rules fixture explicitly
expects nullable required DisplayName. Local app journeys use Memory/TestAuth. No test
joined real account bootstrap with the Tao runtime's persisted-row validation.

Proposed repair, not yet implemented: declare an appropriate app DisplayName default;
create Account fields from authored defaults/optional metadata, rejecting required fields
without a value instead of inventing implicit scalar defaults; align RxDB and server-rule
nullability; repair affected synthetic account values without resetting IDs or notes;
cover bootstrap, runtime load, restart and incoming replication with a required text field.
Do not weaken runtime validation or erase stores as a workaround.

The Simulator separately reports `expo-sqlite is not installed`. The JavaScript dependency
already exists at the expected SDK57 version. The third-party React Native adapter catches
every import/evaluation failure and replaces its cause with this installation message.
Expo SDK57 Go includes SQLite. A custom host missing native ExpoSQLite, a host/JS mismatch,
or a lazy-import/evaluation failure remain possible; no original exception or launched
binary identity has yet been established. Tests replace native storage with memory, so
iOS bundling and source gates did not prove native database opening. Separately, host
native-kit discovery inspects direct manifest dependencies only and misses transitive
provider dependencies; record and fix that independently of the unconfirmed live cause.

The RxDB premium text is a Dexie storage console warning on the first bulk write, forwarded
by app logging. Supported premium suppression needs purchased premium access; narrowly
filtering that promotional message is a separate CLI decision. No suppression was applied.
The sign-in button boxes are horizontally centered; their labels can sit slightly high
because the basic FormButton applies a minimum height of 44 points and symmetric padding but
no vertical justification. The Developer requested an explanation only; layout is unchanged.

Root instructions now require retention of earlier requests/questions across messages and
compaction, a task-local unresolved queue, and explicit acknowledgement of superseded items.
The Console-first default is superseded since API connect became default; it remains the
`--manual` alternative. The accepted pilot remains accepted, while ordinary Tao Firebase
acceptance is blocked by these newly observed defects. Appwrite, Jazz, Convex and Pylon
gates retain their separate prior dispositions.

### Firebase management CLI follow-up — 2026-10-04

Firebase now exposes `projects list|info|create`, `apps list|info|config|create`, and
`data reset`. Run `./tao firebase --help` and each group's help from the repository
root. Listing/config commands use locally signed-in Google accounts; missing login uses
an interactive local sign-in. Signed-out JSON requests stop with instructions to sign
in in a normal terminal first. No credentials are copied into Tao app settings.

`data reset --project <id> --uid <uid> --store <authored StorageKey> --dry-run`
prints its plan without authentication or cloud calls. Actual reset deletes only the
selected `(default)` path `users/<uid>/stores/s_<encoded StorageKey>`, recursively,
after local confirmation. It does not delete Auth users, project/app registrations,
other stores, rules, indexes, or local offline replicas. Stop clients and clear local
replicas before reconnecting, because queued local writes can republish server data.
Full project deletion, app-registration deletion and Auth-user deletion are not exposed.

Management calls isolate Firebase configuration so a caller's `.firebaserc` alias cannot
redirect the confirmed literal project ID. Endpoint overrides are rejected before account
or cloud calls; local dry-run remains usable. Errors and JSON results redact credentials
and raw vendor errors. Existing provisioning uses the extracted shared CLI runner.

Independent review found no remaining findings after project-alias, endpoint, authored
StorageKey, JSON-login, and exact environment-restoration repairs. Focused management
and provisioning tests passed. These are source/fixture checks; no live management or
reset operation has been run. The Account-default repair and native import diagnosis
remain proposals/pending acceptance, and the Developer's explanation-only layout request
remains unchanged. This follow-up is not authorized to land.

Management commands and their flags use the existing `hosted-data` release capability.
The immutable public-release surface regression passed after adding these classifications;
no public release phase or provider eligibility was broadened.
