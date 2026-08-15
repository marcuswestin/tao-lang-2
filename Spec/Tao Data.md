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
   Documents (relation Documents, auto-delete)
   index CreatedAt
   order by CreatedAt
}

data Documents / Document {
   Title text
   Body text (default "")
   Final yes / no Draft
   Public yes / no Private (default Public)
   CreatedAt time (default now)
   Workspace (relation Workspace)
   Paragraphs (auto-delete)
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
The bare `now` value is valid only as a `time` default; generated schema metadata preserves it as a
clock default and the runtime samples it separately for every create. It is not evaluated while
parsing or compiling, and the text literal `"now"` remains ordinary text.

A case-named boolean has the form `Name yes / no [NoAlias] [(default Case)]`. Its positive case is
the field name. With no alias, the `no` side is unnamed; otherwise the alias is its case name, as in
`Final yes / no Draft`. The `no` side is the default unless a declared case is selected by
`(default Case)`. `Pinned` and `Public` above demonstrate the unaliased and explicit-default forms.
They exercise declaration syntax and do not require product journeys. Writes, `is <Case>` tests,
and boolean query filters use named declared cases rather than raw spelling conventions.

Indexes are separate statements, and one default `order by` may be declared for the entity.

A bare singular name such as `Workspace` is a stored to-one relationship when it names another
entity. A bare plural name such as `Paragraphs` is an inferred inverse to-many relationship. The
`relation` modifier states the related declaration explicitly when inference is insufficient.
`auto-delete` belongs on the owner's inverse collection: deleting that owner transitively deletes
the related rows in the collection. A stored to-one relationship does not declare cascade policy;
without owner-side `auto-delete`, deletion is restricted while another row refers to the target.
Relationship values are live entity handles, not text IDs.

## App datasource configuration

The catalog does not own provider identity. An app constructs a datasource from a declaration. A
constructor takes a bare block; `with` is reserved for immutable patches of an existing value:

```tao
use Local, Memory from @tao/data

app WordFlower {
   Name "WordFlower"
   Navigator WordFlowerNavigator
   Datasource Local {
      StorageKey "WordFlowerData"
   }
}

let WordFlowerDemo = WordFlower with {
   Datasource Memory
}

workspace let WordFlowerPreview = WordFlower with {
   Datasource with {
      StorageKey "WordFlowerPreviewData"
   }
}
```

`Local { ... }` is construction, and its declaration requires a text `StorageKey`. `Memory` declares
no properties, so bare `Datasource Memory` constructs its all-defaulted value. A property-position
`Datasource with { ... }` patch starts from the datasource held by the base app; it does not mutate
that app or reconstruct by provider name. The same patch rule applies to a configured datasource
named with `let`.

The storage key belongs to the configured provider—not to a display `Name`, source filename, or
data declaration. Local persists the version-1 envelope containing schema version, rows, and the
next generated ID; an explicit key preserves rehydration and next-ID continuity. A load, format,
version, or persist failure becomes provider error state and never silently falls back to memory.

When a bound datasource cannot load at all, the runtime blocks that app behind a recovery boundary
reporting the load error, rather than leaving every screen rendering against unusable data. The
boundary can reset the stored envelope and remount the app root, so recovery needs no manual
restart. Schemas with no bound datasource keep their ordinary query error state instead.

## Self-hosted datasource declarations

`Local` and `Memory` are ordinary public Tao declarations in `@tao/data`, not compiler-known names:

````tao
public datasource Local {
   StorageKey text

   implement inject provider ```ts
      return TR.DataProvider.Local()
   ```
}

public datasource Memory {
   implement inject provider ```ts
      return TR.DataProvider.Memory()
   ```
}
````

A `datasource` declaration is top-level rather than nested, has `package`, `workspace`, or `public`
visibility, and binds exactly one `implement inject provider`. Its declared properties are the
complete generic configuration contract: construction and patch validation read their names and
types from the linked declaration, so copied and third-party datasources receive the same unknown,
duplicate, missing, and type diagnostics without a shipped-name table.

The implementation may remain an inline `ts` fence or name a sibling TypeScript sidecar, for
example `implement inject provider "./Local.ts"`. A sidecar default-exports a zero-argument factory;
the compiler copies and imports it into generated output and evaluates it once for the declaration.
The resulting package-scope value satisfies the published `TR.DataProvider` full-snapshot protocol.
`load(storageKey)` returns the starting serialized snapshot
or no value; `persist(storageKey, snapshot)` accepts complete committed snapshots in order and must
propagate rejection. `TR.testProvider` checks empty load, exact round trips, storage-key and provider
instance boundaries, ordered replacement, and rejection behavior. Instances must be isolated or
share one coherent stateless storage boundary. The shipped Memory and Local implementations pass
that suite. Memory is process-local and instance-isolated; Local delegates its storage boundary to
AsyncStorage.

Remote sync, authentication, permissions, migrations, transactions, pagination, aggregation, and
provider-specific query features remain deferred. They require new provider families rather than
leaking incremental or remote semantics into this full-snapshot protocol.

## Queries

Queries are reactive lists and are declared in unconditional definition or root-render placement
before first use and before control flow:

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
order. Generated hooks are hoisted while preserving lexical visibility and the authored
declaration-order rules.

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

Every Tao check receives a fresh instance of the shipped Memory provider in place of the launched
app's datasource. The app's configured provider cannot overwrite that isolation. Bare status steps
drive the active schema without touching durable storage:

```tao
data loading
expect text "Loading documents…"
data error "Storage unavailable"
expect text "Storage unavailable"
data ready
```

See `Tao Testing.md` for selector, row-scope, and isolation rules.
