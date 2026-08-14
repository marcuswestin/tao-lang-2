# Tao Data

Status: authoritative functional-MVP implementation.

Tao's MVP data layer is a typed, reactive application capability. Tao source declares provider-neutral schemas, queries, and writes. An `app` chooses a provider, generated TypeScript passes schema metadata and query/write plans to `TR.Data`, and the runtime owns loading, persistence, subscriptions, stable entity identity, and provider errors.

## Schemas and app datasources

Schemas describe data shape independently of storage:

```tao
project data WordFlowerData {
   Workspaces Workspace {
      Name text
      CreatedAt time indexed default now()
   }
   Documents Document {
      Title text
      Body text default ""
      Final boolean default false
      CreatedAt time indexed default now()
      Workspace relation Workspace on delete cascade
   }
}

app WordFlower {
   datasource WordFlowerData through Local
   stack WordFlowerNavigation
}
```

A schema contains explicitly named collection/entity pairs. Primitive fields support `text`, `number`, `boolean`, and `time`. Fields are required unless they declare a default. Text, number, and boolean fields accept matching literal defaults; `now()` is the implemented `time` default. `indexed` records indexing intent in compiled schema metadata. Schema evolution and index-backed query execution remain future work.

Relationships are explicit and target another entity in the same schema. Tao code supplies a value of that entity type, not a text ID:

```tao
Workspace relation Workspace on delete cascade
```

Without `on delete cascade`, deletion is restricted while another row still refers to the target. Explicit cascade deletes dependent rows transitively. Relationship reads return the related live entity handle, so chained reads such as `Document.Workspace.Name` observe the current row.

An app binds each schema with `datasource Schema through Provider`. The implemented providers are:

- `Local`, which loads and saves asynchronously through AsyncStorage. It persists a versioned envelope containing schema version, rows, and the next generated ID. A load, format, version, or save failure becomes provider error state; Local never silently falls back to memory.
- `Memory`, which implements the same contract without durable storage. Tao behavior checks replace every schema with a fresh memory provider so checks cannot read or mutate application data.

Remote sync, authentication, permissions, migrations, transactions, pagination, aggregation, and provider-specific query features are deferred.

## Reactive queries and live entities

Queries are declared directly in a view before its actions and render root:

```tao
query WordFlowerData.Documents as Drafts {
   where Workspace == Workspace
   where Final == false
   order by CreatedAt asc
}
```

A query is a reactive list. Each filter value is reevaluated from current Tao values, and repeated `where` clauses combine with AND. The MVP supports `==`, `!=`, `<`, `<=`, `>`, and `>=`; boolean and relationship fields accept only equality or inequality. A relationship filter requires a live handle for the declared target entity from the same schema instance. A query may order by one primitive field, ascending by default or explicitly `asc`/`desc`. Relationship fields cannot be ordered.

Rows expose their declared fields plus a stable text `Id`. At runtime, the same schema/entity/ID resolves to the same live entity handle while that provider store is active. Updating a row changes what existing handles read; relationship fields resolve to handles rather than exposing their stored IDs. This lets a destination safely accept `WordFlowerData.Document` and continue observing that document after writes elsewhere.

Lists expose `Empty` and `Count`. Query values additionally expose:

- `Loading`: whether the provider is still loading;
- `Error`: empty text while healthy, otherwise a user-presentable provider error.

Views author loading, error, empty, and populated UI with ordinary total render `when` branches:

```tao
when
   Documents.Loading -> {
      Text("Loading documents…")
   }
   not Documents.Error.Empty -> {
      Text(Documents.Error)
   }
   Documents.Empty -> {
      Text("No documents")
   }
   otherwise -> {
      for Document in Documents {
         Text(Document.Title)
      }
   }
```

`otherwise` is required. Conditions are checked lazily in source order, and only the first matching branch renders.

## Writes

Writes are action statements:

```tao
action AddDocument Workspace is WordFlowerData.Workspace, Draft is text {
   create WordFlowerData.Document {
      Title Draft
      Workspace Workspace
   }
}

action FinishDocument Document is WordFlowerData.Document {
   update Document {
      Final true
   }
}

action DeleteDocument Document is WordFlowerData.Document {
   delete Document
}
```

`create` requires each non-defaulted field exactly once. Omitted defaulted fields receive their declared literal or `now()` value. `update` and `delete` require a typed live entity handle, not arbitrary text; an update accepts declared fields only. Runtime checks also reject unknown fields, wrong primitive values, missing relationship targets, handles from another schema, and operations on deleted rows.

A successful write updates the in-memory store and publishes a reactive revision immediately. Local persistence is then serialized through an asynchronous save queue, preserving write order. A failed save surfaces through `Error`; writes attempted while a provider is loading or failed are rejected rather than silently discarded. When a newer snapshot was already queued and saves successfully, it proves the current data durable and clears that save-origin error.

## Deterministic provider-state tests

Tao checks can exercise non-ready providers without clocks, sleeps, or external services:

```tao
data WordFlowerData loading
expect text "Loading documents…"
data WordFlowerData error "Storage unavailable"
expect text "Storage unavailable"
data WordFlowerData ready
```

These steps affect only the check's isolated memory provider and flush the reactive render. They test application-owned loading and failure UI; production provider selection belongs only in the app's `datasource` statement.
