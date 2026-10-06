# Hosted provider continuation

This handoff is for a new feature branch created from the committed tip of
`feat/hosted-provider-free-tier-acceptance`, which itself grew from `feat/hosted-provider-candidates`.
Read the [candidate roadmap](<Hosted data provider candidates.md>), the
[Hosted CRUD guide](../../Apps/Hosted%20CRUD/README.md), and `A21`/`A22` in the
[Agent MVP Roadmap](<../MVP Roadmap/Agent MVP Roadmap.md>) before changing code.

Current acceptance state is in [Simulator storage and live synchronization](#simulator-storage-and-live-synchronization--2026-10-05-1721-utc).
Earlier failure and recovery entries below are historical evidence, not the current ownership state.

## Companion launch and ownership follow-up — 2026-10-05

- Companion launch links disable Expo onboarding, automatic developer-menu opening, and its
  floating controls. Expo developer tools remain available from Tao's existing developer menu.
  Both CLI and Studio use the normalized launch link.
- The reported `@runtime/dev-runtime/TR-dev` loading failure came from this follow-up's import,
  not reinstalling Companion. The host now uses the public `@runtime/TR` entry. Restart an
  already-running dev loop (`x`) to refresh its copied host entry before reopening the app.
- Physical-device opening prints discovery, installed-app checks, network selection, and launch
  progress. Busy keyboard diagnostics identify the command holding the operation lock.
- New development manifests identify the app and project. Companion's iOS recent-project list
  shows last-used time and a trash button; deletion removes the history entry, not application
  data or cloud resources. Old entries keep their old name until reopened. These native controls
  require rebuilding and reinstalling Companion; no new dependency was added.
- The iOS Simulator Companion build succeeded with the projected launcher sources. An isolated
  FirebaseNotes copy installed and opened it, then bundled 2,051 modules in 1,500 ms. Focused
  tests cover the menu, launch links, device progress, metadata, and history projection. This is
  build and bundle evidence; physical-device visuals and signed-in CRUD are separate gates.
- Owned probe `1071ef78-c05e-42ec-8751-a7650b2b217a` stopped with proved cleanup and released its
  Simulator. The Developer's existing sessions, including PID 30445, were preserved. Its live
  parent chain was PID 63576 (`/bin/zsh`) and PID 22863 (desktop app), so it was not proved orphaned.
  A later explicit Developer cleanup request authorized stopping user-started sessions; PID 30445
  and the older FirebaseNotes PID 52039 then stopped with their recorded descendants.
- New foreground CLI ownership records retain exact process and parent identities. Only a
  confirmed orphan offers interactive stop/recovery with Continue as the default; live,
  ambiguous, legacy, Studio, and managed-session owners remain protected. Identity is rechecked
  after the prompt, and recovery uses a bounded graceful shutdown rather than a process-group kill.
- Landing is authorized for this follow-up, including the local landing route if hosted checks
  prevent a merge. The required order is Preview SPEED first, then this branch. A clean temporary
  landing checkout preserves the three Developer-owned untracked app directories. Work stops
  after confirmed landing. No new CI verification has been dispatched.
  Firebase ordinary-app acceptance and Appwrite debugging below remain separate follow-up work.

## Firebase CLI follow-up — 2026-10-05

- Creation now requires `--provider local` or `--provider firebase`, failing before planning or
  writing a project when omitted. Local remains available in staged releases; hosted creation
  retains its release capability gate.
- Developer decisions: a directory without a saved Firebase association defaults to creating a
  project; a saved accessible project remains preferred. An unavailable saved project stops with
  access guidance instead of silently switching. The first WEB registration is automatic with
  progress; existing registrations still offer reuse or new registration.
- The `flow-notes-test-2` setup created `tao-flownotes-eebe8efc` and its WEB registration but failed
  the combined post-deployment check, leaving no local connection. Read-only inspection confirmed
  Native/Standard `(default)` in `nam5`, enabled Email/Password Auth, and a deployed rules SHA-256
  matching the local candidate. The old run did not retain its before/after inspection, so its
  failing comparison cannot be identified retrospectively.
- Fixed an identified Auth fingerprint defect: documented output-only `client.apiKey` and
  `client.firebaseSubdomain` are excluded; editable client permissions remain protected. This
  avoids treating generated registration metadata as changed Auth settings. New failures name
  each unsuccessful check. `tao firebase projects inspect <id>` reads sanitized state and, from
  the app directory, compares deployed rules with the retained candidate without deployment.
- Generated detail forms now nest the width-constrained column and decorated panel instead of
  applying their conflicting `gap` clauses to one view. Checked-in starters match the generator.
  Developer-created `Apps/flow-notes-test-2`, `Apps/flow-notes`, and `Apps/firebase-flow-test` are
  preserved; they are not included in task commits.
- The cached Simulator host `1.0.0-585e6bbd1f9e` lacks the current `expo-media-library` requirement.
  Expo SDK 57 includes that package in Expo Go; the message describes the cached Companion.
  The fallback could not open its URL because no installed handler was available. No dependency
  removal is justified by that message. A local Simulator Companion build succeeded and produced
  `1.0.0-31bce09d683a`, including `expo-media-library` 57.0.5. An isolated copy of Hosted Firebase
  selected, installed, and opened that host on an owned iPhone 18 Pro. This proves native host
  dispatch, not signed-in CRUD or physical-device behavior. Probe session
  `4941eddc-86dd-4197-8e1a-4905bf4b15ac` stopped with proved cleanup, controller disposed, and
  Simulator released. The Developer's active original-app CLI session was preserved.
- This thread must not start CI while another workflow is running; check and poll every ten
  seconds before dispatching a new workflow. Local checks do not start CI. Ordinary-app offline,
  isolation, hostile-request, and physical-device gates remain open.
- Source changes are committed as `7b38b1da5`. Focused Firebase provisioning, inspection,
  management, creation, and release-surface checks pass, as do regenerated starter checks,
  lint, and typechecking. Both broad local lanes failed on the native-binding inspection lock
  with compiler/validator timeouts; isolated editor packaging and nominal-admission tests pass,
  and automatic retries recovered some compiler scopes. Broad readiness remains unproved.
  Evidence is deduplicated in the [developer-environment ledger](<Developer environment upgrades.md>).
  No CI, push, or landing was started in this follow-up; task-owned native probes are stopped.

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
    `.tao/cache/connect-run/`) wraps Metro's `MetroTerminalReporter.update` and writes events as JSON
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
  - When Expo stops early, it prints Expo's output tail and writes it to `.tao/cache/connect-run/expo.log`.
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
  the ignored, owner-only, **unencrypted** `.tao/local/connect-secrets.json`.
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
Firebase-only hostile-request probe is prepared at `Apps/Hosted Firebase/scripts/hostile-probe.ts`;
its live run remains pending. The standalone pilot probe is insufficient.
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

