# Plan - Multiple datasources

Status: **implemented, with named gaps**. The Developer asked for a plan and delegated every decision it raises;
the decisions below are taken, and where one departs from the Developer's sketch the departure is named and the
reason given. `Docs/Roadmap/Tao Revolution/Decisions.md` §6 carries the amendment,
`Docs/Spec/Tao Data.md` the contract, and `Docs/Roadmap/Tao Revolution/Coverage.md` the rows HNReader
proves. The revision notes at the end record what implementation and two reviews changed, and what
from the slices below did not land.

## The ask

An app reads one set of entities from a remote feed and keeps another set for itself, with each set
owned by a datasource of a different kind, and an app or variant adjusts a datasource's
configuration without forking its declaration. The forcing case is HNReader: stories and comments
from the query-driven `Http` datasource, bookmarks on a device or iCloud store, a bookmark pointing
at a story across the two.

```tao
datasource HackerNews = Http {
   Adapter HNAdapter from ./HNAdapter.ts
   CacheFor 5.min
   Data { Stories, Comments }
}

datasource Personal = Local {
   StorageKey "HNReaderPersonal"
   Data { Bookmarks }
}

data Bookmarks / Bookmark {
   Story (reference)
   Rating number?
   Notes text (default "")
   CreatedAt time (default now)

   order by CreatedAt
}

app HNReader {
   Name "HNReader"
   Navigator StackNav { Initial FrontPage }
   Datasource { HackerNews, Personal }
   configure {
      HackerNews with { CacheFor 3.min }
      Personal with { StorageKey "HNReaderPersonal_Prod" }
   }
}
```

## What already exists

- The runtime is already many stores per app. `TR-data-registry.ts` keeps a set of schemas;
  `TR.Data.UseConfigured(schema, datasource)` binds one pair and is called twice today (the `Data`
  catalog and the `local only` companion); capture, restore, reset, and the test harness's
  `beginTest` iterate every schema. Update and delete recover their store from the row handle.
- `local only` is the narrow form of this feature: `DataCompiler.ts` partitions entities into two
  hardcoded catalogs and `catalogScopeOf(entity)` is a boolean. Its relation rule — a stored
  relation never crosses stores — is the only store-boundary rule in the language.
- `datasource Name = Type { … }` declarations, `Name with { … }` patches, `Datasource with { … }`
  app-level patches lowering to `TR.Data.Patch`, and variants swapping `Datasource` are decided and
  implemented. There is no `configure` keyword.
- The one-datasource assumption lives in the Prelude's `Datasource datasource is none` slot, the
  compiler's `DataCatalogPlan`, `AppCompiler.compileAppValue`, the ship preflight's source-text
  regexes, and the storage-key default `configuration.StorageKey ?? schema.name`.

## Decisions

Numbered as in the decision round; the first five were the round's upstream items.

1. **Membership is stated on the datasource**, in a `Data` slot listing the plural data
   declarations it owns. The datasource is the thing that has a storage identity, so it is the
   thing that says what it stores; the entity stays provider-neutral. Departure: the slot takes a
   reference block, `Data { Stories, Comments }`, not a list literal, because a brace-initial slot
   value is already the language's spelling for "these declarations" (`Toolbar { Save }`, the
   decided `Offline { Recipes, Meals }`); `[ … ]` is a list of values.
2. **An app binds its datasources explicitly**: the `Datasource` slot accepts one datasource or a
   reference block of named `datasource` declarations, `Datasource { HackerNews, Personal }`.
   Departure: the sketch bound nothing and let `configure` imply it. Implicit binding cannot
   express the stub variant — `HNSource` and `StubSource` both own `Stories`, so binding every
   visible declaration is a membership conflict — and ship preflight, Studio, and snapshot identity
   all need the bound set to be static. A variant rebinds by restating the slot:
   `Datasource { StubNews, Personal }`.
3. **`configure { … }` is a new block** legal in an app body and in a variant's patch. Each entry
   is `Name with { … }`, where `Name` is a datasource bound by that app's `Datasource` slot; the
   result is an app-local derived value with its own snapshot identity (Decisions §10), and the
   module declaration is untouched. It patches configuration only, never `Data`; a datasource of
   another kind is a rebinding through the slot, not a patch. It is not generalized to designs,
   navigators, or commands in this work. Departure: the sketch wrote entries in type-slot form
   (`CacheFor duration is 3.min`); a value block binds by juxtaposition (`CacheFor 3.min`), and
   `is` stays the type-body spelling.
4. **`reference` is the cross-store link.** `Story (reference Story)` stores the target's
   `(unique)` value and reads as an entity handle with availability, so `guard Bookmark.Story {
   missing -> … }` is the honest read of a story the feed no longer holds. `relation` and bare-name
   inference stay same-store, and the existing ban on same-store `relation` crossing a boundary
   stands. Departure: the sketch wrote `reference Stories`; the modifier names the singular entity,
   as `relation Workspace` does, and the target must declare a `(unique)` field. Revised after
   landing: the name is optional, so `Story (reference)` reads like the other bare storage facts and
   `(reference Story)` is written only when the field name is not the entity's.
   - a. No inferred inverse across stores; `query Bookmarks { where Story == Story }` is the
     inverse, and equality is the only cross-store comparison, compared by unique value.
   - b. No cascade across stores: `owned` may not accompany `reference`, deleting a story never
     touches bookmarks, and a dangling reference reads `missing`.
   - c. A `reference` whose target row is absent from the target store offers a by-unique-key
     descriptor to that store's datasource. For a snapshot store that is a no-op and the handle is
     `missing`; for `Http` it is the "row by unique key" adapter shape the HTTP overview already
     reserves for deep links, so a bookmark can open its story cold.
   - d. `reference` is legal within one store as well; it is the weaker link, not a cross-store
     exception.
5. **Each store mounts its own schema** (revised in implementation: named after the store rather
   than after the bound declaration, see the revision note), and that name is the default
   `StorageKey` for providers that default it. The single form `Datasource Local { … }`
   keeps the schema name `Data`, so no existing Local, Dev, or iCloud store is orphaned, and `local
   only` keeps `LocalData`.
