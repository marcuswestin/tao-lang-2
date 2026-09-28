# Hosted data provider candidates

The slice after provider pairing lands: evaluate hosted data and auth services as Tao providers,
sort them into Tier 1 and Not now, and implement the Tier 1 providers where the evaluation finds a
fit. The Developer set this direction on 2026-09-27.

Instant Cloud closed new signups and shuts down on 2027-08-31 ([Plan — Auth and data
pairing](<Plan - Auth and data pairing.md>)), so Tao needs hosted providers besides InstantDB.

## Evaluation — 2026-09-27

The Developer selected Jazz, Convex, and Pylon for the first implementation round on 2026-09-28.
The other tiers remain recommendations. Primary documentation was checked on 2026-09-27, with Pylon's new
release rechecked on 2026-09-28. Local pilot tests cover parts of the adapters; no hosted/native
conformance run has proved the candidate capabilities. `supports` must hold for every writer,
including hostile clients and offline replay.
The Developer confirmed that a managed provider may execute Tao-generated policy and write code;
Tao or the app author must not have to host an application server. Prices are dated snapshots, not
cost estimates for a Tao app.

| Candidate | Proposed tier    | Decisive point                                                                                                         |
| --------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Jazz      | Tier 1 pilot     | Selected for first round; hosted sync, external JWT and server policy fit, while native client and Jazz 2 are alpha.   |
| Pylon     | Tier 1 pilot     | Selected for first round with PylonAuth; policy, session, offline and device proof gate landing.                       |
| Zero      | Not now          | Production requires an app query/mutate API server.                                                                    |
| PowerSync | Not now          | Strong offline subset fit, but queued writes require an app backend.                                                   |
| Convex    | Tier 1           | Selected for first round; managed backend and native client fit online data with Clerk pairing.                        |
| LiveStore | Not now          | Auth, authorization and sync authority require authored infrastructure.                                                |
| Electric  | Not now          | Read replication needs a separate authorized write path.                                                               |
| Ditto     | Not now          | Per-user auth requires an authored webhook; policy is narrower than Tao's.                                             |
| Automerge | Not now          | A CRDT engine without hosted account or policy authority.                                                              |
| RxDB      | Not now; revisit | Direct Supabase sync may avoid an app server, but native production storage is paid and policy/schema fit needs proof. |

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
need Supabase-backed conformance. React Native SQLite storage exists, but bundled trial storage is
capped at 500 live documents and is unsuitable for production. Core is Apache-2.0; production
SQLite Premium starts at $99/month billed annually. Dependencies would include `rxdb`,
`@supabase/supabase-js` and a production storage license. [Supabase](https://rxdb.info/replication-supabase.html),
[sync](https://rxdb.info/replication.html), [SQLite](https://rxdb.info/rx-storage-sqlite.html),
[Premium](https://rxdb.info/premium/), [source](https://github.com/pubkey/rxdb).

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
  `FieldUpdates` contract. Its relation mapping also cannot guarantee `(owned)` cascade when a
  parent is deletable. Keep `supports { }` and the Jazz transport experiment; restore the Auth
  Review variant only after a server-enforced field/relationship design passes hostile direct
  requests. The [Jazz permission documentation](https://jazz.tools/docs/auth/permissions)
  describes the old/new value checks. This unresolved required gate blocks landing the three-provider
  slice. The generated Expo host and JazzRn module compiled for iOS Simulator, but no Jazz Cloud
  deployment, app launch, sign-in, two-device journey or offline journey ran.
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