The authorized repair is implemented. The app and creation template declare `DisplayName text
(default "")`. Account bootstrap uses authored literal defaults and optional nulls; a required
field without a declared value fails explicitly. A bounded repair fills only missing/null required
Account fields with declared literal defaults, preserving row IDs, notes, and populated names.
Optional omissions become explicit nulls in runtime snapshots without changing wire/master state.
Unknown application fields are rejected, and incoming, proposed, and conflicting replicated rows
use the same production validator. Generated server rules reject null required fields. Reconnect
through API setup to review and deploy those updated rules before hosted validation.

The physical RxDB version-zero schema remains byte-compatible with existing caches. Logical
validation enforces the authored contract at storage and runtime boundaries; changing the physical
schema under the same version would strand existing offline stores. Real RxDB/provider/runtime
fixtures now prove bootstrap, bounded repair, reopen, optional projection, malformed-row rejection,
replication conflicts and tombstones. Firebase tests passed 40/40 and typecheck passed; independent
architecture review found no remaining Account finding. These tests mock remote Auth/transport,
so deployed rules and authenticated hosted behavior remain separate gates.

The Simulator separately reports `expo-sqlite is not installed`. The JavaScript dependency
already exists at the expected SDK57 version. The third-party adapter catches every import failure
and replaces its cause with that suggestion. Native preflight now preserves the original import
or storage-initialization stage and exception in development app logs; the recovery screen points
to those logs. Host compatibility now traverses installed dependency/dev/peer graphs, selects the
version Expo resolves before filtering native modules, and retains native source fingerprints.
The initial Companion kit lacked SQLite. The Developer subsequently authorized dependencies and
completion decisions; Companion now declares `expo-sqlite ~57.0.3` and setup refreshed its lockfile.
Expo-host already reaches SQLite through the Firebase provider, so no duplicate edge was added.
The Simulator host build passed at `.artifacts/hosts/1.0.0-585e6bbd1f9e/ios-simulator`,
including ExpoSQLite57.0.3; the real dependency-graph test passed26/26. A later reserved-Simulator
probe installed and launched that exact Companion. No bundle/database result arrived, and Device Hub
inspection timed out twice. Real native SQLite open/reopen remains pending.