6. Membership rules, all validator diagnostics at the declaration that is wrong:
   - a. An entity named by two bound datasources.
   - b. An entity named by no bound datasource while the app binds two or more, or while its one
     datasource carries a `Data` list. A single datasource with no `Data` list owns every entity
     that is not `local only`, which is today's contract unchanged.
   - c. A `Data` entry that is not a data declaration, or that repeats.
   - d. `configure` naming a datasource the app does not bind, or patching `Data`.
   - e. A `relation` between entities of different datasources, generalizing the `local only`
     boolean to "same owning datasource"; `local only` becomes membership in an implicit device
     datasource and is diagnosed by the same function.
7. Variants and tests: a variant restates `Datasource { … }` to swap a member and uses `configure`
   to patch one; journeys keep binding the stub by naming the variant. `beginTest` already replaces
   every schema and still binds fill-capable providers, so a stub `Http` datasource fills beside a
   fresh in-memory `Personal` with no new harness work.
8. Deferred, deliberately: the `datasource fails …` fault-injection spelling gains a datasource name
   when fault injection lands (Decisions §16); `configure` over non-datasource declarations; an
   entity readable through two datasources (read-through layering); per-datasource `Offline` and
   sync policy, which stay with `Docs/Roadmap/Multiplayer sync.md`.

## Semantics in one paragraph

An app's data is the union of its bound datasources' catalogs. Each catalog is one schema with one
connection, and every query, create, update, and delete reaches the schema that owns its entity —
resolved at compile time for queries and creates, from the handle for updates and deletes, exactly
as `local only` is routed today. Relations live inside one catalog. A `reference` is a stored
unique value that the runtime resolves to a live handle in the owning catalog on read, with
`loading`, `missing`, and `error` availability, and that a query compares by value. `configure`
derives a per-app copy of a bound datasource's configuration; identity, storage key, and snapshot
keys follow the derived value.

## Slices

Each slice is mergeable on its own and leaves every existing app compiling.

### 1. Language surface

- **Prelude** (`packages/apps/stdlib/@tao/Prelude.tao`): `primitive datasource with { implement, Data
  list of data is [] }`; `primitive app with { …, Datasource list of datasource is [] }`. A slot of
  type `list of T` accepts a single `T` as a one-element list, which is the rule that keeps
  `Datasource Local { … }` valid; `Data` and `Datasource` take the reference-block form as `Toolbar`
  does. `data` needs to be a referenceable type in `Type.ts` so a reference block can name entity
  declarations; today they are only query sources.
- **Grammar** (`packages/language/parser/parser-grammar/`): a `configure` entry in `app.langium`'s property
  list and in variant patches, whose block holds `Name with { … }` entries; `reference` joins the
  field trait list in `data.langium` beside `relation`; the reference block already parses
  (`ConfigurationEntry.reference`) and needs its target set widened to data declarations.
- **Validator** (`packages/language/validator/validator-src/validators/`): the membership rules in
  decision 6 in `data-validator.ts` and a new `datasource-membership` pass that computes
  entity→datasource per app; `configure` target and content checks in `app-validator.ts` and
  `configured-values-validator.ts`; `reference` trait checks (target declares `unique`, no `owned`,
  no inverse) in `data-validator.ts`.
- **Formatter and source actions**: `configure` block layout, `Data` and `Datasource` reference
  blocks on one line under the existing short-block rule.
- **Tests**: parser and validator fixtures for every diagnostic above; a formatter round trip.

### 2. Compiler

- `compiler.ts`: `DataCatalogPlan` becomes a list of catalogs keyed by datasource declaration name,
  each with its owner path and entity set; the `local only` companion is one more entry with the
  fixed `LocalData` name and the hardcoded `Local` binding it has today. `fileUsesDataCatalog` stops
  string-matching `Datasource` and reads the app's effective binding set.
- `codegen/app/DataCompiler.ts`: one `TR.Data.Schema({ name })` per catalog; `catalogScopeOf(entity)`
  is a lookup over the plan; `reference` fields compile to a `reference` column in the entity
  definition naming the target entity and its unique field.
- `codegen/app/AppCompiler.ts`: `effectiveAppConfiguration` resolves the `Datasource` list and the
  `configure` patches into one binding per datasource; the generated app component emits one
  `TR.Data.UseConfigured(schema, TR.Data.Patch(base, {…}))` per binding; `restoration.providerIdentity`
  becomes the list of bound identities. `codegen-util.ts`'s fixed `LocalDataBindings` becomes a
  generator over catalogs.
- Ship override: `appDatasourceConfiguration` gains a datasource-name dimension; the anonymous
  single form keeps the flat map.
- **Tests**: compiler fixtures for a two-datasource app, the stub variant, `configure` lowering, and
  the single form emitting byte-identical output to today.

### 3. Runtime

- `TR-data-schema.ts`: the storage-key default stays `configuration.StorageKey ?? definition.name`,
  which now yields the datasource name for multi-bound schemas by construction of slice 2.
- `reference` resolution: a new handle kind on the row that holds the unique value, resolves
  through `TR-data-registry.ts` to the owning schema's row on read, carries availability, and
  offers a by-unique-key fill descriptor when the owning schema's connection fills. Query equality
  on a `reference` field compares unique values.
- `TR-studio-environment.ts`: the Studio provider overlay applies per datasource name.
- `TR.testProvider`: unchanged; a provider's contract is per connection and a datasource is one
  connection. Add a registry-level test that two bound schemas over one `Local` provider with
  distinct storage keys stay isolated.

### 4. Ship preflight

- `packages/cli/tao-cli/cli-src/ship-project.ts`: replace the `Datasource Dev`, `AppId`, and iCloud
  container regexes with the compiled app's binding list, so a `Dev` member anywhere in the set
  refuses ship, and every InstantDB and iCloud member contributes its manifest facts. This is the
  slice most likely to surface a hidden single-datasource assumption; treat any regex left behind
  as a defect.

### 5. Forcing app, spec, and records

