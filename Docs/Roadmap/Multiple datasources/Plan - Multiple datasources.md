# Plan - Multiple datasources

Status: **implemented, with named gaps**. Ro asked for a plan and delegated every decision it raises;
the decisions below are taken, and where one departs from Ro's sketch the departure is named and the
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

- **Prelude** (`packages/stdlib/@tao/Prelude.tao`): `primitive datasource with { implement, Data
  list of data is [] }`; `primitive app with { …, Datasource list of datasource is [] }`. A slot of
  type `list of T` accepts a single `T` as a one-element list, which is the rule that keeps
  `Datasource Local { … }` valid; `Data` and `Datasource` take the reference-block form as `Toolbar`
  does. `data` needs to be a referenceable type in `Type.ts` so a reference block can name entity
  declarations; today they are only query sources.
- **Grammar** (`packages/parser/parser-grammar/`): a `configure` entry in `app.langium`'s property
  list and in variant patches, whose block holds `Name with { … }` entries; `reference` joins the
  field trait list in `data.langium` beside `relation`; the reference block already parses
  (`ConfigurationEntry.reference`) and needs its target set widened to data declarations.
- **Validator** (`packages/validator/validator-src/validators/`): the membership rules in
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

- `packages/tao-cli/cli-src/ship-project.ts`: replace the `Datasource Dev`, `AppId`, and iCloud
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
   slot, which needs the partition to move per app or onto the entity, is open with Ro.

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
