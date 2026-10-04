# Hosted CRUD first-experience spike

This is one Expo Go notes app with two selectable hosted stacks:

1. Firebase email/password auth, RxDB with the MIT `@basepurpose/rxdb-sqlite` Expo storage, and RxDB's Firestore replication.
2. Appwrite email/password auth, free serverless TablesDB, Legend-State v3 generic CRUD sync, and AsyncStorage persistence.

Both paths offer account creation, sign-in, a list of notes, create, text edit, completion toggle, delete, and sign-out through the same screen. This standalone app checks library and setup fit before either path becomes a Tao datasource. Its source is a spike, not a declaration of Tao `supports` capabilities.

## Configure

Run the guided `tao connect` flow from the repository root for each stack. Firebase uses the official CLI's Google sign-in to create or reuse a project and web app, create Firestore if needed, enable Email/Password auth, and deploy the pilot rules. Appwrite uses the official CLI's browser sign-in the same way, creating or reusing a project and configuring its platform, auth, and Notes table with a short-lived key it never stores. Follow the provider-specific [Firebase](src/firebase/README.md) and [Appwrite](src/appwrite/README.md) setup notes. Public identifiers are written to [tao.connections.json](tao.connections.json); only Appwrite's optional manual path saves a setup key, separately under the ignored `.tao/` directory, and it is never bundled into the app. That file is owner-only but not encrypted. Firebase CLI keeps its Google login outside this project in its local user configuration; Tao does not store it or request a pasted token. Never put service-account credentials, admin API keys, or test passwords in the public config. The two backends have separate accounts, so use the same test email and password for both when comparing the flows.

From the repository root, run:

```sh
./tao connect firebase 'Apps/Hosted CRUD'
./tao connect appwrite 'Apps/Hosted CRUD'
./tao connect run 'Apps/Hosted CRUD'
```

`tao connect run` offers one compact Actions line: `r` reload, `i` iOS Simulator,
`a` Android emulator, `c` Show connection, `d` Device (Android/iPhone), and `q` quit.
The QR is hidden until you press `d` for Device; any required Expo account guidance appears there.
Before that, `c` shows only the address. Afterward, it reprints the QR.
The Android emulator action asks Expo to open the app locally; its real-emulator acceptance remains
pre-MVP work in A22. Other CLI choice prompts use the shared numbered menu and Enter default.

`tao connect run` replaces Expo's terminal screen with its own: Expo's Expo Go address as a QR code, bundling progress and errors, app logs, and the compact Actions line above (`?` remains a connection-display alias). Scan with the iPhone camera, or from inside Expo Go on Android, to open the app. The phone and development machine must be able to reach the Metro server. No Apple Developer account is needed for this path, but Expo Go on a physical iPhone opens a development server only when Expo CLI and the Expo Go app are signed in to the same free Expo account; `tao connect run` checks the Expo CLI account, gives local sign-in guidance when needed, and names the account to use in Expo Go. The iOS Simulator does not need the account. Choose a provider on the first screen, then create an account and perform the same CRUD steps. Each provider keeps its own session, so switching providers needs no sign-out.

The development sign-in screen temporarily includes **Fill email + password** for validation.
It fills sample values only and does not submit authentication. Existing accounts still use their
locally entered credentials. Remove the helper once validation is finished.

## Comparison protocol

Record elapsed time and distinct setup actions from a fresh provider account to the first synced note. Then test each stack in this order:

1. Create and edit a note on one device; observe the change on a second signed-in device.
2. Disconnect one device, create/edit/delete notes, kill and relaunch Expo Go, and reconnect. Verify the final state on both devices.
3. Sign out and sign in as a different account. Verify no prior account notes appear, including while offline.
4. Attempt direct SDK reads and writes as a second account. Verify the backend rejects cross-account access.

Record any native module failure, partial sync, duplicate row, conflict, data leak, or setup step requiring privileged credentials. Local typechecks or simulator runs alone do not establish the iPhone, offline restart, or hostile-client results.

## Direct hostile-request evidence

After the device comparison steps, run this from the repository root in a normal local terminal:

```sh
bun run "Apps/Hosted CRUD/scripts/hostile-probe.ts"
```

Use two existing test accounts per provider. Enter passwords only at the hidden terminal prompts;
never put them in chat, command arguments, or connection files. The script allows only the existing
pilot projects, including Appwrite `tao-hosted-crud-160214`, and does not provision accounts or
projects. It modifies only randomized probe rows, records actual HTTP responses independently of
UI filtering, and reports cleanup status in `.artifacts/hosted-provider/`. Firebase tombstones may
remain under the pilot's no-hard-delete rules; the report lists them.

Same-owner controls must pass before foreign-row denials count. Authentication, transport, and
ambiguous responses remain inconclusive. Appwrite forged `ownerId` and explicit permission grants
are checked separately from ordinary foreign-row reads/writes. The script's local mock tests do
not establish hosted isolation; retain the actual server report with the device observations.