- `Apps/HNReader`: `HackerNews` and `Personal` as above; `datasource StubNews = Http { Adapter
  StubAdapter from ./StubAdapter.ts, Data { Stories, Comments } }`; the stub variant restates
  `Datasource { StubNews, Personal }`; a `PersonalCloud = CloudKit { … Data { Bookmarks } }`
  declaration and an `HNReaderCloud` variant shown but not journeyed, since CloudKit is Apple-native;
  `configure` demonstrated by the production storage key. Bookmark and unbookmark commands on the
  story screen, a Bookmarks scene, and journeys: bookmark a story, relaunch, it is listed and opens;
  a bookmark whose story the stub no longer serves reads `missing`.
- `Docs/Spec/Tao Data.md`: rewrite "App datasource configuration" around the bound set, add
  "Datasource membership", "The configure block", and "References across datasources".
- `Decisions.md`: amend §6 (a stored relation never crosses a datasource; `reference` is the
  cross-store link) and §11 (the `Datasource` set and `configure`), citing this plan. Close the
  HTTP overview's "per-entity datasource scoping" deferral and the keyboard plan's ledger row.
- `Coverage.md`: rows for membership, `configure`, and `reference`, each pointing at the HNReader
  journey that proves it.

## Order and size

Slices 1 and 2 are one tranche and the bulk of the work; slice 3's `reference` handle is the only
new runtime concept and can land behind slice 2 with same-store references first; slice 4 is small
and independent once slice 2's binding list exists; slice 5 closes. Roughly: slices 1–2 a week,
slice 3 three days, slices 4–5 two days, verified with `./agent verify --complete` at each merge.

## Revision — implemented

All five slices landed. What the implementation settled, changed, or found:

1. **A bare block of bare names is a reference block**, decided by its entries rather than by the
   slot's declared type. `Datasource { HackerNews, Personal }` in an app property parses as an
   inferred constructor, and an app slot's bare block already meant construction
   (`Navigator { Initial Home }`), so the entries are what tell the two apart. A block of
   `Name value` pairs still constructs; an empty block keeps its older reading.
2. **The store, not the datasource, is what a catalog is named after.** Two datasources with the
   same `Data` list are alternatives for one store, which is what the HNReader stub is. Naming the
   catalog after the bound datasource would have renamed the store whenever a variant swapped it.
   Revised after review: the store first took the alphabetically first alternative's name, which an
   earlier-sorting alternative would still rename, so it is now named by its sorted collections and
   depends on no datasource at all.
3. **Membership never reaches the provider.** It was reaching generated configuration as an unread
   host slot; the compiler now drops it before a configured value is built, and a compiler test
   holds that.
4. **The app-configuration walk moved into `ast-utils`.** The validator and the compiler had to
   agree exactly about what an app supplies, and keeping two copies of the derivation walk is how
   they would stop agreeing.
5. **Ship preflight was rewritten off regexes**, as the slice promised. Two cases its old tests
   asserted turn out not to parse at all — the `with` form of a datasource inside a variant patch,
   and a bare quoted default in a type body, which needs `is` — so those tests were only ever
   checking the regexes against themselves.
6. **Decision 4.c landed after review.** The first implementation returned nothing for an absent
   target, so `guard Bookmark.Story { missing -> … }` could never fire. A reference now reads as a
   stable placeholder handle whose availability is `loading`, `error`, or `missing`, and its first
   read offers the target store the one-row query by unique value, deferred past render the way a
   live query's activation already is. HNReader's adapters declare that by-id shape.
7. **References resolve per project, not per process.** The first implementation scanned every
   schema in the process for one holding the entity. The compiler now links a project's stores and
   each reference field names its target store, so projects mounted side by side cannot answer each
   other's references. A review also proposed persisting a structured token per row; that was not
   taken, because the compiled field definition already names the store, entity, and unique field,
   and repeating them in every row strands rows silently on a rename.
8. **A reference's readings are proved at the runtime level, not in a journey.** HNReader's bookmark
   row renders them, but nothing in the reader's own flow creates a bookmark to a story it has not
   shown, so no journey forces them. A forcing journey waits for the datasource fault injection
   Decisions §16 already describes.

9. **`configure` was replaced by a patch on the listed name.** `Datasource { HackerNews, Personal
   with { StorageKey "…" } }` puts the derivation on the binding, reuses the one refinement the
   language has, and needs no keyword; a variant that restates the set restates the patches it wants.
   A patched name parses as an ordinary `Name with { … }` entry, so it is resolved by name rather than
   linked, and a block counts as a list once it holds a bare name or a patched name that resolves.
   Membership in such a patch is still refused; whether `Data` should become an ordinary patchable
   slot, which needs the partition to move per app or onto the entity, is open with the Developer.

## Revision — second review

A review of `6ed222e9` found twelve issues; two were already fixed in the next commit. What changed:

1. **A catch-all no longer hides a store the app never mounts.** Every store the project declares must
   be bound in every app that binds datasources, and a catch-all holds only the default store. The
   compiler asserts the store a binding fills instead of falling back to the default catalog.
2. **A derived datasource inherits its base's membership** and is an alternative for the base's store;
   its patch may not restate `Data`.
3. **Studio fixtures seed every store.** The fixture hook takes the store list and routes each create
   and update to the store that holds it; a Jest test drives it through the Studio host.
4. **Storage keys stay put.** A store is still named by its collections, but a provider that defaults
   its storage key takes the bound declaration's name, so adding a collection or an alternative moves
   no rows. The default store keeps `Data`.
5. **Membership, overlap, and relation checks read the file's whole project**, so they hold across
   modules; the relation check moved to the membership validator, and its messages object follows the
   `*ValidationMessages` convention.
6. **Refused now**: an inverse whose only back-link is a reference, a data collection named where an
   item expects a value (which used to crash the compiler), and a `let` in a bound set.
7. **The release override reaches only datasources whose contract declares its slots**, rather than a
   per-datasource key; InstantDB endpoints no longer land on a CloudKit store beside it.
8. **Restoration is keyed by every bound store.** A member that cannot be represented leaves the app
   unkeyed, as a single such store does; the first attempt serialised it as `null` and restored handles
   against an unrecognisable provider, which a journey caught.
9. **Configurable types are emitted before the values built from them**, so a `datasource` may name a
   `type` declared further down the file.
10. **A formatter round-trip test** covers the new syntax, and caught `with{` formatting as `with  {`.

