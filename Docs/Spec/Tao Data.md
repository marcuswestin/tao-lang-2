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
`local only` states that the entity is stored on the device whatever the app configures as its
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
a relationship may not cross between them: both ends of a relationship must declare `local only`, or
neither.

`unique` marks one primitive field as the entity's external identity — the reconciliation key a
query-driven datasource upserts by (see _The Http datasource_ below). It is a storage fact stated
on the field, legal only on primitive fields, declared at most once per field, and carried by at
most one field per entity, so reconciliation never depends on field order.

`title` marks the one `text` field that names a row to a person. It is legal only on a `text`
field, declared at most once per field, and carried by at most one field per entity. The
interaction outline prefers it as a loop row's accessible name whenever the row renders it, and
reads it at runtime when the row renders no text of its own (see _Accessible names and the
interaction outline_ in `Tao Layout and UI.md`). The word is parsed as an ordinary identifier and
its spelling validated, so `title` stays a legal name elsewhere — a design bundle called `title` is
exactly what an app declares.

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
snapshot that fails to parse mid-session degrades to the recoverable sync failure over the last
usable data instead of blocking the app. Schemas with no bound datasource keep their ordinary query
error state instead.

## Self-hosted datasource declarations

Shipped datasources are ordinary public Tao declarations in package-owned homes — not
compiler-known names. Each provider owns one package path with its declaration and implementation
side by side: `Memory` in `@tao/data/providers/memory`, `Local` in `@tao/data/providers/local`,
`Http` in `@tao/data/providers/http`, and `InstantDB` in `@tao/data/providers/instantdb`.

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
local cache), and publishes remote replacement snapshots through `subscribe`.

Authentication, permissions, migrations, transactions, aggregation, and provider-specific query
features remain deferred. They require new provider families rather than leaking incremental or
remote semantics into this full-snapshot protocol. The first such family has landed: the query-fill
half layers remote reads over the snapshot contract without changing it, and last-snapshot-wins
sync arrives through `subscribe` on the same terms.

## Queries

Queries are reactive lists. Inside a view they are declared in unconditional definition or
root-render placement, before first use and before control flow. A query is also legal at module
level, where it is a named, app-lifetime read of the store: it carries a visibility marker like any
other declaration, is imported through `use`, and is an ordinary value every declaration in scope
may read — including configuration, which has no view between it and the store.

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