A credential-free probe was dispatched quietly to a task-reserved Simulator with Expo Go57.0.9.
Go startup was observed, but no bundle or database result arrived. This does not prove native
open/reopen or establish the original reported cause. The Developer's iPhone17 session was not
controlled. Live native validation remains pending; memory-storage tests and bundling are not proof.

The RxDB premium text is a Dexie storage console warning on first bulk write. The authorized
change filters only the complete, recognized promotional banner from displayed Expo and Hosted
CRUD logs. Raw logs retain it; real warnings/errors and incomplete or modified messages remain
visible. Incremental UTF-8 decoding preserves split characters. No premium entitlement is claimed.
The authorized FormButton change adds `justifyContent: 'center'` to center labels vertically.
The earlier explanation-only and proposal-only limits are superseded by the later fix request.

The ordinary Firebase probe uses compiled storage paths and fields, two locally entered existing
accounts, positive own-CRUD controls, and direct unauthorized/foreign requests. Only exact server
403/PERMISSION_DENIED responses count as authorization passes. It separately records server
results, redacts entered credentials even within provider codes, hashes the executing implementation,
and saves attempted fixture IDs before creating them so lost or malformed responses still receive
bounded tombstone cleanup. Source tests passed11/11 and independent review cleared
redaction/provenance findings. No live requests were run by the agent.

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
and provisioning tests passed. Source/fixture checks passed. Live default-account project list/info and Web app listing
subsequently passed for `tao-autocreate-test`; no reset operation was run. The Account-default repair, native diagnostics, label centering and exact promotion filter
are implemented in the subsequent authorized source follow-up; live acceptance remains pending. The later completion goal authorizes landing after working web/Simulator proof.

Management commands and their flags use the existing `hosted-data` release capability.
The immutable public-release surface regression passed after adding these classifications;
no public release phase or provider eligibility was broadened.

The quiet diagnostic session was stopped through managed recovery after the Developer approved
termination of its exact recorded controller. Cleanup and reserved Simulator release were proved;
temporary source was retained in task artifacts and removed from Apps. No database result was obtained.

Both later probe sessions were stopped with proved cleanup, temporary Apps source removed, and
artifacts retained. Selecting the test email explicitly stopped before cloud calls because that
Google account was not signed in locally; the existing default CLI account was already signed in.
Live project list/info and Web app listing then succeeded using that default account.

The API reconnect to existing `tao-autocreate-test` and its existing FirebaseNotes Web registration
completed on 2026-10-05. Review found only the required DisplayName rule changed; deployment and
readback verified the default Native Standard database, existing Email/Password Auth and exact
generated rules. Indexes and billing were preserved. Public config was saved locally and the next
run command printed. No project, cloud account, sign-in or password was created/entered by the agent.
This proves existing-resource provisioning and deployed-rule readback, not client CRUD or hostile
server denial. Those credential-local and native acceptance gates remain open.

Complete verification also exposed a dead-export checker gap for Metro's unsuffixed platform
imports. The checker now follows actual value uses and named runtime re-exports to matching native
exports, while retaining orphan findings for unused/type-only/web-only/unrelated bindings. Its
focused regressions and independent review are required before final source gates.

The completion goal requests landing after the working web/Simulator flow is proven. That condition
is not yet met, so source finalize must not be presented as landing or hosted acceptance.

### Authenticated generated-app acceptance — 2026-10-05

The completion goal specifically authorizes the two supplied sample Firebase validation accounts
and landing after web/Simulator synchronization works. This supersedes the earlier blanket
account-entry restriction only for those two Firebase test accounts; Google and Appwrite sign-ins
remain local Developer actions. No password resets or additional cloud projects are authorized.

