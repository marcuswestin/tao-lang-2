# Tao Data

Status: authoritative implemented contract for the current WordFlower tranche.

Tao's data layer is provider-neutral in source and generated schema metadata. Top-level `data`
declarations define entity shape, queries and writes operate on live typed values, and each `app`
chooses the provider that mounts the catalog.

## Catalog declarations

A declaration names its plural collection first and its stored singular entity second:

```tao
data Workspaces / Workspace {
   Name text
   CreatedAt time (default now)
   Pinned yes / no
   Documents (relation Documents, owned)
   index CreatedAt
   order by CreatedAt
}

data Documents / Document {
   Title text
   Body text (default "")
   Final yes / Draft no
   Public yes / Private no (default Public)
   CreatedAt time (default now)
   Workspace (relation Workspace)
   Paragraphs (owned)
   index CreatedAt
   order by CreatedAt
}

data Paragraphs / Paragraph {
   Text text
   Ordering number
   Document
   index Ordering
   order by Ordering
}
```

Fields use `Name type (modifiers)`. Primitive types are `text`, `number`, `boolean`, and `time`.
Modifiers are parenthesized and comma-separated. Literal defaults are values of the field's type.
`now` is an ordinary expression that reads the runtime clock. As a field default it is preserved in
generated schema metadata as a clock default and sampled separately for every create rather than
evaluated while parsing or compiling; the text literal `"now"` remains ordinary text.

A case-named boolean has the form `Name yes / [NoAlias] no [(default Case)]`. Its positive case is
the field name. With no alias, the `no` side is unnamed; otherwise the alias precedes `no` and is
its case name, as in `Final yes / Draft no`. The `no` side is the default unless a declared case is selected by
`(default Case)`. `Pinned` and `Public` above demonstrate the unaliased and explicit-default forms.
They exercise declaration syntax and do not require product journeys. Writes, `is <Case>` tests,
and boolean query filters use named declared cases rather than raw spelling conventions.

Indexes are separate statements, one default `order by` may be declared for the entity, and
`local only` states that the entity is stored on the device whatever the app binds as its
`Datasource`. The three are entity-level storage facts and trail the field list as one group:

```tao
data FocusSessions / FocusSession {
   EndsAt time
   PausedAt time (default now)
   Paused yes / Running no

   local only
}
```

A `local only` entity is compiled into a companion catalog with its own connection and storage key,
so a synced datasource variant of the same app never syncs it, and it reaches the device-local store
even when the app's own `Datasource` is already local. Because the two catalogs are separate stores,
a stored `relation` may not cross between them: both ends must declare `local only`, or neither. The
same holds for two collections held by different datasources, and `reference` is the link that
crosses either boundary (see _References across datasources_).

`unique` marks one primitive field as the entity's external identity — the reconciliation key a
query-driven datasource upserts by (see _The Http datasource_ below). It is a storage fact stated
on the field, legal only on primitive fields, declared at most once per field, and carried by at
most one field per entity, so reconciliation never depends on field order.

`title` marks the one `text` field that names a row to a person. It is legal only on a `text`
field, declared at most once per field, and carried by at most one field per entity. The
interaction outline prefers it as a loop row's derived label whenever the row renders it, and reads
it at runtime when the row renders no text of its own (see _Accessible names and the interaction
outline_ in `Tao Layout and UI.md`). A selectable row projects that label as the accessible name of
its press surface; the label remains outline metadata for a non-selectable row. The word is parsed
as an ordinary identifier and its spelling validated, so `title` stays a legal name elsewhere — a
design bundle called `title` is exactly what an app declares.

A bare singular name such as `Workspace` is a stored to-one relationship when it names another
entity. A bare plural name such as `Paragraphs` is an inferred inverse to-many relationship. The
`relation` modifier states the related declaration explicitly when inference is insufficient.
`owned` belongs on the owner's inverse collection: deleting that owner transitively deletes
the related rows in the collection. A stored to-one relationship does not declare cascade policy;
without owner-side `owned`, deletion is restricted while another row refers to the target.
Relationship values are live entity handles, not text IDs.

## App datasource configuration

The catalog does not own provider identity. An app constructs a datasource from a declaration. A
constructor takes a bare block; derivation from an existing value keeps `with` visible:

```tao
use Local from @tao/data/providers/local
use Memory from @tao/data/providers/memory

app WordFlower {
   Name "WordFlower"
   Navigator WordFlowerNavigator
   Datasource Local {
      StorageKey "WordFlowerData"
   }
}

let WordFlowerDemo = WordFlower with {
   Datasource Memory { }
}

datasource PreviewStore = Local {
   StorageKey "WordFlowerPreviewData"
}

workspace let WordFlowerPreview = WordFlower with {
   Datasource with {
      StorageKey "WordFlowerPreviewData"
   }
}
```

`Local { ... }` is construction, and its declaration requires a text `StorageKey`. It is sugar for
`Local with { ... }` in value-construction position. `Memory` declares no properties, so
`Memory { }` constructs its all-defaulted value. A property-position
`Datasource with { ... }` patch starts from the datasource held by the base app; it does not mutate
that app or reconstruct by provider name. The same patch rule applies to a configured datasource
named with `let`. The `datasource Name = Assignment` head is a family-constrained value
declaration equivalent to auto-typed `let`, not a new datasource type; reusable types use
`type Name is datasource with { ... }`.

## Datasource membership and binding a set

An app's data is the union of the stores its datasources hold. A datasource states the collections
it stores in a `Data` reference block, and an app binds the set it mounts:

```tao
use Http from @tao/data/providers/http
use Local from @tao/data/providers/local

datasource HackerNews = HNSource {
   Data { Stories, Comments }
}

datasource Personal = Local {
   StorageKey "HNReaderBookmarks"
   Data { Bookmarks }
}

app HNReader {
   Name "HNReader"
   Navigator HNNavigator
   Datasource { HackerNews, Personal with { StorageKey "HNReaderBookmarksProd" } }
}
```

Which store holds a collection is a fact about the project rather than about one app: a query
compiles once and every app that runs it reads the same store. The partition therefore comes from
the `Data` slots of the project's datasource declarations, and an app only chooses which datasource
fills each store. Two datasources declaring the same collections are **alternatives** for one store
— which is what a stub or preview variant is — and an app binds one of them; a partial overlap is a
diagnostic, because a collection cannot live in two stores at once. A datasource derived from another,
`datasource Preview = Feed with { … }`, stores exactly what its base stores and is an alternative for
the base's store; its patch may not restate `Data`.

A store is named by the collections it holds, sorted and joined (`Comments_Stories`), never by a
datasource that fills it. That name identifies the store in generated code; it is not where rows are
kept. A provider that defaults its storage key uses the name of the bound `datasource` declaration, so
adding a collection, adding an alternative, or reordering declarations leaves saved rows where they
are, and a stub standing in for the real datasource keeps rows of its own.

Every store the project declares must be filled in every app that binds datasources, because every
query over a claimed collection compiles against that store whether the app meant to use it or not.
A bound datasource that declares no `Data` holds only what no datasource in the project claims — the
default store. That is the ordinary single-datasource app, which writes no membership at all, mounts
one catalog named `Data`, and keeps the `Data` storage key it always had. An app may bind at most one
such catch-all, and a collection in the default store with no catch-all bound is a diagnostic naming
it. These checks, the overlap check, and the relation check below read every declaration in the file's
project, so a datasource, its collections, and the app that binds it may live in different modules.

A Studio fixture seeds every store an app mounts: each create lands in the store holding its entity,
and each prepare update in the store holding the row it names.

Membership is structural. It partitions the catalog at compile time and never crosses the provider
boundary, so no provider reads it, a patch where it is bound may not change it, and a variant changes which
datasource fills a store by restating the slot rather than by moving collections between stores.

`local only` is the narrow form of the same fact, decided on the entity: such an entity is held by
the device store whatever the app binds, and a `Data` slot may not claim it.

## Patching a datasource where it is bound

A listed datasource may carry its own patch, `Personal with { StorageKey "…" }`, which derives that
app's copy where it is bound. It is the language's one refinement, checked against the datasource's
configuration contract exactly as the same `with` is anywhere else, and the declaration it names
keeps its own value, so two apps bind one datasource differently. A variant that restates the set
restates the patches it wants, so what is written is what is bound. Only a datasource may be derived
where it is listed; a command on a toolbar or a collection in `Data` is named, not patched.