Not landed from the slices above: a per-datasource key for the ship release override (7 scopes it by
slot instead), and a Studio provider overlay keyed per datasource beyond what fixture seeding needs.

### Found while implementing, not fixed here

- **An optional data field with no default is still required by a `create`.** `hasDataFieldDefault`
  in `data-write-bindings.ts` ignores `field.optional`. Pre-existing, unrelated to this work, and
  noticed only because an optional `reference` was the first field where it was tempting.

## Provider status

Per-provider status, folded in from what were standalone reports for the `Http`, `InstantDB`,
`ICloud`, and `CloudKit` datasource types. None of these providers depend on the multiple-datasources
work above to function alone; `Http` and the granular `CloudKit` family predate it, and this section
just keeps their status beside the datasource abstraction they configure into.

### Http

Settled design, landed with `Docs/Spec/Tao Data.md` as the implemented contract. `Apps/HNReader`
(`Apps/HNReader`) is the forcing app and remains the reference implementation.

**The protocol: descriptor-driven fill, local evaluation.** The provider does not own query results.
It is _notified that a query descriptor became active_ (entity, filters, order, limit), fetches, and
upserts rows into the store; the store keeps evaluating every query locally over its rows, exactly as
it does for `Local` and `Memory`.

- **Fetch-on-demand, superset-fill, local evaluation.** A filter the API cannot express means the
  provider fetches a superset and the query block still filters locally.
- **Upsert by `(unique)`.** A fill addresses rows by the entity's unique field (`HnId`), so a
  refetch updates rather than duplicates. Relation fields in fills are addressed by the target
  entity's unique field value (`Story: { HnId: … }`), resolved to the store row by the provider.
- **API-side ordering is materialized as a row field.** HN's front-page rank is not derivable from
  any field, so the adapter writes `Rank: index` and the query says `order by Rank`. Ordering
  becomes visible, typed data instead of an invisible API side effect.
- Rejected alternative: the provider returning per-query result sets (each query an island; rows
  unshared; the Tao query block reduced to advisory text). TanStack Query's document cache is that
  model, and TanStack built TanStack DB — normalized collections, locally evaluated live queries,
  fetches relegated to collection fillers — to correct it. Their correction is this design.

**Availability: cache-first, per-query.** Fill lifecycle is tracked per descriptor, with a
four-member case vocabulary: `loading` (first fill in flight, nothing to show yet), `refreshing`
(rows present and renderable, a fill runs behind them), `stale` (rows present, the latest fill
failed), `error` (fill failed and nothing to show). `refreshing` and `stale` are advisory: a guard
that does not name them falls through and renders content, and they never route to the app-wide
app-scoped `guard` net — only nothing-to-show cases do. A case is also a predicate:
`if FrontPage is refreshing { Spinner() }`. Offline stays a non-error: a failed refresh over cached
rows is `stale`, never `error`.

**The adapter: declared shapes, loud failures.** An adapter is a list of declared query shapes per
entity. A live query matching no declared shape is a development-time diagnostic at subscription —
never a silent non-fetch. The declarations double as documentation of the API's real capability
surface, which for most REST APIs is an enumerable set of shapes, not a query language:

```ts
// HNAdapter.ts — as landed: entries key by the singular entity name, and a stated `orderBy` or
// `orderDirection` must match the descriptor exactly.
export const HNAdapter = TR.Http.adapter({
  Story: [
    TR.Http.on({ orderBy: 'Rank' }, async (query, { upsert }) => {
      upsert(toStories(await fetchJson(`${API}/search?tags=front_page&hitsPerPage=${query.limit}`)))
    }),
  ],
  Comment: [
    TR.Http.on({ where: 'Story' }, async (query, { upsert }) => {
      upsert(flattenComments(await fetchJson(`${API}/items/${query.where.Story.HnId}`)))
    }),
  ],
})
```

**Relations.** A relation traversal (`query Thread from Story.Comments`) reaches the adapter as an
ordinary filtered descriptor — entity `Comments`, where `Story` is this row — which is what the
compiler already lowers traversals to. One descriptor vocabulary, one matching mechanism; the handler
receives the parent row as a plain snapshot (`where.Story.HnId`). A row-by-unique-key shape covers
deep links whose entity parameter is not yet cached.

**The stdlib/app split.** `@tao/data` publishes an `Http` datasource type; an app derives from it and
supplies the adapter:

```tao
type HNSource is Http with {
   Adapter item is HNAdapter from ./HNAdapter.ts
   CacheFor duration is 5.min
}
```

The stdlib piece is deliberately a thin, honest machine — per-descriptor in-flight dedup, staleness
against the Tao clock (`CacheFor`), upsert-by-unique, fill-state tracking, error mapping to the cases
above. All API-specific truth lives in the app's adapter. The generic "translate any query to HTTP"
datasource is explicitly not the goal.