A fresh CLI-created Firebase Live Acceptance app passed its five starter journeys. API connect reused
existing project tao-autocreate-test and its Web registration; generated rules matched the deployed
rules exactly, and remote readback passed. The existing Developer-owned Hosted Firebase loop was
preserved. On the fresh web app, signup reported the sample account already exists. A later sign-in
returned HTTP200 and rendered the signed-in account gate, followed by “You do not have access”.
Firestore streaming HTTP200 responses alone do not establish query authorization or CRUD.

The compiled Account and Item schemas have no authored grants. Firebase deliberately supports
a private account namespace without authored grants, but the authenticated runtime still invokes
the generic empty-grant default-deny gate. The earlier real replica/provider/runtime test passed
a connection directly to Data.Schema without the authenticated provider binding and therefore
did not exercise that gate. This integration defect is separate from the previously accepted
handwritten CRUD prototype and from the Account default-value repair. The required correction
is an explicit Firebase private-account provider policy, retaining grant-based default deny for
other providers and enforcing account identity, cancellation, and supported owner relations.
Actual authenticated binding, both-way UI synchronization, and native storage remain open.

A bounded managed-loop Firebase UI case is being added because the existing native interaction
case supports only Data MVP. It retains generation, process, target, and foreground identity
checks, records creation versus existing-account sign-in, and captures scoped diagnostic artifacts.
The owned loop also exposed a timed-out control long poll that strands shutdown; its transport
and identity-checked recovery require correction before a new controller can run the UI case.

The private-account policy now has focused authenticated binding, retained-row account-switch,
and fixture-actor denial coverage and independent source review. The fresh web app signed in
as the approved CRUD account and rendered its Item list, then created a uniquely labelled
acceptance Item. This is live web UI evidence; it does not prove native storage or synchronization.
The main sample account already exists in the selected project, but the supplied password was
rejected; no reset or extra account/project was attempted.

The Firebase host case's first real dispatch exposed a leftover Data MVP source guard, now
corrected with initial and per-action Firebase guards and9 focused dispatcher regressions.
The next attempt failed its native runtime-marker lookup before Firebase interaction, then
retained Appium server descendants. The original stopped loop's controller, services and
Simulator cleanup are now proved. The second loop remains fenced during driver recovery.

The ordinary Firebase probe wrapper previously pulled repository aliases into the app's
TypeScript program. It now runs the CLI implementation in a separate process with the original
wrapper URL and arguments; the app source check passes without excluding the wrapper.
The real --help wrapper regression passes with the other11 probe tests.

The bounded Firebase case now first signs the CRUD sample account into web and Simulator,
requires each surface to render the other's exact new Item, and writes private sync evidence only
after both observations. It then checks the second required sample account; a second-account
failure leaves the whole case failed while preserving the independently proved sync evidence.
Seven source fixtures and review cover these evidence boundaries, not actual hosted delivery.

Native attempts remain incomplete. A later owned session failed before Appium because process
ownership publication was refused. Its original cause was discarded; the controller now writes a
bounded, stage-labelled cause to the owner-only loop log while keeping the durable refusal and
public response generic. Controller tests cover failure publication and refusal of later commands.
A separate owned loop's retained driver cleanup is being recovered through an audited, exact-session
retirement operation. It preserves the original failed acceptance and proves recorded process/group,
listener, port, and Simulator closure before releasing reservations. The live attempts exposed
controller-disposal retry and real lsof field-format defects; source repairs do not imply completed
cleanup or a passing Firebase journey.

Read-only inspection ruled out a stale native payload on both owned Simulators: their installed
TaoCompanion.debug.dylib hashes match the cached build. The SDK57 factory/scene wiring matches the
installed Expo implementation. No speculative AppDelegate change was made; actual native startup,
SQLite, and web/Simulator synchronization are still unproved.

The driver-retained session645 retirement completed on 2026-10-05 at09:21UTC. Its private audit is
proved, all three recorded Appium port reservations were released, and the exact iPhone18ProMax
is independently confirmed Shutdown. The original failed acceptance/refusal remains recorded;
this cleanup result does not turn it into a passing app test. A later before-driver publication
refusal still holds the fresh app lock. A generic retirement extension was rejected by automatic
approval review before edits or signals; a narrower single-session proposal is under review.