## References across datasources

A stored `relation` resolves inside one store's rows, so both of its ends must live in the same
store; crossing a `local only` or a datasource boundary is diagnosed where the relation is written,
and an inverse collection whose only back-link is a reference is refused, since a reference has none.
A `reference` is the link that may cross:

```tao
data Bookmarks / Bookmark {
   Story (reference)
   Note text (default "")
}
```

A reference stores the target's `unique` value rather than its row id. Like `unique` and `owned` it
is a bare storage fact; `(reference Story)` names the target only when the field name is not the
entity's. It names one singular entity, which must declare a `unique` field, and it owns nothing:
`owned` may not accompany it, and deleting one side never reaches the other.

A reference that holds a value always reads as an entity handle, so a guard can tell what state its
target is in. When the target's store holds the row, the handle is that row. Otherwise it is a stable
placeholder: `loading` while the store loads, or while a fill-capable store fetches the row, `error`
when that fetch fails, and `missing` once there is nothing left to wait for. The first read of such a
placeholder offers the store the one-row query a live query would make — entity, the unique field's
value, limit one — so an `Http` adapter that declares a by-id shape brings the row in and the next read
returns it. A cleared reference reads as `none`.

A reference resolves only among the stores its own project mounts, never against every store in the
process, so two projects running side by side — as Studio runs them — cannot answer each other's
references. There is no inferred inverse
across stores; `query Bookmarks { where Story == Story }` is the inverse, and equality by that stored
value is the only comparison a reference supports. A reference is legal within one store too — it is
the weaker link, not a cross-store exception.

The storage key belongs to the configured provider—not to a display `Name`, source filename, or
data declaration. A provider persists the version-1 envelope containing schema version, rows, and
the next generated ID; an explicit key preserves rehydration and next-ID continuity. A load,
format, version, or save failure becomes provider error state and never silently falls back to
memory — and a failed save never silently drops the write: the committed rows stay visible under
the error, later remote snapshots cannot revert them, and writes stay allowed so a retry can save
the store again. A transient sync failure behaves the same way and clears on the next applied or
confirmed snapshot.

When a bound datasource cannot load at all, the runtime blocks that app behind a recovery boundary
reporting the load error, rather than leaving every screen rendering against unusable data. A
transport failure offers a plain retry; provably corrupt stored data offers the destructive reset
only when the connection grants `reset`, which wipes and remounts the app root so recovery needs no
manual restart. A connection without `reset` — a shared remote store, deliberately — keeps the
retry, because overwriting data this client failed to parse could erase every peer's rows. A
connection that grants `reset` and declares `automaticReset` is a disposable store: the runtime
runs that reset itself, once per corrupt load, and reloads without asking — how the `Dev`
datasource clears an app's development data after a schema edit. A snapshot that fails to parse
mid-session degrades to the recoverable sync failure over the last usable data instead of blocking
the app. Schemas with no bound datasource keep their ordinary query error state instead.

## Self-hosted datasource declarations

Shipped datasources are ordinary public Tao declarations in package-owned homes — not
compiler-known names. Each provider owns one package path with its declaration and implementation
side by side: `Memory` in `@tao/data/providers/memory`, `Local` in `@tao/data/providers/local`,
`Dev` in `@tao/data/providers/dev`, `Http` in `@tao/data/providers/http`, `InstantDB` in
`@tao/data/providers/instantdb`, `ICloud` in `@tao/data/providers/icloud`, and `CloudKit` in
`@tao/data/providers/cloudkit`.

Reusable provider types use `type Name is datasource with { ... }`. Their explicit
`provider <Export> from <path>` clause fills primitive `datasource`'s implementation requirement; it
is a protocol binding, not ordinary Tao data.

```tao
public
type Local is datasource with {
   StorageKey text

   provider LocalProvider from ./Local.ts
}

public
type Memory is datasource with {
   provider MemoryProvider from ./Memory.ts
}
```

A reusable `datasource` type is top-level rather than nested, declares its visibility, and binds
exactly one `provider` clause. Its declared properties are the complete generic configuration
contract: construction and patch validation read their names and types from the linked declaration,
so copied and third-party datasources receive the same unknown, duplicate, missing, and type
diagnostics without a shipped-name table.

