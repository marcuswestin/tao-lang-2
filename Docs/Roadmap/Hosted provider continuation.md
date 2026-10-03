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
    - Expo's own Expo Go URL, from `GET /_expo/open?platform=ios` with an `Origin` header, as a QR
      code.
    - Per-platform bundling progress.
    - Bundling errors with file, line and column.
    - `client_log` lines.
  - Keys: `r` reloads (`/message?method=reload`); `i` opens the iOS Simulator
    (`POST /_expo/open?platform=ios`); `?` reprints the code; `q` or Ctrl-C stops the process tree.
  - It takes a free port when 8081 is busy.
  - When Expo stops early, it prints Expo's output tail and writes it to `.tao/connect-run/expo.log`.
  - Verified so far: against real Metro headlessly (QR, URL, bundle event, reload, stop) and by
    focused tests.
  - **Not yet verified on a device or in the Simulator.** The Developer's first try hit a busy port
    8081, which led to the free-port fix; it has not been retried since.
- **Spike findings** behind the screen are recorded under A22. Expo's `/events` socket is broken,
  and `CI=1` disables watching. The reporter hook depends on Expo internals.

### Not done

1. **Developer device checks of the new run screen** (the steps below).
2. **Acceptance evidence for both stacks** ("Acceptance work after setup" below): two devices,
   offline restart, account switch, and direct hostile requests. None of it has been collected yet.
3. **A hostile-request probe script.** It authenticates as one test account and attempts
   cross-account reads, writes, forged `ownerId`, and deletes against Firebase and Appwrite
   directly. The Developer types the test accounts' passwords locally; never ask for them in chat,
   and never create cloud accounts or enter passwords yourself.
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

1. **iPhone:** type `yes`, then scan the QR code with the camera.
   - a. **Verify:** `iOS bundled in …s` appears and the app opens in Expo Go.
   - b. Press `r`. **Verify:** `Reloading connected apps.` appears and the app reloads.
   - c. Add `console.log('hi')` to `src/App.tsx`. **Verify:** `app log: hi` appears.
   - d. Break the syntax. **Verify:** `Bundling failed in …:line:col` appears with a code frame.
     Undo both edits.
   - e. Press `q`. **Verify:** `Stopped Metro.` appears.
2. **Simulator:** rerun the command and press Return at the question. **Verify:**
   `Opened Expo Go in the iOS Simulator.` appears and the app runs there.

If `connect firebase` or `connect appwrite` must be rerun, press Return to reuse the existing
projects. Do not create new Appwrite projects; the Free plan limit is already reached.

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