The single-session before-driver recovery was reviewed, used only for the recorded3bae session,
and then removed from production source. Its first TERM allowed that controller's ordinary cleanup
to finish: the controller exited, its reservation was released, the Simulator was independently
confirmed Shutdown, and normal admission started a fresh session. Its retirement audit remains
retained because the operation encountered an unreadable Chrome process; no audit success was
fabricated. No source exception for a particular session or PID remains.

The fresh e94a Firebase host case again failed before Auth or Item interaction. The native marker
was absent, and the guarded diagnostic refused pixels at the foreground-bundle stage. The WDA
log reports SpringBoard foreground in the same second, suggesting a launch-handoff problem;
that is corroboration rather than the exact guarded foreground-query result. Private diagnostics
are being narrowed to record a finite foreground category while retaining all capture/input guards.
The e94a driver-retirement audit completed with proved recorded process/group/listener closure
and released its three Appium ports and Simulator reservation. Failed app acceptance remains failed.

A comparison attempt on an explicitly reserved iOS26.5 iPhone17Pro also failed the native marker
before Auth. It did not request diagnostic pixels because explicit targets are treated as borrowed.
Its driver, server, reservations and ordinary loop stop all have proved cleanup; that policy leaves
the explicit Simulator booted. The Developer's active iPhone17 was not used.

Installed XCUITest code confirms autoLaunch=false removes the WDA application bundle from session
startup. The previous loop launch therefore does not guarantee the app remains foreground after
WebDriver startup. The selected repair gives only the owned-Simulator Firebase host case explicit
startup authority for its pinned application, with no reset or termination, alert-aware foreground
detection, and unchanged full runtime-marker proof before UI actions. Generic managed attachment,
borrowed targets and Android retain their current startup policy. The repair still needs source
review and actual native acceptance.

### Owned Firebase startup retry — 2026-10-05 10:40 UTC

The scoped startup guard passed independent review and focused controller (64), mobile fixture (5), iOS opener (4), and Firebase subject (9) tests; the broad source check also passed. It permits startup only for the fixed Firebase case on a durably owned, booted iOS target, and rechecks the pinned source/config, runtime, controller and resource identities before and after session creation. Borrowed attachment keeps auto-launch disabled. Opening receipts record the startup operation before it runs. Full mounted runtime identity still gates all app interaction.

Actual session `9016a54d-f540-4cd4-95b8-2934c387494d` failed before sign-in. The private failure diagnostic now identifies `foregroundCategory: springboard`; its refusal captured no XML/pixels and performed no app input. Saved native test logs establish that Companion launched and reached Running Foreground, then a SpringBoard `Alert` caused the alert-aware foreground query to select Springboard. The startup repair worked for this launch; the alert's subject remains unknown. Do not assume local-network permission or automatically accept it. A bounded, owned-target-only read of alert text is being prepared to identify the needed action.

The driver and server closed, but final cleanup publication encountered a process-group liveness permission error. The first recorded retirement attempt retained its audit when a Chrome child had unreadable identity. Automatic approval review refused an immediate retry; subsequent read-only process queries showed the recorded processes absent and the controller disposed. The existing audited retry then completed with `retirementAudit.outcome: proved`, released the three driver ports and owned target, and independent Simulator inventory confirmed the F9 target Shutdown. The failed acceptance receipt remains failed; this cleanup evidence proves no app behavior. Artifact root: `.artifacts/host-acceptance/managed-loops/9966a643-d2ce-4cf9-b86d-5b455fca12f9`.

Native storage, web/Simulator synchronization and the required main-account sign-in remain unproved. The previously supplied main-account password was rejected; no reset or extra account was attempted. Landing remains conditional on the requested actual behavior.

### Source gates and blocked alert measurement — 2026-10-05 11:24 UTC

The bounded SpringBoard alert diagnostic passed driver (41) and artifact (40) tests, formatting, typecheck, lint and independent review. It permits only a guarded, session-scoped read of alert text after observing Springboard on the durably owned target. Text is limited to 4KiB and retained privately with mode0600; public failure metadata contains only a finite status. It never accepts or dismisses an alert and does not capture XML/pixels or interact with an unrelated foreground app.