The implementation always names a TypeScript sidecar; the inline fence is retired. The sidecar
exports the named zero-argument factory — a named export, never a default — and the compiler copies
and imports it into generated output and evaluates it once for the declaration. The resulting
package-scope value satisfies the published `TR.DataProvider` protocol: one
`connect(context)` call per app binding receives the evaluated configuration, the mounted schema
definition, and the resolved storage key (the configured `StorageKey`, defaulting to the data
schema name), and returns a `TR.DataConnection`. The connection exchanges complete serialized
snapshots: `load()` returns the starting snapshot or no value; `save(snapshot)` accepts complete
committed snapshots in order and must propagate rejection; optional `subscribe(observer)` publishes
complete replacement snapshots after load; optional `reset()` grants destructive recovery; optional
`close()` synchronously releases connection-owned resources once the runtime has drained its queued
saves; optional `referenceToken`/`resolveReference` grant the versioned entity-restoration
capability navigation persistence uses (see _Tao Presentation and Navigation.md_). A query-driven
connection additionally implements the `fill` half described under _The Http datasource_, and its
provider marks itself `fills: true` so Tao checks bind it.

`TR.testProvider` checks empty load, exact round trips, storage-key and provider instance
boundaries, ordered replacement, and rejection behavior. Instances must be isolated or share one
coherent stateless storage boundary. The shipped implementations pass that suite. Memory is
process-local and instance-isolated; Local delegates its storage boundary to AsyncStorage;
InstantDB syncs each storage key's snapshot through one deterministic keyed row in an InstantDB
app, resolves its startup load from the SDK's own subscription (so an offline launch serves the
local cache), and publishes remote replacement snapshots through `subscribe`; Dev keeps each
storage key's snapshot on the Tao dev server and publishes every peer's write through `subscribe`
(see _The Dev datasource_ below).

