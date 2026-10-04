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

### Decisions waiting on the Developer

1. Whether to land this branch once the evidence and gates are done.
2. Whether the dev loop should get the same run screen. It is an unchecked A22 item, together with
   a test that starts real Metro and checks the event and URL shapes so that an Expo upgrade fails
   loudly.
3. The provider-dependency install policy described under "Later" below.
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

The selective provider-dependency installation policy and A21 public connection-file placement
need Developer decisions before changing dependencies or the generated-app configuration flow.
Sharing the run screen with the dev loop and landing remain pending decisions. Landing still requires explicit authorization for the slice.