The next real case on session `ee8a76aa-10d6-4258-a061-c1cb7af5d467` stopped before opening a driver: ownership capture returned a process-group `EPERM` for the recorded GoogleUpdater group9427. The normal stop command preserves this ownership refusal, so this loop and its owned F9 target remain retained. The alert's subject is still unmeasured. Do not call this acceptance, clear the refusal, or use the driver-retirement command: no mobile driver was opened for this session.

A new named read-only host diagnostic, `./agent unsandboxed processes group <pgid>`, uses fixed process-list arguments, validates a complete bounded snapshot and returns only the requested group's process IDs, user IDs and states. It accepts no arbitrary arguments and sends no signals. Focused dispatch (13) and permission (8) tests, setup, formatting, typecheck, lint and independent review passed. Actual group9427 inspection returned an empty group in a successful current snapshot. This establishes no member was reported now; it does not classify the earlier permission error. Apple kernel source permits such errors for all-zombie groups as well as inaccessible live members; the historical cause remains underdetermined. No command-name or UID exclusion was added to ownership checks.

Final integration review found no new source blocker. `verify-changed` passed48 suites, failed0 and skipped1; `verify` reused the matching green suite evidence and ran the remaining five gates successfully. The machine reported contention without timeouts. These are source gates, not native UI, SQLite, account-switch, hostile-server or synchronization evidence. No landing has occurred. A reviewable recovery confined to the exact stranded loop is being prepared; it must require fresh agreeing group/process/custody proofs before any signal, keep a durable cleanup audit and preserve the failed acceptance receipt.

### Exact retained-loop recovery blocked by approval review — 2026-10-05 11:38 UTC

The exact-session recovery proposal for `ee8a76aa-10d6-4258-a061-c1cb7af5d467` was prepared with the original 16-child/3-group manifest, controller identity, private control, canonical Firebase subject and singleton owned Simulator pinned. It required agreeing complete process-table, kernel-membership and group-liveness absence checks before any signal. A fresh bounded process-table snapshot again reported no member of group9427; this alone does not prove the required absence or classify the earlier `EPERM`.

Automatic approval review rejected the implementation that would admit this exception: it would terminate the recorded process scope and release a booted Simulator without explicit approval for that exact scope. No recovery invocation or signal followed the rejection. Temporary preparatory edits were removed; the production retirement path continues to admit only its retained-driver refusal. The original failed receipt, loop/project reservation and owned F9 target remain retained. Do not bypass this through raw process signals, receipt edits, another cleanup path or a relaxed ownership guard.

The remaining local intervention is approval of the concrete exact-session recovery proposal, followed by independent review and fresh custody/absence checks. The private proposal is `.artifacts/hosted-provider/ee8a-recovery-proposal.md`; it contains the full process manifest and cleanup boundaries. Native alert identification, app data loading and both-way web/Simulator synchronization remain unproved. The main sample account also rejected the supplied validation password in this selected project; changing or resetting that account is not authorized. Finish source review, exact-path commits and finalize independently, but do not land before the requested actual acceptance.

### Simulator storage and live synchronization — 2026-10-05 17:21 UTC

The approved exact-session recovery completed, and its temporary exception was removed. Subsequent owned loops stopped normally with proved driver cleanup and released reservations. The earlier recovery-approval block is superseded; no broader retirement permission was added. The Developer requested no further reviewer subagents, so subsequent changes are reviewed directly.

The misleading `expo-sqlite is not installed` error came from the adapter's deferred ESM import. SQLite57.0.3 was present in the native build. Capturing the asynchronous loader's original cause showed Metro trying to resolve an async module path relative to the disposable runtime directory. The Firebase native entry now selects the adapter's supported CommonJS export, whose deferred SQLite load uses `require`. This avoids the broken dynamic chunk path without changing vendor files or dependencies. Storage-instance failures retain their original cause, stage and a one-line warning that survives native logging of only the first argument.