ICloud is the platform-sync member of the family: it keeps each storage key's snapshot as one
document in the app's iCloud Drive container (outside the user-visible `Documents/` folder), so the
signed-in iCloud account sees one store across its devices with no account, server, or sign-in of
Tao's own. `Container text?` names the container; omitted, the app's first entitled container is
used. Its optional `subscribe` publishes the document as a replacement snapshot whenever another
device rewrites it, and iCloud's conflict versions collapse to the newest one, so concurrent writers
are last-snapshot-wins exactly as with InstantDB. iCloud keeps a local copy, so an offline launch
loads the last synced document and an offline save uploads on reconnect. Like InstantDB it grants no
`reset`, because the document is shared with the account's other devices. The provider is native
code (`tao-icloud-native`, an Expo module with its own entitlement config plugin, which the ship
pipeline applies from the manifest's `icloud` section), so it needs a development or release build
rather than Expo Go, runs only on Apple platforms, and fails a mount elsewhere with a
host-environment error; an app that also targets Android or the web binds another datasource in a
variant for those targets.

Authentication, permissions, migrations, transactions, aggregation, and provider-specific query
features remain deferred. They require new provider families rather than leaking incremental or
remote semantics into this full-snapshot protocol. The first such family has landed: the query-fill
half layers remote reads over the snapshot contract without changing it, and last-snapshot-wins
sync arrives through `subscribe` on the same terms. The second, the granular-write family, is
described next.

## The granular-write family and the CloudKit datasource

The granular-write family exchanges what changed rather than whole stores. Each commit becomes one
change-set of row upserts and deletes; every field value carries the stamp of the edit that set it;
and replicas converge by folding change-sets, per field the greatest stamp winning whatever order
the change-sets arrive in. The runtime owns the fold, the durable pending queue, and the projection
of the folded state into the snapshot the store mounts, so queries, writes, and entity handles are
unchanged. A provider owns transport and the authority's acceptance: `TR.SyncProvider` connects to
a `TR.SyncConnection` that pushes change-sets, subscribes to remote ones and to acceptance of its
own, and may fetch on demand. `TR.Sync.overSnapshot` is the bridge that mounts such a provider
behind the snapshot contract today; `TR.Sync.testProvider` is the family's conformance suite, and
`TR.Sync.memoryAuthority` its in-process authority for deterministic tests.

Three working assumptions are taken so the machinery can be exercised, and remain open decisions
in `Docs/Roadmap/Multiplayer sync.md`: "latest" is edit order on a hybrid logical clock; a deleted
row stays deleted while later field edits merge into its tombstone; and row identity on the wire is
the pair of creating replica and local id, projected into a replica's store as the local id for its
own rows and `<id>~<origin>` for every other replica's, so sequential local ids never collide. A
child row is hidden until its parent has arrived, so a transport may deliver in any order.

`CloudKit` in `@tao/data/providers/cloudkit` is the family's first member: each row is one record
in a record zone of the iCloud account's private database, named by origin replica, entity, and
local id. Every record is the one generic `TaoRow` type with a single JSON `payload` field holding
the row's stamped fields and, for a deleted row, its stamped tombstone, so no device can resurrect
it and the CloudKit schema is deployed to production once and never follows a Tao `data` change.
A change-set's records are sent as one atomic batch per zone. `CKSyncEngine` owns batching, retries, and the
offline queue on the device; fetched changes are held durably on the device until the fold has
checkpointed them; a server-side conflict comes back with the server's copy and merges fieldwise
before the record is sent again. The declaration is `StorageKey text?` (the zone name, defaulting
to the schema name) and `Container text?`. It shares the `tao-icloud-native` module and
entitlement plugin with `ICloud`, needs iOS 17 or later, and has the same platform limits: native
code, Apple only. Elsewhere the store still mounts from its local checkpoint and edits queue, and
the missing native side surfaces as the recoverable sync error. Like the snapshot-family `ICloud`
it serves one iCloud account across its devices; sharing a zone with other accounts is not yet
modelled, and an account switch stops sync until the app relaunches.

## The Dev datasource

`Dev` is the development-only datasource. It holds nothing on the device: the Tao dev server —
`tao dev` or Studio — stores each app's snapshots on the development machine and syncs them live
to every device, browser tab, and simulator running that app's development build, so two phones
and a browser tab editing the same app see one set of rows.

```tao
use Dev from @tao/data/providers/dev

app Notes {
   Name "Notes"
   Navigator NotesNavigator
   Datasource Dev { }
}
```

`Dev` declares an optional `StorageKey`, defaulting to the data schema name. The rest is decided
by the dev server:

- **Storage is per app.** The dev server keys every stream by the app it is running — the app
  name plus a digest of its project root — and by storage key, so several apps developing side by
  side never see each other's rows. `tao dev` and Studio derive the same key for the same app.
- **Storage survives the dev server.** Snapshots live as one file per app and storage key under
  `.artifacts/user/dev-data/`, written whole through a rename; the next dev server serves them
  again.
- **A schema edit that leaves the stored data unreadable clears it.** The connection grants
  `reset` and declares `automaticReset`, so the first client whose new schema cannot parse the
  stored snapshot wipes that app's stream and every peer receives the empty snapshot. Nothing asks;
  development data is disposable by definition.
- **Sync is last-snapshot-wins over the full-snapshot protocol**, the same terms as InstantDB. A
  write is acknowledged by the server after it has landed and been published to every peer.
- **A lost server is a recoverable sync failure, never a fallback.** While the dev server is away,
  the app keeps its last snapshot, writes fail visibly, and the client reconnects with backoff; the
  server's snapshot replaces local state when it returns. A build with no dev server at all — no
  bootstrap fact in its Expo manifest — reports that plainly at load instead of dialing nowhere.
- **It never ships.** `tao ship` refuses an app that configures `Datasource Dev`; ship a variant
  with a shippable datasource instead.

A development build finds the server through the host its bundle loaded from — `location` on web,
the bundle URL on a device, which is where Expo's dev server already lives — and the port and app
key the dev server writes into the Expo manifest as `expo.extra.taoDevData`. The wire contract,
`tao-dev-data-v1`, lives beside the client in `@tao/data/providers/dev/Dev.ts`; the server in
`packages/dev` mirrors it. `packages/studio/README.md` owns the operational side: ports, the
storage root, and how to inspect or clear it.

## Queries

Queries are reactive lists. Inside a view they are declared in unconditional definition or
root-render placement, before first use and before control flow.

```tao
query Workspaces { }

query Drafts from Workspace.Documents {
   where is Draft
}

query FinishedDocuments from Workspace.Documents {
   where is Final
   order by CreatedAt desc
}
```

The source is either a root plural or a plural relationship. A query may keep the source name or
use `Name from Source`; the `Source as Name` form renames a root plural only, since a relationship
path cannot be a bare source name. Repeated `where` clauses combine with AND. Primitive
comparisons support `==`, `!=`, `<`, `<=`, `>`, and `>=`; boolean cases are filtered by case name.
Boolean filters use `where is <Case>`. One explicit order may override the source entity's default
order. One `limit <count>` clause caps the result after filtering and ordering; the count is a
whole-number literal of at least 1. Generated hooks are hoisted while preserving lexical visibility
and the authored declaration-order rules.

Queries and lists expose `.Count`. Emptiness is tested with `Value is empty`. The availability
cases split into two kinds. The nothing-to-show cases are mutually exclusive:

- `loading` while the provider is loading, or while a query's first fill is in flight — it has
  never filled, so there is nothing to show;
- `error -> Message` while the provider has failed, or a query's first fill failed;
- `empty` only when ready with zero rows;
- the ordinary ready, nonempty path when none of those cases match.

Availability turns on whether a descriptor has ever filled, not on how many rows it produced. A
feed that legitimately filled empty is `empty` content with `refreshing` behind it on a refill,
never a spinner a second time.

Two advisory cases describe a fill running or failing _behind renderable rows_ (see _The Http
datasource_). A guard that does not name them falls through and renders content — cached rows are
never blanked by a refresh:

- `refreshing` while a descriptor that has already filled is filling again;
- `stale` while a descriptor that has already filled has since failed. A failed refresh over
  filled content is `stale`, never `error` — offline is not modelled as an error.

A case is also a predicate, so the inline form reads beside content:
`if TopStories is refreshing { Spinner() }`.

`Message` is scoped to the matched error handler. The retired `.Empty`, `.Loading`, and `.Error`
members are not part of the public contract.

## The Http datasource

`Http` in `@tao/data/providers/http` is the query-driven remote datasource: entities stay ordinary
`data` declarations, and the connection translates live queries into HTTP requests. An app derives
its own source from it and supplies an adapter; the configuration slot types its bridge in place:

```tao
use Http from @tao/data/providers/http

type HNSource is Http with {
   Adapter item is HNAdapter from ./HNAdapter.ts
   CacheFor duration is 5.min
}

app HNReader {
   Datasource HNSource { }
}
```

The protocol is descriptor-driven fill with local evaluation. When a query goes live, the provider
is offered its descriptor — entity, equality-filter values, effective order field and direction
(the query's own or the entity's default), and limit — fetches, and upserts rows into the store;
the store keeps evaluating every query locally over its rows, exactly as for `Local` and `Memory`.
A filter the API cannot express means the provider fetches a superset and the query block still
filters locally. API-side ordering that no field derives (a front-page rank) is materialized by the
adapter as a row field the query orders by.

Filled rows land in the entity's one shared row set, so distinct feeds over one entity must own
their queryable facts: each feed materializes its own field (defaulted for rows other feeds fetch)
and its query filters on it — `Rank number (default 0)` with `where Rank >= 1` is the idiom.
Without that filter, a query can render rows another feed fetched. Per-feed row provenance in the
store is deliberately not implemented.

Rows upsert by the entity's `(unique)` field, so a refetch updates rather than duplicates. In fill
rows, a relation value is a plain object naming the target entity's unique field —
`Story: { HnId: 123 }` — resolved to the store row; parents upsert before children within one fill,
and an unresolved reference fails the fill loudly.

The adapter declares the query shapes the API actually supports, authored with `TR.Http.adapter`
and `TR.Http.on` in a TypeScript sidecar:

```ts
import TR from '@runtime/TR'

export const HNAdapter = TR.Http.adapter({
  Story: [
    TR.Http.on({ orderBy: 'Rank' }, async (query, { upsert }) => {
      const page = await fetchJson(`${API}/search?tags=front_page&hitsPerPage=${query.limit ?? 30}`)
      upsert(page.hits.map(toStoryRow))
    }),
  ],
  Comment: [
    TR.Http.on({ where: 'Story' }, async (query, { upsert }) => {
      const item = await fetchJson(`${API}/items/${query.where.Story.HnId}`)
      upsert(flattenComments(item))
    }),
  ],
})
```

Adapter entries are keyed by the singular entity name. A shape's `where` is matched exactly against
the descriptor's equality-filter set; a stated `orderBy` or `orderDirection` must match exactly (a
bounded fetch depends on both — ordering is how genuinely different feeds over one entity are told
apart), while an omitted one matches any ordering.
Shapes are tried in declaration order and the first match wins. A live query matching no declared
shape is a loud failure surfacing through the query's `error` or `stale` case — never a silent
non-fetch. A relation filter reaches the adapter as a plain snapshot of the related row's scalar
fields. `upsert` lands rows in the matched entity; `upsertInto(entity, rows)` lands related rows.

