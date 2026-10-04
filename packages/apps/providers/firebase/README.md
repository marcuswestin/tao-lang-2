# Firebase private account data

This development provider pairs `FirebaseAuth` email/password sessions with a private Firebase
store. It uses the existing Tao auth and datasource contracts. Firebase owns authentication;
RxDB records local rows and tombstones, with SQLite on native and IndexedDB/Dexie on web.
Live Firestore replication forwards local changes and observes incoming changes.

Public connection settings belong to the owning project's ignored `.tao/local/connections.json`.
`tao connect firebase` records those settings locally. It does not configure Authentication,
create Firestore, or deploy rules for ordinary Tao projects. The Developer completes account
sign-ins locally. Never put passwords, server keys, or service account files in this config.

The first supported flow is a private, relation-free store with scalar fields and a locally
bootstrapped Account whose ID is the Firebase UID. Authenticated Tao stores already generate
cryptographic UUID row IDs. Local database names include the Firebase project, store, and UID;
remote rows live under `users/{uid}/stores/{store}/{entity}/{id}`. Sign-out closes replication
and the account connection; persisted account rows remain on the device for later offline use.
The replica is not encrypted. Local cache custody is distinct from remote authorization.

`tao firebase generate` derives Firestore rules from the compiled store. Writes require the
signed-in UID's path and the declared row shape; RxDB deletion uses tombstones, and hard deletes
are denied. Review and combine generated rules with existing project rules before deploying:
Firestore rules deployment replaces project-wide rules. A shared Firebase project can contain
other apps, including the standalone Hosted CRUD pilot.

General authored access grants, unique fields, references, broad relations, and migrations are
not advertised. Unsupported shapes fail during generation or connection. The private scope does
not establish general provider conformance.

## Evidence boundaries

The Developer accepted the standalone Firebase + RxDB manual tests as enough to continue into
this Tao flow. Source tests cover Tao's configuration, snapshot mapping, lifecycle, and generated
rules. They do not prove the new app's hosted or device behavior. Repeat two-device create/edit/
toggle/delete, offline restart and replay, and account switching (including offline) on the
CLI-created app. Keep direct hostile server requests separate from UI filtering.

The earlier standalone hostile probe was inconclusive because the second Firebase account did
not authenticate. It made no hostile requests. Server authorization still needs direct evidence
against the deployed rules. Appwrite debugging is deferred; Jazz, Convex, and Pylon acceptance
remain separate.

This checkpoint uses repository development tooling and built-in stdlib provider resolution.
Installed standalone CLI packaging and selective per-provider installation remain separate work;
no standalone Firebase runtime acceptance is claimed.
