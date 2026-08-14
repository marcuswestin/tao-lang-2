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
   CreatedAt time, default now()
   Documents
   index CreatedAt
   order by CreatedAt
}

data Documents / Document {
   Title text
   Body text, default ""
   Final / Draft, default Draft
   CreatedAt time, default now()
   Workspace, on delete cascade
   index CreatedAt
   order by CreatedAt
}
```

Primitive fields support `text`, `number`, `boolean`, and `time`. `now()` is the implemented time
default. Boolean fields are declared as their two case names; writes and filters use those names.
Field modifiers are comma-separated. Indexes are separate statements, and one default `order by`
may be declared for the entity.

A bare singular name such as `Workspace` is a stored to-one relationship when it names another
entity. A bare plural name such as `Documents` is the inferred inverse to-many relationship. A
stored relationship may add `on delete cascade`; otherwise deletion is restricted while another
row refers to the target. Relationship values are live entity handles, never public text IDs.

## App datasource configuration

The catalog does not own provider identity. An app mounts either the keyless `Memory` provider or
the configured `Local` provider:

```tao
use Local from @tao/data

app WordFlower {
   Name "WordFlower"
   Navigator WordFlowerNavigator
   Datasource Local with {
      StorageKey "WordFlowerData"
   }
}
```

`StorageKey` is required and nonempty for `Local`. It is unique within the app's datasource
configuration and belongs to that configured provider—not to a display `Name`, source filename, or
data declaration. `Memory` has no key. Local persists the version-1 envelope containing schema
version, rows, and next generated ID; the explicit key preserves rehydration and next-ID continuity.
A load, format, version, or save failure becomes provider error state and never silently falls back
to memory.

Remote sync, authentication, permissions, migrations, transactions, pagination, aggregation, and
provider-specific query features remain deferred.

## Queries

Queries are reactive lists and are declared in unconditional definition or root-render placement
before first use and before control flow:

```tao
query Workspaces { }

query Drafts from Workspace.Documents {
   where Draft
}

query Workspace.Documents as FinishedDocuments {
   where Final
   order by CreatedAt desc
}
```

The source is either a root plural or a plural relationship. A query may keep the source name, use
`Name from Source`, or use `Source as Name`. Repeated `where` clauses combine with AND. Primitive
comparisons support `==`, `!=`, `<`, `<=`, `>`, and `>=`; boolean cases are filtered by case name.
One explicit order may override the source entity's default order. Generated hooks are hoisted while
preserving lexical visibility and the authored declaration-order rules.

Queries and lists expose `.Count`. Emptiness is tested with `Value is empty`. Query status cases are
mutually exclusive:

- `loading` while the provider is loading;
- `error -> Message` while it has failed;
- `empty` only when ready with zero rows;
- the ordinary ready, nonempty path when none of those cases match.

`Message` is scoped to the matched error handler. The retired `.Empty`, `.Loading`, and `.Error`
members are not part of the public contract.

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
for React keys and an index fallback for non-entity lists. Stable entity IDs remain runtime-private;
there is no public `.Id` member or ID-based test selector.

## Deterministic provider-state tests

Every Tao check receives a fresh Memory replacement for the launched app's datasource. Bare status
steps drive that active provider without touching durable storage:

```tao
data loading
expect text "Loading documents…"
data error "Storage unavailable"
expect text "Storage unavailable"
data ready
```

See `Tao Testing.md` for selector, row-scope, and isolation rules.
