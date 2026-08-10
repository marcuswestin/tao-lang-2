# Tao Data

Status: authoritative functional-MVP implementation.

Tao's MVP data layer is a typed, reactive application capability. Tao source declares schemas, queries, and writes; generated TypeScript passes provider-neutral plans to `TR.Data`; the runtime owns storage, subscriptions, stable row identity, and provider status.

## Schemas and providers

```tao
project data StillData local {
   Workspaces Workspace {
      Name text
      Ordering number
   }
   Tasks Task {
      Title text
      Done boolean
      Ordering number
      Workspace Workspace
   }
}
```

A schema contains explicitly named collection/entity pairs. Fields are required on create and accept `text`, `number`, `boolean`, or the singular name of another entity in the same schema. A relationship value is the related row's stable `Id`; deleting a row also deletes rows that refer to it, which gives the MVP deterministic ownership cleanup.

`local` is the normal application provider. It persists JSON synchronously through browser local storage on web and Expo's document-directory file API on native platforms. `memory` uses the same query/write contract without persistence. Tao behavior checks always override schemas with a fresh memory store so tests cannot read or mutate a developer's durable app data.

The runtime contract is provider-neutral even though this branch ships only local and memory implementations. Remote sync, authentication, permissions, migrations, transactions, pagination, aggregation, and provider-specific query features are deferred.

## Reactive queries

Queries are declared directly in a view before its actions and render root:

```tao
query StillData.Tasks as OpenTasks {
   where Workspace == CurrentWorkspace
   where Done == false
   order by Ordering asc
}
```

A query is a reactive list. Every successful write publishes a new store version, rerenders subscribed views, reevaluates filter values from current Tao state, and returns rows in deterministic order. Repeated `where` clauses are combined with AND. The MVP supports `==`, `!=`, `<`, `<=`, `>`, and `>=`; boolean fields accept only equality/inequality; one primitive field may be ordered `asc` or `desc`.

Rows expose declared fields plus a stable text `Id`. Lists expose `Empty` and `Count` as normal collection members. Query values additionally expose:

- `Loading`: boolean provider-loading state;
- `Error`: empty text when healthy, otherwise a user-presentable provider error.

Views author loading, error, empty, and populated branches with ordinary render `if/else`; there is no app-specific runtime boundary component.

## Writes

Writes are action statements:

```tao
action AddTask {
   create StillData.Task {
      Title Draft
      Done false
      Ordering NextOrdering
      Workspace CurrentWorkspace
   }
}

for Task in OpenTasks {
   FormButton .Title "Complete", .Press action {
      update Task {
         Done true
      }
   }, .Id "complete", .Disabled false, .Submitting false

   FormButton .Title "Delete", .Press action {
      delete Task
   }, .Id "delete", .Disabled false, .Submitting false
}
```

`create` requires every schema field exactly once. `update` and `delete` require a live row handle produced by a query; they never upsert by arbitrary ID. An update accepts one or more declared fields. Writes are synchronous within the Tao action, persist before publishing the reactive version, and become no-ops while the provider is loading or failed.

## Deterministic provider-state tests

Tao checks can exercise non-ready providers without clocks, sleeps, or external services:

```tao
data StillData loading
expect text "Loading tasks…"
data StillData error "Storage unavailable"
expect text "Storage unavailable"
data StillData ready
```

These steps affect only the check's isolated memory provider and synchronously flush the reactive render. They exist to test application-owned loading and failure UI, not to configure production providers.
