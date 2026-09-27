# Hosted data provider candidates

The slice after provider pairing lands: evaluate hosted data and auth services as Tao providers,
sort them into Tier 1 and Not now, and implement the Tier 1 providers where the evaluation finds a
fit. The Developer set this direction on 2026-09-27.

Instant Cloud closed new signups and shuts down on 2027-08-31 ([Plan — Auth and data
pairing](<Plan - Auth and data pairing.md>)), so Tao needs hosted providers besides InstantDB.

## Evaluation — 2026-09-27

These are **proposed** tiers, pending the Developer's priority decision. Primary documentation was
checked on the date above; no Tao adapter or conformance run has proved the candidate capabilities.
`supports` must hold for every writer, including hostile clients and offline replay. A managed
provider may execute generated policy and write code, but Tao or the app author must not have to
host an application server. Prices are a dated snapshot, not a cost estimate for a Tao app.

| Candidate | Proposed tier    | Decisive point                                                                                                         |
| --------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Jazz      | Tier 1 pilot     | Hosted sync, external JWT and server policy fit; native client and Jazz 2 are alpha.                                   |
| Pylon     | Not now          | Hosted data and auth fit in outline, but pre-1.0 native/policy evidence is thin.                                       |
| Zero      | Not now          | Production requires an app query/mutate API server.                                                                    |
| PowerSync | Not now          | Strong offline subset fit, but queued writes require an app backend.                                                   |
| Convex    | Tier 1           | Managed backend and native client fit online data with Clerk pairing.                                                  |
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
and a development build; Expo Go is unsupported. Jazz 2 and its native client are alpha, source is
MIT, and production Cloud pricing was not confirmed. Start with a bounded Clerk-paired pilot if an
alpha native dependency is acceptable. [Client and Cloud](https://jazz.tools/docs/install/client),
[JWT identity](https://jazz.tools/docs/auth/authentication),
[permissions](https://jazz.tools/docs/auth/permissions),
[schema](https://jazz.tools/docs/schemas/defining-tables),
[source](https://github.com/garden-co/jazz).

### Pylon

Pylon could supply both datasource and auth: its own revocable session suggests
`issues { Session }` and `accepts { Session from PylonAuth }`; external `IdentityToken` acceptance
needs proof. Stack0 Cloud hosts its backend. Its Expo client keeps a replica and mutation queue in
AsyncStorage, but its stored auth token and Tao account-isolation behavior need review. Relations,
access rules, field updates, offline and additive migrations are candidates; uniqueness and
membership are open. Dependencies include `@pylonsync/sdk`, `@pylonsync/react`,
`@pylonsync/react-native`, AsyncStorage and NetInfo. It is pre-1.0, MIT/Apache-2.0, and advertises
a free Cloud start without a confirmed numeric production price. Revisit after native and policy
stability evidence. [React Native](https://docs.pylonsync.com/clients/react-native),
[auth](https://docs.pylonsync.com/auth/overview), [JWT sessions](https://docs.pylonsync.com/auth/jwt),
[Cloud](https://www.pylonsync.com/product/cloud), [source](https://github.com/pylonsync/pylon).

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

## Sequence

1. Settle the proposed tiers, including whether an alpha native SDK may be a bounded Tier 1 pilot.
2. If the shortlist stands, ask the Developer to approve `convex` for the first slice and
   `jazz-tools`/`jazz-rn` for a Jazz slice. Inspect manifests and request approval for any additional
   named dependencies before changing a manifest or lockfile.
3. Implement approved Tier 1 providers one per slice, each with pairing declarations, conformance
   checks for every declared capability, and an Auth Review journey. Start with the existing Clerk
   `IdentityToken` path; provider-native auth is a separate decision.