Fill lifecycle is per descriptor and drives the query availability cases: `loading` for a first
fill, `refreshing` for a refill, `stale` after a refill failed, `error` after a first fill failed.
`CacheFor` suppresses re-fills of a descriptor filled within the window, measured on the runtime
clock a check holds. Concurrent activations of one descriptor deduplicate to one fill.

A descriptor is offered when its query mounts and whenever the descriptor itself changes. There is
no focus, foreground, or interval re-offer, so a query held by a long-lived screen fills once per
mount; a user-triggered refresh spelling is deferred.

## Writes and iteration

Writes share the ordinary owner binder used by invocations and constructors:

```tao
create Document {
   Title: DocumentTitle
   Workspace
}

update Document {
   Title: TitleDraft
   Final
}

delete Document
```

`Name: Value` binds a declared field by owner label. An unlabeled value binds only when its nominal
type identifies exactly one field. Unknown, duplicate, ambiguous, missing, and incorrectly typed
fields are diagnostics; source order never disambiguates. Omitted defaulted fields receive their
declared value. Updates and deletes require a live entity handle from the mounted catalog.

Iteration uses the same plural/singular order as data declarations:

```tao
loop Drafts / Document {
   Text(Document.Title)
}
```

The binder's type is inferred from the collection element. Runtime rendering uses entity identity
for React keys and an index fallback for non-entity lists. Every entity handle exposes a stable,
read-only text `.Id`. The handle retains that ID after its row is deleted, so exceptional UI can
identify the missing entity without turning relationships back into string IDs. The generated ID is
data, not a Tao test selector; ID-based selection remains retired.