Real UI acceptance now proves the CRUD sample account signs in, native account data loads, the Simulator creates a note observed in the browser, and the browser creates a note observed on the Simulator without reload. This was repeated in two attempts: `9f4ed1b3-9223-4474-94de-7ee40717251d` and `d93fe540-dec1-4cb0-9cc1-b8bf8fe1c42c` under `.artifacts/host-acceptance/managed-loops/`. Each keeps private `firebase-crud-sync.json` evidence with both exact row observations and screenshots. These observations prove creation and live propagation; they do not prove edit/delete, offline restart/replay, account isolation or direct hostile requests for the ordinary provider.

Test navigation also needed repairs. The exact Expo introduction is followed by a separate developer menu; both are now dismissed under the existing runtime identity and lease. Auth input stops on a visible data-load error. `#items` tags repeat per loop row, so the browser searches all item scopes; the native test finds its unique exact marker and scrolls within the leased app. Before switching accounts it scrolls back to the visible sign-out control. Missing controls are distinguished from transport and ambiguous-target failures. Focused tests cover menu handling, original causes, scrolling and custody revocation.

The latest complete attempt reached `native-main-signin` and failed with the visible message `The email or password is incorrect.` for the main sample account. The CRUD-sync evidence remains proved, while the overall two-account case remains failed. Driver cleanup and peer identity checks passed. The Developer must validate this account's current credentials locally; do not request a password in chat or reset the account. Earlier instructions pointing to stopped-loop URLs are superseded. The current owned session is `f964a8b3-f624-40e9-90be-5043524373bc`; consult its receipt for the current URL before giving a human step.

Conditional landing remains held while the required main-account gate is unresolved. Appwrite remains deferred until the Firebase ordinary flow is accepted; its live subscription fix still needs device/reconnect, offline restart/replay, account isolation and direct hostile owner/permission checks. Jazz, Convex and Pylon retain their separate gates.

### Hosted landing repair — 2026-10-06 07:04 UTC

The Developer authorized landing this slice after Preview SPEED, whose PR32 merged at
`cc75384b8b04fbfff1c4c2b45230dd920f757f05`. PR30's next Verify run37425780549
failed two Firebase test partitions and was cancelled immediately to release the remaining jobs.
The local host complement had passed all eight gates; that is separate from portable CI proof.

The source regressions now use synthetic public connection settings in isolated fixtures instead
of requiring an ignored local connection file. They exercise the same subject-check implementation,
including altered source/config rejection; the live wrapper retains its fixed reviewed fingerprint
and explicitly rejects the synthetic connection. Controller and attachment injections remain
internal source-test dependencies, and injected acceptance evidence remains labelled source regression.
No credentials or actual public project settings were copied into tracked fixtures.

Firebase provisioning ignores the exact authored `REPLACE_WITH_FIREBASE_PROJECT_ID` sentinel as a
saved association, while unavailable real saved project IDs still refuse setup. The creation and
cancellation tests now choose named prompt values. Focused subject, controller, connection and
provisioning tests passed. GitHub Verify must still pass before this repair is landed.

The landing authorization supersedes earlier conditional landing holds in this dated history. It
does not prove the remaining physical-device Companion controls, Firebase offline restart/replay,
two-device account isolation/switching, or direct hostile-server requests. Appwrite and the other
provider acceptance gates remain deferred. Local evidence and Developer-owned test apps are retained.

### Host complement retry — 2026-10-06 07:25 UTC

The portable repair passed stable-tree `verify-changed` before commit9e2a8097. Its hosted
Verify run37428884511 was automatically cancelled and auto-merge disabled when the local
complement failed two `studio-proof-real-app` checks: Snap publication and preview iframe
activation each timed out after30seconds. The other seven host gates passed; no portable test
failure was reported before cancellation. The failed complement receipt and browser snapshot
remain under `.artifacts/logs/verify-complement/2026-10-06T07-19-00-697Z-12661-cf9dcc9a/`
and `.artifacts/tests/studio-smoke/studio-proof-real-app/shard-8/`.

A separately invoked `studio-proof-real-app` retry passed all four real browser journeys with
no source change. Before that retry, the board reported no registered Tao lane and a free landing
lock; retained unrelated leases were left alone. This distinguishes the repeatable Firebase CI
fixture defect from an intermittently failing host proof, without establishing the timeout's cause.
No selector, assertion or timeout was weakened. The complete complement and hosted Verify must
both succeed on the next head before landing is claimed. The source and device acceptance limits
listed above remain unchanged.
