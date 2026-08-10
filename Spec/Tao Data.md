# Tao Data

This document describes how a Tao app declares the data it stores, reads it back, and changes it.

Status: implemented. Every construct below runs today through `Apps/Test Apps/Data MVP` and `Apps/MVP/Current/Still.tao`. Deferred extensions are listed at the end and are owned by `Roadmap/Functional language MVP/Deferrals.md`.

## Schemas

A `data` declaration names one schema. Each entry pairs the collection that stores rows with the entity that describes one row.

```tao
data StillData {
   Workspaces/Workspace {
      Name text indexed
      CreatedAt time default now()
   }

   Tasks/Task {
      Title text indexed
      Notes text
      Done boolean default false
      CreatedAt time default now()
      Workspace
   }
}
```

- `Collection/Entity` reads as "the `Workspaces` collection stores `Workspace` rows". Queries name the collection; values and types name the entity.
- A field is `Name <type>`, where the type is `text`, `number`, `boolean`, or `time`. `time` is a millisecond instant and behaves as a number.
- A field with **no** type names another entity in the same schema and stores that entity's identifier. `Workspace` above is a belongs-to reference.
- `indexed` marks a field a provider may index. Tao records it; providers decide what to do with it.
- `default <literal>` and `default now()` supply the value used when a `create` omits the field.
- Every row also carries a generated `Id text`. It is readable and never written directly.

Entity and field names are types. `StillData.Task` is the type of one task row, and `StillData.Task.Title` is that field's type, so a view can accept a row and a state can hold a field-typed value.

```tao
view TaskRow Task is StillData.Task {
   render Text("{Task.Title}")
}
```

## Queries

A view reads rows with `query`. Inside `where` and `order`, the queried entity's field names are in scope directly, so a filter reads like the row it filters.

```tao
view TasksScreen Current is StillData.Workspace {
   query AllTasks = StillData.Tasks where Workspace == Current.Id order CreatedAt asc
   query OpenTasks = StillData.Tasks where Done == false order CreatedAt asc

   render Col() {
      for Task in AllTasks {
         TaskRow(Task)
      }
   }
}
```

- `order <Field> asc|desc` sorts; the direction defaults to ascending.
- A query value is a live list. It iterates with `for` and answers `.Count`, `.Empty`, `.Loading`, and `.Failed`.
- Queries are reactive: any write that changes matching rows re-renders the views reading them.
- A field name shadows outer values inside `where` and `order`. Name the surrounding value something else when both are in scope, as `Current` does above.

## Mutations

Mutations are action statements.

```tao
action AddTask {
   create StillData.Task { Title: DraftTitle, Notes: "", Workspace: Current }
}

action Complete {
   update Task { Done: true }
}

action Remove {
   delete Task
}
```

- `create <Data>.<Entity> { Field: value, … }` inserts a row. Omitted fields take their declared defaults.
- `update <entity value> { Field: value, … }` writes the named fields of an existing row.
- `delete <entity value>` removes the row.
- A reference field accepts either the related entity or its identifier; an entity value contributes its `Id`.
- An entity value is a **reference**, not a snapshot: a screen holding a row sees later updates to it.

## Providers

An app binds a schema to the provider that stores it:

```tao
app Still {
   view WorkspacesScreen
   datasource StillData through Local
}
```

- `Memory` keeps rows for the running process.
- `Local` stores rows on the device and needs no credentials or configuration.

The provider boundary is deliberately narrow: a provider loads one starting snapshot and is told about each committed change. Defaults, identifiers, query evaluation, reactivity, and status all belong to the Tao runtime, so every provider behaves the same way and adding one is small.

While a provider is loading, queries report `.Loading`; if the load fails they report `.Failed` and the app keeps its last valid state. Apps are expected to render those states:

```tao
when
   Workspaces.Loading -> {
      Text("Loading workspaces")
   }
   Workspaces.Failed -> {
      Text("Workspaces are unavailable right now")
   }
   Workspaces.Empty -> {
      Text("No workspaces yet. Add one to get started.")
   }
   otherwise -> {
      for Workspace in Workspaces {
         WorkspaceRow(Workspace)
      }
   }
```

## Testing

Tao tests always load through a fresh provider, so checks never inherit each other's rows or the device's stored data. A check makes a provider state explicit when it wants one:

```tao
check "shows a recoverable error when data cannot load" {
   run Still with { data failing }

   expect text "Workspaces are unavailable right now"
}
```

`data loading` holds the app in its loading state; `data failing` fails the load. With neither, the check runs against an empty in-memory store.

## Deferred

Relationship traversal (`Task.Workspace.Name`), query field selection, aggregate queries, transactions, `link`/`unlink`, conflict policies, `guard`, schema migrations, and remote or syncing providers are not implemented. `Roadmap/Functional language MVP/Deferrals.md` and `Roadmap/Deferred Tao language decisions.md` own them.