## Entity availability guards

Entity handles can be guarded before ordinary field access:

```tao
guard Document {
   loading -> { Text("Loading document…") }
   missing -> { Text("Document { Document.Id } no longer exists.") }
   unauthorized -> { Text("You no longer have access to this document.") }
   error -> Message { Text("Could not load document: { Message }") }
}

Text(Document.Title)
```

`loading`, `missing`, `unauthorized`, and `error -> Message` are the exceptional entity cases. If
none matches, the entity is available and execution or rendering falls through to the statements
after the guard. A matched action guard skips the rest of its action block; a matched render guard
renders its branch instead of the rest of its enclosing render block. A deleted handle becomes
`missing` while retaining `.Id`. Memory and Local currently produce loading, missing, and error;
`unauthorized` is the implemented provider-neutral case reserved for a provider that can report it.

## Deterministic provider-state tests

Every Tao check receives a fresh in-memory snapshot store in place of the launched app's
datasource, and a clock held at a fixed instant. A snapshot-only configured provider cannot
overwrite that isolation, so no check reads or mutates durable storage, and `(default now)` samples
the held clock rather than wall-clock time. The runtime-owned configuration checks still run under
test — an invalid `StorageKey` fails the check that mounts it rather than the first production
mount.

A fill-capable provider binds in a check anyway: fills are how a query-driven datasource has rows
at all, and determinism is the running app variant's responsibility — a journey runs the variant
whose adapter is a deterministic in-repo stub, never the network. Between steps the harness settles
every schema's load, in-flight fills, and queued saves, so assertions read a quiet store.

Bare `data <status>` steps are retired (Decisions §16). The provider states they drove return through
the world controls — network, sync, and datasource fault injection — which have not landed yet.

See `Tao Testing.md` for selector, row-scope, clock, and isolation rules.
