# Firebase + RxDB spike

This adapter uses Firebase email/password Auth, an RxDB database in Expo SQLite per Firebase project and UID, and live bidirectional replication with Firestore. Notes are stored at `users/{uid}/notes/{noteId}`. The RxDB plugin stores the local `id` as the Firestore document ID, not a field. CRUD writes go to SQLite first; RxDB replays them when replication can reach Firestore. Firestore's own persistence is not enabled in React Native.

1. Create a disposable Firebase project. Enable Email/Password sign-in and Cloud Firestore.
2. Run `./tao connect firebase 'Apps/Hosted CRUD'` from the repository root. It writes public web config to `tao.connections.json`; service-account credentials stay out of the app bundle.
3. Deploy `firestore.rules` as the project's Cloud Firestore rules. These rules give each authenticated UID access only to its notes subcollection and require RxDB tombstones and server timestamps. Do not merge them blindly into a project with other collections; compose and test the full ruleset first.
4. Run the Expo Go app, register two accounts, create/update/delete notes, force-stop while offline after a write, restart, reconnect, and verify both accounts on separate devices. Also try direct Firestore writes into the other UID's path to test the rules.

The local SQLite database remains on the device after sign-out, keyed by project and UID. It is not encrypted. The adapter closes its active replica on sign-out, but the Firebase Auth SDK can switch accounts outside this adapter; the app should route all account changes through it. This is a spike: hosted rules, iOS Expo Go behavior, durable offline replay, conflicts, and cross-device isolation still need live verification.

References: [RxDB Firestore replication](https://rxdb.info/replication-firestore.html), [Firebase React Native support](https://firebase.google.com/docs/web/environments-js-sdk), [Firebase Auth persistence](https://firebase.google.com/docs/reference/js/auth), [community SQLite adapter](https://github.com/basepurpose/rxdb-sqlite).
