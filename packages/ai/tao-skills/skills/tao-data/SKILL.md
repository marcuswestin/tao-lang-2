---
name: tao-data
description: >-
  Model Tao app data and storage boundaries. Use when defining entities or relations, building
  queries and writes, preparing data fixtures, configuring datasources, or adding typed TypeScript adapters.
---

# Tao Data

Top-level `data Plural / Singular` declarations define stored rows. Primitive field types are
`text`, `number`, `boolean`, and `time`. A case-named boolean uses `Done yes / Pending no`; a bare
`Flag yes / no` has an unnamed false side. Implemented field traits include literal/default `now`,
`title`, and `unique`. Entity storage entries include `index`, one default `order by`, and
`local only`. Separate data entries with commas; use `unique Workspace + Person` for a composite constraint.

```tao SkillData.tao
data SkillProjects / SkillProject {
   Name text (title),
   Tasks SkillTasks (owned),

   order by Name,
}

data SkillTasks / SkillTask {
   Title text (title),
   Done yes / Pending no,
   CreatedAt time (default now),
   Project SkillProject,

   index CreatedAt,
   order by CreatedAt desc,
}
```

A singular relationship stores a live entity handle. The owner's plural `(owned)` relation enables
cascade deletion. Without ownership, deletion is restricted while another row refers to the target.

## Datasources

`Datasource Local { StorageKey "..." }` persists rows on the device. `Memory { }` is ephemeral.
`Dev`, `Http`, `InstantDB`, `ICloud`, and `CloudKit` are also implemented provider declarations with
provider-specific configuration. The `remote none` line in `project` metadata says the project has
no publication remote; it does not configure app data.

## Queries and writes

- `query Things { }` reads a root entity; `query Name = Parent.Children with { }` reads a relation.
- Add repeated `where` clauses, one `order by Field [asc|desc]`, and `limit N`. Root queries may use
  `query Things as Name`. Queries and lists expose `.Count` and `is empty`.
- Guard first-fill `loading`/`error`; `empty` means a ready zero-row result. `refreshing` and `stale`
  retain already-filled rows.
- Use `loop Things / Thing` to render rows.
- `create Thing { Field: Value }`, `update Thing { ... }`, and `delete Thing` operate on live handles.
  Defaults fill omitted create fields; labels resolve ambiguous fields.

## Fixtures and scenarios

Declare deterministic rows in `fixture Name { Handle = create Thing { ... } }`, then attach one with
`fixture Name` in a `scenarios` group. Fixtures feed Studio scenarios; ordinary behavior journeys
start with a fresh isolated store and do not receive fixture rows.

## TypeScript adapters

Use a sidecar when an external API cannot be expressed in Tao. Derive a datasource from `Http`, type
its `Adapter` with `item is Export from ./Adapter.ts`, and export that exact named value. In the
sidecar, import `TR` from `@runtime/TR`, build `TR.Http.adapter`, declare supported query shapes with
`TR.Http.on`, and call `upsert` or `upsertInto`. Rows reconcile by the entity's one `(unique)` field.

Tests must run a deterministic adapter variant, not the network. Optional fields, arbitrary query
transforms, user-triggered refresh syntax, and direct provider-state test steps are unavailable.
