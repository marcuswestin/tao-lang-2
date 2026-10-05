# Hosted data provider candidates

The slice after provider pairing lands: evaluate hosted data and auth services as Tao providers,
sort them into Tier 1 and Not now, and implement the Tier 1 providers where the evaluation finds a
fit. The Developer set this direction on 2026-09-27.

Instant Cloud closed new signups and shuts down on 2027-08-31 ([Plan — Auth and data
pairing](<Plan - Auth and data pairing.md>)), so Tao needs hosted providers besides InstantDB.

## Evaluation — 2026-09-27

The Developer selected Jazz, Convex, and Pylon for the first implementation round on 2026-09-28,
then placed an Expo Go first-experience spike for Firebase/RxDB and Appwrite/Legend ahead of further
provider work. The spike compares the same generic CRUD app with each hosted service's own auth.
The other tiers remain recommendations. Primary documentation was checked on 2026-09-27, with Pylon's new
release rechecked on 2026-09-28. Local pilot tests cover parts of the adapters; no hosted/native
conformance run has proved the candidate capabilities. `supports` must hold for every writer,
including hostile clients and offline replay.
The Developer confirmed that a managed provider may execute Tao-generated policy and write code;
Tao or the app author must not have to host an application server. Prices are dated snapshots, not
cost estimates for a Tao app.

| Candidate         | Proposed tier    | Decisive point                                                                                                       |
| ----------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| Jazz              | Tier 1 pilot     | Selected for first round; hosted sync, external JWT and server policy fit, while native client and Jazz 2 are alpha. |
| Pylon             | Tier 1 pilot     | Selected for first round with PylonAuth; policy, session, offline and device proof gate landing.                     |
| Zero              | Not now          | Production requires an app query/mutate API server.                                                                  |
| PowerSync         | Not now          | Strong offline subset fit, but queued writes require an app backend.                                                 |
| Convex            | Tier 1           | Selected for first round; managed backend and native client fit online data with Clerk pairing.                      |
| Firebase + RxDB   | Expo Go spike    | Firebase Auth and RxDB Firestore replication may give one-service hosted auth plus offline notes.                    |
| Appwrite + Legend | Expo Go spike    | Appwrite Auth plus Legend-State generic CRUD may offer a simpler first setup; sync details need proof.               |
| LiveStore         | Not now          | Auth, authorization and sync authority require authored infrastructure.                                              |
| Electric          | Not now          | Read replication needs a separate authorized write path.                                                             |
| Ditto             | Not now          | Per-user auth requires an authored webhook; policy is narrower than Tao's.                                           |
| Automerge         | Not now          | A CRDT engine without hosted account or policy authority.                                                            |
| RxDB              | Not now; revisit | Tao provider conformance is unproved; a free community Expo SQLite adapter now merits an iPhone storage spike.       |

### Jazz