**TanStack.** Use their model, not their code, for v1. TanStack Query's two-axis state maps exactly
onto the four cases above (`pending`/`fetching` = loading, `success`+`fetching` = refreshing,
kept-data-plus-error = stale), which is strong independent validation. Not depending on it, for now:
the deterministic test clock (Tao holds and `advance`s time; TanStack runs on real timers with no
injection seam), spec ownership (`CacheFor` and the cases are language semantics, not "whatever the
installed version does"), and the v1 subset being small. The provider's internal seam mirrors
query-core's shapes so adopting it later — when retry/backoff/gc/reconnect are wanted — is cheap.

**Testing.** Journeys bind a deterministic datasource through the decided app-variant mechanism
rather than stubbing the network: either `Datasource Memory` with seeded rows, or an `Http`-typed
datasource whose adapter is a canned in-repo stub — the latter exercises the real fill machinery
(loading → ready → refreshing) with no network. The real adapter's descriptor-to-URL mapping gets
ordinary TypeScript unit tests.

**Landed:** the `limit` query clause; `(unique)` threaded from grammar to the runtime definition;
`refreshing`/`stale` as builtin subject cases (grammar, validator, compiler, runtime match); a
`from`-bridge typed in place by its configuration slot (`Adapter item is HNAdapter from
./HNAdapter.ts`); the fill-capable provider protocol (`fill` beside `load`/`persist`), per-descriptor
state on the schema, upsert-by-unique with relation resolution, per-query availability, staleness and
dedup on the runtime clock, and `settle` covering fills; the stdlib `Http` datasource,
`TR.Http.adapter`/`TR.Http.on`, `withConfiguration` plumbing carrying `Adapter` and `CacheFor` from
the configured value to the bound provider; `Apps/HNReader`'s entities, Algolia adapter, screens, and
journeys running the stub-adapter variant through the real fill machinery, with the test harness
settling data between steps.

**No longer deferred: per-entity datasource scoping.** An app binds a set of datasources, each
stating the collections it stores, and `reference` links a row to one held by another store — see
_The ask_ and _Decisions_ above; HNReader's bookmarks are the local favorites this deferral was
waiting for. The decisions are recorded in `Decisions.md` §6 under "Amended by the HTTP datasource
work".

**Still deferred, deliberately:**

- Snapshot persistence for an offline cache across launches (the Http provider's base store is
  in-memory; cache-first behavior holds within a session).
- Writes through a remote datasource (HN is read-only; the source rejects writes).
- Pull-to-refresh and any user-triggered re-fetch spelling.
- Cache eviction (keep-all) and retry/backoff (where TanStack query-core becomes interesting).
- Entity-handle-level `refreshing`/`stale` (queries only for now).
- Per-feed row provenance in the store. Filled rows land in the entity's shared row set, so
  distinct feeds over one entity own their queryable facts instead: each feed materializes its own
  field (defaulted for rows other feeds fetch) and filters on it — `Rank number (default 0)` with
  `where Rank >= 1`.

**Known consequences of the deferrals**, visible in the shipped app rather than merely theoretical:

- **The refresh states are not reachable from HNReader today.** A descriptor is offered on query
  mount and on descriptor change only; there is no focus, foreground, or interval re-offer, and
  `FrontPage` is the stack root, so it fills once per launch. `refreshing` and `stale` are real,
  tested at the schema level, and correct the moment a refresh spelling lands — but no journey
  through the app can display their banners now.
- **Rows are never evicted.** A story that falls off the front page keeps its old `Rank`, so a
  refill interleaves it with new rows under duplicate ranks. Eviction is deferred above; this is
  what deferring it looks like on screen.
- **An adapter's own unit tests have no home.** `Apps/tsconfig.json` now typechecks sidecar
  `@tao/runtime` imports, but `HNAdapter.ts` is still outside the package test suites, so its
  behavior is covered only indirectly through the stub adapter's journeys. A unit-test home for app
  sidecars is its own piece of work.

### InstantDB

Status: semi-experimental implementation. The package and runtime boundary are implemented; live
two-client acceptance remains before this can be treated as the production sync model.

Datasource implementations are Tao packages: `@tao/data/providers/local`, `@tao/data/providers/memory`,
and `@tao/data/providers/instantdb`. The runtime no longer owns or names concrete providers. A package
provider connects with an evaluated configuration, the compiled Tao data schema, and a stable storage
key. A connection loads and saves full serialized snapshots, may publish live snapshots, may opt into
destructive reset recovery, and may release connection-owned resources. Runtime queries, entity
handles, defaults, relationships, validation, and serialized write ordering remain provider-neutral.
`StorageKey` defaults to the mounted Tao data schema name; `Local` requires an explicit key in its Tao
contract, `InstantDB` makes it optional so app variants can normally configure only `AppId`.

**The adapter.** It stores one `taoSnapshots` entity per `AppId` and storage key. Its deterministic
entity ID does not require a unique attribute or an Instant schema-push step. Initial state resolves
from the first `subscribeQuery` result — so an offline launch serves the SDK's local cache — and the
same subscription then feeds live changes; writes use `transact`. `ApiURI` and `WebsocketURI` are
optional configuration for local Instant development.

The previous repository supplied the proven client operations and a test app ID:
`9faf89c0-c15c-49b4-bf3f-3b5b2cd9a19f`. Its local endpoints were `http://localhost:9020` and
`ws://localhost:9020/runtime/session`. No admin token or other secret is copied into this repository.
The previous provider-specific query and row-write engine is not ported: this slice preserves the
current Tao runtime's data semantics behind the new connection boundary.

Local development uses InstantDB's published self-hosted images through a small adaptation of its
official `self-hosting/docker-compose.local.yml`. `just start-local-instantdb` starts and waits for
the stack, then idempotently provisions the stable WordFlower app; `just stop-local-instantdb` stops
it without deleting data. Compared with the previous repository, this removes the InstantDB source
checkout, pinned development-server build, custom Dockerfile, and dependency-cache volumes.

**Known limits:**

- Sync is a whole-datasource snapshot, not entity-level InstantDB storage. Concurrent writers are
  last-snapshot-wins and can overwrite unrelated edits. A local commit wins over subscription
  snapshots observed while its ordered save queue is pending, avoiding a transient remote/local
  flip-flop without pretending to provide conflict resolution.
- Authentication, permissions, presence, schema provisioning, migrations, conflict resolution, and
  offline reconciliation are not yet modeled by the Tao provider protocol.
- A remote provider load failure offers a safe retry. It cannot opt into the reset action used by
  Local and Memory, so a transient network or malformed remote snapshot cannot silently erase remote
  data.
- A subscription error preserves the last usable data and appears through query error state rather
  than replacing the app with the initial-load recovery overlay. A later valid snapshot recovers it.
- The SDK is initially pinned to the previous implementation's `@instantdb/react-native` 1.0.22 while
  the interface settles.
- Copied provider sidecars resolve native dependencies from the runtime host, so that host installs
  the InstantDB SDK and its React Native peers. Metro includes the SDK only when the compiled module
  graph reaches the InstantDB sidecar; a Tao file containing both Local and InstantDB app variants,
  such as WordFlower, keeps it reachable even when the Local variant is selected.

**Validation.** Before the final provider-package refinements, `./agent verify` passed all 15 suites:
1,002 tests, 1,002 passed. Package-owned focused coverage now exercises Local and Memory conformance
plus InstantDB configuration, deterministic snapshot identity, reads, writes, live subscriptions, and
native-SDK lazy loading and reference-counted shutdown. Focused compiler coverage also compiles the
InstantDB import and copied sidecar, while runtime coverage applies live snapshots, releases outgoing
connections, preserves usable data through subscription errors, and keeps pending local saves stable.

A temporary Current configuration mounted `DeviceStore` from InstantDB with the previous local app ID
and endpoints. All four WordFlower Current Tao test files passed, and Current was then restored
byte-identical to Next. This proves provider package loading and app integration under the Tao test
harness; the harness deliberately substitutes an isolated test connection, so it is not evidence of
network-backed InstantDB behavior.

**Live acceptance still required:**

1. With `just start-local-instantdb` running, mount two app clients using the test app ID and
   confirm create, update, delete, restart hydration, and subscription propagation.
2. Decide whether the next InstantDB slice should keep snapshot sync or introduce an explicit
   entity/change protocol before calling the provider production-ready.

### ICloud

Status: implemented boundary, not yet proven on devices. The package, native module, ship
entitlements, and provider protocol are in place and covered by focused tests; two-device live
acceptance on real iCloud accounts remains before this can be treated as a production sync path.

**Why a platform-sync provider.** `Local` keeps a store on one device; `InstantDB` syncs it through a
hosted backend that needs an app id, a server, and eventually accounts. Between the two sits what the
platform already gives a signed-in person for free: the same store on every device of one iCloud
account, with no server, no sign-in flow, and no account model of Tao's own. `ICloud` is that
provider, for apps whose data is "mine, on my devices" rather than "ours, in a household." It is
deliberately a member of the existing full-snapshot family. The snapshot protocol already has a
remote member with last-snapshot-wins semantics (InstantDB), so iCloud Drive's document model — a
file per storage key, conflict versions when two devices wrote concurrently — maps onto it without
touching the runtime. CloudKit, the other Apple sync surface, is the granular-family target instead
(see _CloudKit_ below and `Docs/Roadmap/Multiplayer sync.md`): record-level changes, change tokens,
push-driven fetches, and record-zone sharing are the shape that family wants, and too heavy for whole
snapshots.

**Implemented boundary.**

- `@tao/data/providers/icloud` declares `type ICloud is datasource with { StorageKey text?,
  Container text? }` and binds `ICloudProvider` from its sidecar, exactly as InstantDB does.
  `Container` names the iCloud container identifier; omitted, the app's first entitled container
  is used.
- The connection keeps one document per storage key at `<container>/Tao Data/<key>.json`,
  outside the container's `Documents/` folder so the Files app never lists it while iCloud still
  syncs it. `load` reads it, `save` replaces it under file coordination, and `subscribe` follows
  it through a metadata query so another device's write arrives as a replacement snapshot. There
  is no `reset`: the document is shared with the account's other devices, so a device that failed
  to parse it must not wipe it, matching InstantDB.
- Echoes and transients are filtered in the provider. The metadata query reports this connection's
  own write like any other change, so the last written snapshot is dropped when it comes back; a
  document can read as missing for a moment while iCloud rearranges its bookkeeping, so a missing
  document never reaches the store (nothing in this design deletes it); and while a write is in
  flight the watch only notes that something changed, and the connection re-reads the document
  once its writes settle, so the watch can never publish an earlier snapshot over a later one.
- A read that finds no local item asks iCloud's metadata whether the document exists anywhere
  (bounded at eight seconds) before answering "no document", so a freshly signed-in device does not
  mount empty and then win the newest-wins conflict against the account's real data.
- Conflicts collapse to the newest version by modification date (last snapshot wins). A write
  supersedes any conflict versions outstanding at the time, since the runtime committed it over
  the newest contents it had seen.
- Configuration readers shared by InstantDB and ICloud live in
  `@tao/data/providers/provider-configuration.ts`, copied with each sidecar's relative import graph.

**The native module.** `packages/apps/providers/icloud` (`tao-icloud`) is the repository's first
native code: an Expo module in Swift, autolinked into the runtime host through the existing
`autolinkingModuleResolution` setting because the package is a dependency of `tao-expo-host`.

- `ios/TaoICloudModule.swift` exposes `readDocument`, `writeDocument`, `startWatching`, and
  `stopWatching`, plus a `documentChanged` event. Reads and writes go through `NSFileCoordinator`
  (a coordinated read of an undownloaded item waits for its download); watches are
  `NSMetadataQuery` objects over the ubiquitous data and documents scopes, started on the main
  thread, reading off it. JavaScript chooses the watch identifier so no event can precede its
  owner learning it.
- `icloud-src/icloud-native.ts` publishes `ICloudDocuments`, the boundary the provider
  drives, and `loadICloudDocuments`, which binds the Swift module lazily and fails with a
  host-environment error where the module is absent — Android, the web, or an Expo Go session.
- `plugins/with-tao-icloud.cjs` (`app.plugin.js`) grants the iCloud Documents entitlements. The
  ship pipeline applies it from the manifest: `tao ship` detects an app bound to `ICloud`
  (directly, through a named datasource, or inherited from its direct base app), records the
  explicit `Container` if any, and `app.config.js` adds the plugin with
  `iCloud.<bundle identifier>` as the default container.

Consequences for the development loop: Expo Go cannot load the module, so an app mounting an
iCloud datasource needs a development or release build; the companion app plan already introduces
that loop. On the iOS Simulator, sign the simulator into an iCloud account and use _Features ›
Trigger iCloud Sync_ to push changes between simulators.

**Known limits:**

- Apple platforms only. A mount elsewhere fails loudly with a host-environment error; an app that
  also targets Android or the web binds another datasource in a variant for those targets. Whether
  the validator should refuse such a target at compile time is a decision for the Developer.
- Single account, many devices. iCloud Drive offers no server-side rule evaluation, no accounts of
  its own, and no sharing of a data-scope document, so the §3 access rules have nowhere to run and
  the household demos are out of scope. Sharing arrives with CloudKit in the granular family.
- Whole-snapshot last-writer-wins, as InstantDB today. Concurrent edits on two devices overwrite
  each other's unrelated changes; the snapshot family's sequential row ids (open question 5 in the
  multiplayer exploration) also collide across devices that create rows offline at once.
- The container belongs to the signing team. If Tao's ship pipeline signs under Tao's own account,
  the container is Tao's while the data lives in the person's iCloud quota; a developer shipping
  under their own team gets their own container. Neither is wrong, but the ship documentation
  should say which one applies.
- Delivery latency is iCloud's. A metadata query reports a remote write when the daemon has
  downloaded it, which in practice is seconds on a live device and manual on the simulator.

**Validation.** Focused coverage: `packages/apps/providers/icloud/icloud-tests` proves the document
boundary over a fake native module (absent documents, container pass-through, watch routing by
identifier, stop-once, start failures) and the config plugin's container derivation and entitlement
merging. `packages/apps/stdlib/stdlib-tests/data-providers.test.ts` runs `ICloud` through `TR.testProvider`
with a fake document store and a rejecting variant, and proves document naming per storage key and
container, the absence of `reset`, echo and transient filtering, unsubscribe guarding, and
configuration validation before the native module loads. Compiler coverage compiles the `ICloud`
import with its copied sidecar and shared configuration reader; CLI coverage proves the ship binding
derivation; toolchain coverage proves the manifest's `icloud` section becomes the plugin entry.

The Swift module compiles: `expo prebuild` of the runtime host, `pod install`, and an `xcodebuild`
of the `TaoICloudNative` pod target for the iOS Simulator succeeded against ExpoModulesCore 3.0. The
three commands, and which of them the Bash sandbox refuses, are recorded in
[DEVENV-055](<../Developer environment upgrades/Archive/DEVENV-055-no-repository-command-compiles-a-native-module.md>).
The Native Bridge simulator journey later compiled and linked the module on 2026-09-27. No simulator or device has run the provider yet.

**Live acceptance still required:**

1. Build a development client with the module linked and an iCloud-entitled bundle identifier,
   install it on two devices (or two simulators) signed into one iCloud account, and confirm
   create, update, delete, relaunch hydration, and cross-device propagation.
2. Force a conflict — write on both devices while one is offline, then reconnect — and confirm
   the newest snapshot wins on both without either device blocking behind an error.
3. Decide whether platform-scoped datasources need a validator rule for non-Apple targets.

### CloudKit

Status: implementation stab, reviewed once. The granular-write family's runtime machinery, its
conformance suite, and a CloudKit provider over `CKSyncEngine` are implemented and covered by
focused tests. Three working assumptions stand in for decisions the multiplayer exploration leaves
open, and no device has run the provider yet. Nothing here is language law;
`Docs/Roadmap/Multiplayer sync.md` owns the design dialogue and `Decisions.md` wins where they
collide.

**What landed, and where it sits in the sequence.** `Docs/Roadmap/Multiplayer sync.md` sequences the
family as: the change-set ledger, the fold, the family contract with a simulated provider and
conformance suite, the durable queue, and then the InstantDB granular provider. This stab lands the
first four as one contained runtime module and adds CloudKit — Apple's own granular sync surface —
as the first provider, ahead of InstantDB. It does so without touching the store's commit path or any
grammar: the ledger is derived at the provider boundary by diffing the snapshots the store already
saves, and the fold is projected back into the snapshot the store already loads.

- **`packages/apps/runtime/TaoRuntime-src/TR-data-sync.ts`** is the family. `TaoChangeSet` and
  `TaoSyncOp` are the wire shapes (row upserts carrying stamped field values, and stamped deletes);
  `TaoSyncProvider` / `TaoSyncConnection` / `TaoSyncObserver` are the provider contract (push,
  subscribe to remote change-sets and to acceptance of one's own, optional fetch, an `online`
  signal for transports that refuse pushes while offline, and a `remote` that resolves once the
  change-set is checkpointed so a transport can acknowledge delivery); `snapshotConnectionOverSync`
  is the bridge that mounts a granular provider behind today's snapshot contract;
  `createMemorySyncAuthority` is the in-process authority with a per-provider online switch;
  `testSyncProvider` is the conformance suite. `TR.Sync` publishes the bridge, the authority, the
  suite, and `stampAt`.
- **The bridge** keeps one durable checkpoint per store in the host's key-value storage, scoped by
  provider and container: replica identity, hybrid-logical-clock state, the fold (every row's
  stamped fields and tombstone), and the pending queue. `load` projects the fold; `save` diffs the
  saved snapshot against the rows the store is known to hold — its load, its saves, and the
  publishes it applied, never the fold itself, because a store mid-save buffers a publish and its
  next snapshot predates that remote change — stamps the difference as one change-set, persists
  first and applies only if the persist succeeded, hands back the fold if it holds anything the
  snapshot lacked, and pushes on a chain of its own so a slow transport never holds the fold. A
  remote change-set folds, persists, and republishes the projection only if it changed. Acceptance
  drops a change-set from the queue; a push the transport rejects leaves it queued until `online`;
  a transport failure reaches the store as the recoverable sync error.
- **`@tao/data/providers/cloudkit`** declares `type CloudKit is datasource with { StorageKey
  text?, Container text? }`. `CloudKitProvider` wraps `CloudKitSyncProvider` in the bridge with
  AsyncStorage as checkpoint storage; the sync provider maps each row to one record named
  `<origin>:<Entity>:<id>`. Every record is the one generic `TaoRow` type with a single JSON
  `payload` field holding the row's stamped fields (relations as row identities, booleans and
  times as JSON values) and, for a deleted row, a stamped tombstone rather than a CloudKit
  deletion, so a device that relaunches with an empty record cache cannot re-create a deleted row.
  One record type with one field means the CloudKit schema is deployed to production once and
  never follows a Tao `data` change — production forbids just-in-time schema and promoted fields
  can never be renamed or removed — and nothing is lost, since the fold evaluates queries locally
  and CloudKit indexes are unused. A change-set's records go out as one batch marked atomic by
  zone; a record refused with `batchRequestFailed` because a sibling conflicted is queued again
  behind the resolved conflict. It keeps an
  image of every record it has sent or fetched, so each send is a whole record and a server
  conflict merges fieldwise (server-newer fields land locally as a remote change, the merged record
  goes out again); a change-set counts as accepted only once every record it touched has been saved
  carrying that change-set's stamps, so a later change-set to the same row is never accepted by an
  earlier save. `unknownItem` on a save means the server has no such record (a zone reset or a
  purge) and the local image is re-created whole; a zone reset clears the images; an iCloud account
  change stops pushes until the app relaunches, so one account's queue is never written into
  another's database.
