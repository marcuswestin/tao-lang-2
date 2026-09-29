# Hosted provider continuation

This handoff is for a new `feat/hosted-provider-free-tier-acceptance` branch created from the
committed tip of `feat/hosted-provider-candidates`. Read the [candidate roadmap](<Hosted data provider candidates.md>)
and the [Hosted CRUD guide](../../Apps/Hosted%20CRUD/README.md) before changing code.

## State at handoff — 2026-09-29

- The branch contains separate Jazz/Clerk, Convex/Clerk, and Pylon/PylonAuth provider pilots and an
  Expo Go Hosted CRUD comparison of Firebase Auth + RxDB and Appwrite Auth + Legend. The Hosted CRUD
  app is a standalone spike; it is not yet a Tao datasource or evidence for Tao `supports`.
- `./tao connect firebase 'Apps/Hosted CRUD'` now uses bundled Firebase CLI 15.32.0 and a local
  Google sign-in. It can create or reuse a project and web app, create default Firestore, enable
  Email/Password Auth, and deploy the pilot rules. It preserves manual Firebase snippet entry.
  The implementation was committed as `af11227c`; focused tests, typecheck, `verify-changed`, and
  `verify` passed on that tree. The packaged CLI returned its version with an isolated local config.
  None of that proves a real Firebase project or an iPhone run.
- `./tao connect appwrite 'Apps/Hosted CRUD'` configures an **existing** Appwrite Cloud project
  using its project API key: platform, email/password Auth, and TablesDB Notes. A project API key
  cannot create the project. A Partners organization key could create a project but would still
  require a separate project credential to configure resources. The guide describes the one manual
  project creation and key issuance step. There is no local Appwrite key file in the source checkout.
- The source checkout has one unrelated dirty tracked file, `Apps/Hosted CRUD/tao.connections.json`,
  owned by the Developer. It was never staged, reset, stashed, or inspected for this handoff.
  `./agent unsandboxed finalize` refused that dirty worktree. Do not carry its contents into the
  new branch implicitly or discard it. No Google token, service account JSON, or Appwrite key
  should be pasted into chat or committed.
- Firebase CLI login is kept in its own local user configuration outside the project. Appwrite's
  project key is stored in the ignored, owner-only `.tao/connect-secrets.json`, which is **not
  encrypted**. Public app identifiers go in `tao.connections.json`.

## Developer setup and first verification

Create a new managed worktree from the committed `feat/hosted-provider-candidates` tip, then a
named `feat/hosted-provider-free-tier-acceptance` branch there. Tell the Developer its exact
absolute path before asking them to run commands. In the new worktree, the Developer should run
the following with `<NEW_WORKTREE>` replaced by the path supplied by the new agent:

```sh
cd '<NEW_WORKTREE>'
./tao connect firebase 'Apps/Hosted CRUD'
./tao connect appwrite 'Apps/Hosted CRUD'
./tao connect run 'Apps/Hosted CRUD'
```

For Firebase, press Return at the config prompt to use automation, complete the browser sign-in
if needed, and press Return to create a new disposable project under a generated ID and again for the
default `nam5` Firestore region. If reusing an existing project, approve replacing its rules only after checking that the
pilot rules are appropriate. Do not select Firebase Hosting. For Appwrite, first create a free
serverless Cloud project and a scoped project API key using the steps in
[its guide](../../Apps/Hosted%20CRUD/src/appwrite/README.md); paste the key only into the CLI's
hidden local prompt. `./tao connect run` signs Expo CLI in to an Expo account if needed and launches
Metro; sign in to Expo Go on the iPhone with the same account, then scan the QR code on a reachable
network. No Apple Developer account is required for this Expo Go path.

The next agent should collect the exact command output and cloud resource IDs with secrets
redacted. If a command fails, fix the repository-owned defect and rerun the focused command before
claiming setup success. Do not silently replace an existing project's rules or tables.

## Acceptance work after setup

1. For **each** free-tier stack, measure first account to first synced note and record manual
   setup actions. On two devices, create/edit/toggle/delete notes and confirm updates in both
   directions. Then disconnect one device, queue create/update/delete, kill and relaunch Expo Go,
   reconnect, and verify durable replay and one final state on both devices.
2. Sign out and switch between two accounts, including while offline with cached rows. Check
   that notes from the other account never appear. Use direct Firebase/Appwrite client requests
   authenticated as the second account to attempt cross-account reads, writes, forged ownership,
   and deletes; record server responses separately from UI filtering. Examine Appwrite's
   client-controlled `ownerId` and whether its row permissions actually enforce isolation.
3. Inspect failures for missing Expo Go modules, authentication restoration, conflict handling,
   duplicate rows, partial sync, data leaks, and errors after an app restart. Compare actual
   setup effort and behavior, then recommend which stack is the easier first Tao experience.
   Record a failed gate as a finding; do not declare a Tao capability from this standalone app.
4. Keep the original Jazz/Convex/Pylon pilot gates separate. Jazz alpha.57 cannot currently
   reject a direct same-value write to a protected field based on submitted field intent, and
   server-enforced `(owned)` deletion remains unresolved; keep `supports { }`. Convex needs a
   disposable deployment and hosted direct-request/device proof. Pylon needs hosted deployment,
   native sign-in, direct-request proof, and full offline working-set/replay/account-switch proof.
   The [pilot findings](<Hosted data provider candidates.md#pilot-findings--2026-09-28>) have details.

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

After fixing any observed issue, run the **focused changed test** while editing, then the required
branch gates from the new worktree root. The new agent runs these repository commands; the
Developer need only run the interactive connect and Expo Go commands above:

```sh
./agent test-file packages/cli/tao-cli/cli-tests/connect-command.test.ts
./agent verify-changed
./agent verify
```

Use additional focused app/provider tests for whatever code actually changes. Never label a local
test, generated backend, native compile, or cached verification result as hosted/device/offline
proof. Stage and commit only reviewed changes made on the new branch. The connect flow may modify
the tracked public `tao.connections.json`; resolve its disposition with the Developer before
staging, restoring, or finalizing, and keep the ignored Appwrite key out of Git. With a clean
worktree and completed review, run `./agent unsandboxed finalize`. Landing the original
Jazz/Convex/Pylon slice requires all agreed hosted/native/offline gates and separate Developer
authorization; a failure should remain an explicit pilot finding on an unlanded branch.

Final completion means: a committed and reviewable new branch; a documented winner or bounded
failure for the Firebase/Appwrite first-experience comparison backed by real cloud, two-device,
offline-restart, and hostile-client evidence; accurate roadmap and app guides; required repository
gates passed; clean finalization if the Developer resolves connection-file ownership; and a clear
remaining-gate statement for Jazz, Convex, and Pylon. Do not claim provider readiness or land an
unmet required gate.