Jazz Cloud hosts sync and policy without an app server. Its external JWT flow resolves exact `iss`
and `sub` to a Jazz account; a Tao datasource accepting Clerk's `IdentityToken` is plausible. Jazz's
local-first account is not automatically a Tao auth provider. Relations, access rules, field updates,
offline sets and additive migrations are _conformance candidates_, while global uniqueness and
membership rules remain open. React Native/Expo needs `jazz-tools`, native `jazz-rn`, New Architecture
and a development build; Expo Go is unsupported. The native relay's own README says physical
two-runtime communication remains an acceptance gap. Jazz 2 and its native client are alpha, source
is MIT, and production Cloud pricing was not confirmed. Start with a bounded Clerk-paired pilot.
[Client and Cloud](https://jazz.tools/docs/install/client),
[native install and acceptance](https://github.com/garden-co/jazz/tree/main/crates/jazz-rn#readme),
[JWT identity](https://jazz.tools/docs/auth/authentication),
[permissions](https://jazz.tools/docs/auth/permissions),
[schema](https://jazz.tools/docs/schemas/defining-tables),
[source](https://github.com/garden-co/jazz).

### Pylon

Pylon could supply both datasource and auth: its own revocable session suggests
`issues { Session }` and `accepts { Session from PylonAuth }`; external `IdentityToken` acceptance
needs proof. Pylon Cloud hosts its backend. Its Expo client documents a replica in AsyncStorage,
but the installed 0.20.0 native client keeps pending mutations in memory across a forced restart;
durable offline replay needs an adapter-owned outbox or an upstream fix. The documented policy DSL includes relation membership, field ownership, uniqueness,
and pre/post update checks on raw write routes. These are stronger foundations for Tao conformance
than the initial evaluation credited, though Tao account isolation, native reliability, and every
declared guarantee remain unproved. Dependencies include `@pylonsync/sdk`, `@pylonsync/react`,
`@pylonsync/react-native`, AsyncStorage and NetInfo. Source is MIT/Apache-2.0; Cloud advertises a
free start without a confirmed numeric production price. [React Native](https://docs.pylonsync.com/clients/react-native),
[auth](https://docs.pylonsync.com/auth/overview), [policies](https://docs.pylonsync.com/concepts/policies),
[entities](https://docs.pylonsync.com/concepts/entities),
[Cloud](https://docs.pylonsync.com/cloud), [source](https://github.com/pylonsync/pylon).

"Pre-1.0" means the [project README](https://github.com/pylonsync/pylon/blob/main/README.md) says
its usable API may still change; it does **not** mean there is no
working release. [v0.20.0](https://github.com/pylonsync/pylon/releases/tag/v0.20.0) shipped late
2026-09-27 Eastern (2026-09-28 UTC). Its [security notes](https://github.com/pylonsync/pylon/blob/main/SECURITY.md) call out
in-memory sessions by default, per-process rate limits, and an experimental Workers deployment;
[recent fixes](https://github.com/pylonsync/pylon/compare/v0.19.0...v0.20.0) include policy scope
and cross-tenant write repairs. Server functions bypass raw row policies, so Tao-generated functions
would need equivalent authorization checks. The Developer selected Pylon for the first **evaluation
pilot**, paired with PylonAuth: test hosted Expo/device sign-in, owner spoofing, membership, unique constraints,
offline replay, migration, restoration and sign-out before committing to shipping it.

### Zero

Zero is a datasource candidate, not an auth provider; a separate app API would accept bearer or
cookie identity. Its React Native/Expo SQLite adapter supports local queued mutations, but
production requires `zero-cache`, Postgres and an app query/mutate API server that owns writes and
authorization. Relations, field updates, offline and policy would need whole-stack conformance.
The required app server fails this slice's bar. Client and server are Apache-2.0 and self-hostable;
no managed option removing that API was confirmed. [React Native](https://zero.rocicorp.dev/docs/react-native),
[auth](https://zero.rocicorp.dev/docs/auth), [installation](https://zero.rocicorp.dev/docs/install),
[self-hosting](https://zero.rocicorp.dev/docs/self-host),
[license](https://zero.rocicorp.dev/docs/open-source).

### PowerSync

PowerSync is a datasource, with accepted `IdentityToken` dependent on a chosen source backend; it
issues no Tao proof. Its streams replicate selected rows to offline SQLite, so `Offline` is a strong
candidate. PowerSync Cloud hosts sync, but the React Native/Expo connector must obtain credentials
and upload queued writes to an app backend, which validates them and updates a separate source
database. Relations, uniqueness, access rules and migrations belong to that whole stack. The
mandatory app backend fails the present hosted bar. Cloud advertises a free tier and Pro from
$49/month; clients are Apache-2.0, while self-hosted service licensing uses the Functional Source
License. [Architecture](https://docs.powersync.com/intro/powersync-overview),
[client](https://docs.powersync.com/architecture/client-architecture),
[React Native](https://docs.powersync.com/client-sdks/reference/react-native-and-expo),
[pricing](https://powersync.com/pricing), [licensing](https://powersync.com/legal/licensing-terms).

### Convex

Convex Cloud hosts data and application functions, so Tao could generate policy/write functions
without an app server. The datasource can accept an OIDC `IdentityToken`, starting with Clerk.
Convex Auth is a possible separate auth provider, but is beta and its Tao proof kind is unexamined.
Reactive queries and serializable server transactions make relations, unique constraints, access
rules, field updates and additive migrations possible _implementations to test_, not declarations.
Its docs cover reconnect and optimistic updates, not durable offline working sets: do not declare
`Offline`. React Native uses the `convex` client. Cloud has a free/usage-based Starter path and
Professional advertised at $25 per developer/month; its self-hosted backend uses FSL-1.1 with an
Apache-2.0 future license. The first slice would need the `convex` dependency, with
`@convex-dev/auth` deferred to a distinct auth decision.
[React Native](https://docs.convex.dev/client/react-native),
[auth](https://docs.convex.dev/auth/overview), [Convex Auth](https://docs.convex.dev/auth/convex-auth),
[client behavior](https://docs.convex.dev/client/react/overview),
[transactions](https://docs.convex.dev/database/advanced/occ),
[pricing](https://www.convex.dev/pricing),
[self-hosting and license](https://github.com/get-convex/convex-backend?tab=License-1-ov-file).

### LiveStore

LiveStore is a datasource layer and issues no Tao proof. It supplies neither auth nor authorization;
an authored backend would validate an `IdentityToken` and enforce sync policy. Its Expo adapter
supports iOS/Android persistent SQLite and offline use but requires New Architecture,
`expo-sqlite`, `expo-application` and LiveStore packages; Expo Web is unsupported. The Cloudflare
sync example still requires deployed app policy code. Local relations/updates and `Offline` need
testing; global uniqueness, access/membership rules and migrations lack an owned authority here.
It is beta, Apache-2.0, and documents unimplemented sync conflict handling and compaction; no
managed authoritative-service price was identified. [Expo](https://docs.livestore.dev/platform-adapters/expo-adapter/),
[auth](https://docs.livestore.dev/patterns/auth/),
[Cloudflare sync](https://docs.livestore.dev/sync-providers/cloudflare/),
[status](https://docs.livestore.dev/misc/state-of-the-project/),
[sync](https://docs.livestore.dev/building-with-livestore/syncing/),
[source](https://github.com/livestorejs/livestore).

### Electric

Electric is a read-side datasource component: an app proxy/gatekeeper would verify a bearer token
and constrain shapes, while Electric issues no proof. Electric Cloud can host Postgres shape
replication, and Expo can use `@electric-sql/client`/`@electric-sql/react`; PGlite does not yet work
in React Native. Electric explicitly leaves writes to another API or stack, so Tao's write, access,
uniqueness, migration and offline guarantees cannot come from Electric alone. Its managed pricing
advertises $1 per million writes plus retention; Apache-2.0 source is self-hostable. Revisit only
with a concrete hosted Postgres/write/auth combination. [Sync](https://electric.ax/docs/sync/),
[auth](https://electric.ax/docs/sync/guides/auth),
[writes](https://electric.ax/docs/sync/guides/writes),
[Expo](https://electric.ax/docs/sync/integrations/expo),
[pricing](https://electric.ax/pricing), [source](https://github.com/electric-sql/electric).

### Ditto

Ditto is a datasource, while its device certificates/JWTs are internal credentials rather than Tao
auth proofs. Production per-user auth requires an app-authored, deployed webhook, which could verify
Clerk but fails the hosted bar. React Native/Expo offers subscriptions, local writes and peer sync,
making `Offline` plausible. Its permissions are keyed to immutable document `_id`, so Tao field
updates and relation-path membership rules need an unproved translation; offline shared-key mode
has no per-user permissions. Ditto Cloud hosts sync, with a free tier listing ten cloud device
connections and 2 GB; self-managed deployment is Enterprise and the SDK is commercial.
[React Native](https://docs.ditto.live/sdk/latest/quickstarts/react-native),
[sync](https://docs.ditto.live/key-concepts/syncing-data),
[auth](https://docs.ditto.live/key-concepts/authentication-and-authorization),
[Cloud](https://docs.ditto.live/cloud/overview), [pricing](https://www.ditto.com/pricing).

### Automerge

Automerge is an offline CRDT engine, not a hosted datasource or auth provider. It issues no proof;
an authored service would own identity, Account resolution and policy. It has WebSocket adapters,
but no hosted account/policy service or documented React Native persistent adapter was found.
Central uniqueness, access/membership rules and Tao `Offline` completeness remain unproved. Expo
would require core/Repo plus selected storage and network packages. Its JS package is stable, source
is MIT, and self-hosting means assembling infrastructure; no managed-service price was identified.
[Overview](https://automerge.org/docs/hello/),
[networking](https://automerge.org/docs/reference/repositories/networking/),
[storage](https://automerge.org/docs/reference/repositories/storage/),
[packages](https://automerge.org/docs/reference/the-js-packages/),
[source](https://github.com/automerge/automerge).

### RxDB

RxDB is a datasource layer, not auth. Supabase Auth might issue a usable `IdentityToken` or
provider-specific `Session`, but the pairing and Supabase RLS rules need design. Its direct Supabase
plugin documents two-way mobile sync without an app server, realtime and RLS; it requires string
primary keys, simple top-level fields, modification timestamps and soft deletes. `Offline` is
plausible, while Tao relations, global uniqueness, field/membership rules and additive migrations
need Supabase-backed conformance. React Native SQLite storage exists. The official premium SQLite
path carries a license cost, but the MIT [BasePurpose Expo adapter](https://github.com/basepurpose/rxdb-sqlite)
offers a free route; its status lists Android device verification and iOS tests without device
verification. The [RxDB Firestore plugin](https://rxdb.info/replication-firestore.html) supplies
push/pull replication with soft deletes and a server timestamp convention. Those two libraries are
being spiked together with Firebase Auth; compatibility, durable replay, security rules, and Tao
capability fit remain unproved. Core is Apache-2.0. [Supabase](https://rxdb.info/replication-supabase.html),
[sync](https://rxdb.info/replication.html), [SQLite](https://rxdb.info/rx-storage-sqlite.html),
[source](https://github.com/pubkey/rxdb).

## Expo Go first-experience spike — 2026-09-28

For the next branch's setup, hosted acceptance, repository checks, and completion criteria, use
the [continuation handoff](<Hosted provider continuation.md>).

The Developer approved `firebase`, `rxdb`, `@basepurpose/rxdb-sqlite`, `expo-sqlite`,
`@legendapp/state`, `react-native-appwrite`, `react-native-url-polyfill`, and AsyncStorage, plus
installation dependencies. [Hosted CRUD](../../Apps/Hosted%20CRUD/README.md) gives the two stacks
one notes UI and a common comparison protocol. This standalone Expo Go app isolates first-run
library and project setup; it does not yet constitute Tao auth or datasource declarations and does
not claim `Relations`, `AccessRules`, `FieldUpdates`, or `Offline` support.

`tao connect firebase` now uses the official Firebase CLI's Google sign-in to create or reuse a
project and web app, create the default Firestore database if absent, enable Email/Password auth,
and deploy the pilot rules. It asks before replacing existing Firestore rules. The Developer
approved `firebase-tools` and its installation dependencies for this automation. `tao connect
appwrite` now uses the bundled Appwrite CLI and local browser sign-in to reuse a project and
configure its platform, auth, and TablesDB resources with a 15-minute ephemeral key it never stores.
For this comparison, reuse `tao-hosted-crud-160214`; the Developer's Free-plan organization already
uses both project slots. The optional manual path still takes a project API key.
The two commands record public client settings, but neither wires an ordinary Tao data declaration
to these providers. Firebase's web API key is public client configuration, and Firebase CLI's
Google login stays in its local user configuration outside the project. Only the optional manual
Appwrite path saves its setup key in an ignored, owner-only local file; it is not encrypted.
The Appwrite spike initially polled for changes. A dedicated authenticated SDK Realtime
subscription is now prepared, with device acceptance deferred. Its `ownerId` field is client-controlled; provider-enforced
row permissions and direct hostile requests still need hosted proof.

The free-tier Appwrite comparison uses serverless TablesDB and its typed rows. DocumentsDB requires
dedicated compute on the current pricing page, so the pilot's initial DocumentsDB setup was replaced
before hosted testing. The installed React Native SDK exposes the TablesDB row API.

The decision needs a physical iPhone run against disposable projects: account creation and restore,
two-device CRUD, queued offline create/update/delete across an app restart, reconciliation,
cross-account cache isolation, and direct hostile backend requests. Measure project creation and
configuration steps and time to first synced note. A green typecheck or bundle is a narrower result.

### Acceptance evidence in progress — 2026-10-03

The evidence branch starts at `0575e5d80`. The Developer's earlier iPhone sign-in/basic CRUD
confirmation covers both stacks. The Developer later reported all Firebase manual tests passed
and chose Firebase for continuation. Compact QR and shutdown acceptance remain separate
run-screen checks; Appwrite host debugging and direct-request authorization remain unresolved. The prepared
`Apps/Hosted CRUD/scripts/hostile-probe.ts` records direct HTTP observations, including Appwrite
owner forgery and row permission grants, independently of UI filtering. Local mocked tests and
typecheck passed. The first Developer-run server report was inconclusive at authentication
and made no hostile requests; the continuation decision below records its responses.

**First-experience recommendation:** continue with Firebase, as the Developer accepts its
manual tests and live sync worked while Appwrite incoming sync failed. A measured setup-time
comparison and direct server-authorization proof remain unmet. The Expo CLI/Expo Go same-account requirement on a
physical iPhone is an observed cost shared by both stacks in this spike. This sequencing
recommendation does not establish Tao capability conformance. The Jazz, Convex, and Pylon pilot gates below remain separate.

## What the evaluation decides for each candidate

1. Whether it can be a datasource provider, an auth provider, or both, and which sign-in proofs it
   would issue or accept under the pairing protocol (`issues` and `accepts`).
2. Which data capabilities it can honestly declare (`supports`), and what Tao's conformance suite
   would need to prove for each.
3. Whether an app can run against it with no server Tao or the app author hosts, which is the bar
   InstantDB met.
4. React Native and Expo support, offline behavior, and how a client authenticates.
5. Maturity, licensing, pricing, and self-hosting, and whether a dependency is needed. A new
   dependency needs the Developer's approval.

Tier 1 means a great fit worth implementing now. Not now keeps the candidate listed with the reason,
so a later pass can revisit it.

## Pilot findings — 2026-09-28

- **Jazz/Clerk Auth Review is blocked.** Jazz alpha.57 update policies see old and new row values,
  but not the fields submitted by a direct writer. A same-value patch to a protected `Owner` or
  `CreatedAt` field can pass a value-comparison rule, violating Tao's explicit write-intent and
  `FieldUpdates` contract. Auth Review now permits deleting the current Account, which makes its
  `(owned)` Notes and Note-owned details cascade another required server-enforced behavior Jazz
  cannot yet guarantee.
  Keep `supports { }` and the Jazz transport experiment; restore the Auth
  Review variant only after a server-enforced field/relationship design passes hostile direct
  requests. The [Jazz permission documentation](https://jazz.tools/docs/auth/permissions)
  describes the old/new value checks. This unresolved required gate blocks landing the three-provider
  slice. The generated Expo host, JazzRn module and Tao Companion compiled for iOS Simulator, but no
  Jazz Cloud deployment, app launch, sign-in, two-device journey or offline journey ran.
- **Convex/Clerk remains an online pilot.** Local generated-function tests cover per-field writes
  and owner policy, including direct hostile relation links and required-field writes. Auth Review
  backend source was generated; Convex code generation and deployment require a disposable Convex
  project. Hosted direct requests, two-device native journey and account lifecycle are still
  required. No Tao `Offline` capability is declared.
- **Pylon/PylonAuth remains an online pilot.** Its generated managed functions enforce submitted
  fields while generated raw policies deny direct writes. Generated Auth Review backend source
  compiles in a workspace with `@pylonsync/functions` and `tao-pylon`; a Pylon Cloud project must
  include those dependencies and configure a trusted origin before deployment. The native 0.20.0
  mutation queue is not durable through app restart. An encrypted account-scoped outbox has local
  simulated-restart coverage, while hosted offline working-set completeness, account switching and
  queued replay remain unproved. Do not declare Tao `Offline` or land until those gates pass.

## Sequence

1. Implement Jazz, Convex, and Pylon in the first work round, with a separate reviewable provider
   slice for each. Include pairing declarations, conformance checks for every declared capability,
   and an Auth Review journey. Start Jazz and Convex with Clerk's existing `IdentityToken` path;
   start Pylon with PylonAuth's `Session` path. Complete hosted online paths first, then prove Jazz
   and Pylon's declared offline scopes before proposing a landing.
2. The Developer approved the named SDK dependencies on 2026-09-28: `jazz-tools@alpha`,
   `jazz-rn@alpha`, `convex`, `@pylonsync/sdk`, `@pylonsync/react`, and
   `@pylonsync/react-native`, plus dependencies required by their installation. The Pylon generated
   functions require `@pylonsync/functions@0.20.0`, now a direct provider dependency. The native `jazz-rn`
   package must be a direct Expo app dependency for autolinking. Use `./agent setup
   --refresh-lockfile` after manifest edits.
3. **Auth follow-up:** investigate Jazz's local-first account/session and
   [Convex Auth's beta mobile password/OTP flows](https://docs.convex.dev/auth/convex-auth) against
   Tao's `issues`/`accepts`, Account resolution, restoration,
   renewal and logout interface. If each fits, implement its provider-native Auth provider with
   pairing declarations and an Auth Review journey. `@convex-dev/auth` belongs to that later
   conditional auth follow-up. Jazz's local-first account must not be
   assumed to be a Tao sign-in proof until this is proven.
4. Pylon–Clerk pairing is a later follow-up. Pylon's policy, session, offline and native behavior
   need Tao conformance and hosted-device evidence before landing this pilot.

### Device finding — 2026-10-04

The Developer reports Appwrite + Legend sign-in and notes appearing on an iPhone and the iOS
Simulator after switching screens or reloading. Incoming notes do not appear live, so realtime
sync is a failed gate; host debugging is deferred until the Firebase Tao flow works. This establishes neither full two-device CRUD nor
offline restart/replay, offline account isolation, or direct-request authorization. A first-experience
timing comparison remains unmeasured; the Jazz/Convex/Pylon gates remain separate.

The Developer initially confirmed Firebase + RxDB realtime sync in the iPhone/Simulator check,
then reported all Firebase manual tests worked. This is Developer-reported evidence for
continuation; direct hostile-request authorization remains separate.

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

The first Tao flow targets private account-scoped Notes with full CRUD through existing
auth/data contracts. General authored access grants and provider capability conformance remain
separate proof obligations. The Developer approved the existing all-provider installation policy
for this slice and ignored `.tao/local/connections.json` for public connection settings. Selective
installation is deferred. Sharing the run screen with the dev loop and landing remain Developer
decisions; landing requires explicit authorization for the slice.

### First Tao Firebase flow — source checkpoint

The Firebase provider, local public configuration path, backend-rule generator, and opt-in Firebase
creation flow are implemented. `Apps/Hosted Firebase` is the CLI-created validation app. Local
journeys and iOS bundling are evidence for source integration; live two-device sync, native durable
restart/replay, account switching, and direct hostile requests against this app's deployed rules
remain acceptance gates. The earlier hostile probe targets the standalone pilot layout and remains
inconclusive. Follow the verification commands in the [continuation handoff](<Hosted provider continuation.md>).

Firebase remains the easier first-flow recommendation based on the Developer's standalone manual
acceptance and Appwrite's failed realtime check, not a measured setup-time comparison. Appwrite
repair acceptance is deferred. This adds no acceptance evidence for Jazz, Convex, or Pylon.

### Ordinary Firebase validation follow-up — 2026-10-04

The Developer's ordinary Tao app now exposes two acceptance failures: web Account loading
rejects the provider's null seed for required DisplayName, and Simulator native storage
fails while importing SQLite. The latter adapter hides the original exception; the JS
package is installed and SDK57 Expo Go includes it, so the actual launched-host/import
cause remains unconfirmed. Provider tests use optional account fields and mock/memory
replicas; local app journeys do not exercise Firebase. Source verification and bundling
did not close these gates. The account-seeding bug entered with the ordinary provider/app
in `883ea9ee8`, not the later runtime merge. See the [continuation handoff](<Hosted provider continuation.md>)
for the implemented bounded Account repair, unchanged physical-cache schema, native diagnostics,
and outstanding host acceptance boundary.

Continue with Firebase as the previously selected first stack, but close ordinary app
bootstrap and native storage before calling its full flow accepted. Earlier handwritten
Firebase pilot acceptance remains valid for that pilot. Appwrite realtime acceptance and
its later full Tao adapter remain deferred; Jazz/Convex/Pylon gates remain separate.

Firebase management tooling now lists and inspects projects/apps, creates projects/Web
registrations after local confirmation, retrieves public SDK config, and plans or performs
a scoped user/store server reset. Local replicas and Auth users are outside reset scope;
project/app/Auth-user deletion is not implemented. Source/fixture checks and independent
review cover the CLI, including protection against inherited project aliases and emulator
routing. No live cloud-management acceptance or new provider acceptance is claimed.

### Firebase repair source checkpoint — 2026-10-05

The app/template default, bounded Account repair, strict logical/wire validation and generated
required-field rules are implemented and independently reviewed. Real RxDB/provider/runtime
fixtures pass; they mock remote transport. Native diagnostic preflight and transitive native-kit
selection are implemented. After the Developer authorized dependency changes, Companion gained
`expo-sqlite ~57.0.3`; setup and the Simulator host build passed. Its exact Companion launched
but produced no database result; native open/reopen remains unproved.
A quiet Expo Go57.0.9 probe started but produced no database result, so native durability remains open.

The ordinary-app Firebase hostile probe is prepared, credential-local and directly measures server
responses after positive controls; its live run remains pending. Reconnect to review/deploy the
updated rules, then verify bootstrap, live two-client CRUD, offline restart/replay, account isolation
and the probe. Earlier handwritten pilot acceptance does not close these ordinary-provider gates.
Appwrite remains deferred; Jazz, Convex and Pylon gates retain their separate dispositions.

Existing-resource API acceptance2026-10-05: live project/app management and reconnect of
`tao-autocreate-test` passed using the existing default CLI login. The only reviewed rules change
made required Account.DisplayName text nonnullable; deployment readback verified Native Standard,
Email/Password Auth and generated rules, preserving indexes and billing. No accounts or passwords
were entered by the agent. Client bootstrap, native reopen, two-client sync and direct hostile
responses remain separate open gates. Conditional landing follows working web/Simulator proof.

Generated-app live check2026-10-05: fresh app creation and existing-resource API connection passed.
The sample account already exists; sign-in succeeded on retry, then local Account resolution
reported unauthorized. Its compiled Account/Item schemas lack authored grants, while Firebase
expects a private owner namespace and the authenticated runtime applies grant-based default deny.
The prior real-provider/runtime fixture omitted the authenticated binding, so it missed this
conformance seam. An explicit provider-scoped private-account policy and a real web/Simulator
journey are required before accepting the ordinary app. This does not invalidate the standalone
Firebase prototype evidence. Appwrite, Jazz, Convex and Pylon dispositions remain separate.