- **`TaoCloudKitModule.swift`** (in `tao-icloud`, beside the iCloud Documents module) is
  one `CKSyncEngine` per session over one record zone of the private database. Fetched changes are
  written to an inbox file before the delegate returns and stay there until JavaScript acknowledges
  them after checkpointing, so the engine's change token never advances past records the fold has
  not persisted, and a relaunch replays the inbox first. It persists the engine's state
  serialization under Application Support, caches the server's copy of each record it has seen so a
  later save carries the change tag (copying records so an in-flight batch never sees a later
  send's fields), reports fetched changes, saved records with their fields, `serverRecordChanged`
  conflicts with the server record, failed zone saves, and other failures by error-code name as
  `cloudKitEvent`s, drops pending changes that no longer have a record to send, gives up on a
  missing zone after three retries, and needs iOS 17 (a clear exception below that). `stop` mutes
  the session rather than dropping the engine under in-flight work.
- **Ship**: the manifest's `icloud` section names services as well as containers; the entitlement
  plugin grants `CloudKit` (and `CloudDocuments` for `ICloud`); `tao ship` detects a `CloudKit`
  binding exactly as it detects `ICloud`.

**Working assumptions** (open questions in the multiplayer exploration):

1. **"Latest" is edit order** on a hybrid logical clock: a stamp is wall milliseconds advanced past
   every stamp the replica has seen, a counter, and the origin as tie-break. (Open question 1;
   the exploration's own lean.)
2. **A delete stays a delete.** A tombstone is one more stamped unit; a later field edit merges into
   the tombstoned row without reviving it, so an eventual undo restores the row with the edit
   intact. (Open question 2; the exploration's lean.) The tombstone travels with the record, so
   every device and the server agree.
3. **Wire identity is (origin, local id).** A replica's store shows its own rows under their local
   ids and every other replica's under `<id>~<origin>`; relation values project the same way. This
   answers open question 5 for the bridge without touching the store's id generation, and the
   projected ids are stable for the row's life, so navigation restoration tokens keep working.
4. **A child is hidden until its parent arrives**, and until every schema field of the row has
   been folded, so a transport may deliver in any order and the projected snapshot always
   validates.

**Known limits:**

- **Push delivery is entitled but unproven.** The plugin grants `aps-environment` and the
  `remote-notification` background mode for a CloudKit binding, the session registers the app for
  remote notifications, and it fetches again whenever the app returns to the foreground; whether
  silent pushes reach the engine on a real device is part of the live acceptance.
- **Tombstones are never purged.** A deleted row's record stays in the zone with its tombstone;
  `Deletes tombstones for 30 days` in the design implies a retention purge that is not written.
- **Whole-record sends.** Every send carries the full record image; CloudKit accepts partial
  updates, but a whole record keeps the conflict path simple. Record size is bounded by CloudKit's
  1 MB field limit per record, which a Tao row will not approach.
- **After a relaunch the native record cache is empty**, so the first save of an existing record
  comes back as a conflict, merges, and resends. Correct, one extra round trip.
- **A zone reset loses what the server had accepted.** Local rows stay in the fold, but they are
  only re-created in the zone when edited again; the person is told through the sync error.
- **An account switch needs a relaunch**, and the previous account's checkpoint stays on the
  device: clearing it, and the engine state, on a switch is not written.
- **One account.** The private database only; `CKShare` and the shared database, which are the
  natural home for the household model, are not modelled. Neither are the authority rules of
  Decisions §3, which CloudKit cannot evaluate server-side.
- **A corrupt checkpoint blocks the mount** with the load error and its retry; the bridge grants
  no `reset`, since a checkpoint also holds the pending queue.
- **The store still saves whole snapshots** to the bridge; the ledger is derived by diffing. When
  the runtime grows a native ledger (the exploration's first slice as written), the diff goes away
  and the family contract, the fold, and the providers stay.
- **Not run on a device.** The Swift compiles (see DEVENV-055 for the build steps); the provider
  is proven only against the fake CloudKit zone in `packages/apps/stdlib/stdlib-tests`, which stores
  numbers as the server does, versions records, answers conflicts with the server's copy, plays an
  offline session's queue against the server on reconnect, and counts acknowledgements — but has
  no real engine, no push, and no account.

**Validation.**

- `packages/apps/runtime/TR-tests/TR-data-sync.test.ts`: the conformance suite over the memory
  authority (which now also proves both pending queues drain); concurrent edits to different fields
  both survive and a same-field race resolves by stamp under a real partition; offline change-sets
  survive a relaunch and push once online; a child delivered before its parent is hidden and then
  shown; a deleted row stays deleted under a later edit; a remote row a save predates is neither
  deleted nor lost; transport-minted stamps order below later local edits; an echo of the replica's
  own change-set republishes nothing.
- `packages/apps/stdlib/stdlib-tests/data-providers.test.ts`: the CloudKit sync provider passes the
  conformance suite over the fake zone; records carry stamped fields, encoded booleans, relation
  identities, and a tombstone on delete; a server conflict merges fieldwise, both devices converge,
  and every fetched batch is acknowledged; configuration is validated before the native side loads.
- `packages/apps/providers/icloud/icloud-tests`: the zone boundary starts one session per zone,
  routes fetched, sent, zone-reset, account-change, and failure events by session, acknowledges a
  batch, classifies native rejections, and the plugin grants CloudKit without the Documents-only
  ubiquity container.

**Live acceptance still required:**

1. Two devices on one iCloud account with a CloudKit-entitled development build: create, update,
   delete, relaunch, and conflict scenarios against the real `CKSyncEngine`, including a kill
   between fetch and acknowledgement to prove the inbox replays.
2. Settle open questions 1, 2, and 5 with the Developer and adjust the fold if the answers differ from the
   assumptions above; decide the tombstone retention and purge.
3. Decide whether CloudKit or InstantDB carries the household demos, which need sharing and
   server-side rules the private database cannot provide.
