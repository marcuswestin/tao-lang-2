---
name: tao-data
description: Model Tao entities, relations, queries, writes, fixtures, datasources, and typed TypeScript adapters.
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
The release-1 public surface permits Local, Memory, and Dev. `Http` and multiple datasources arrive
in release 2; CloudKit private sync arrives in release 4. Other hosted providers remain outside the
five public releases. The `remote none` line in `project` metadata says the project has
no publication remote; it does not configure app data.

## Queries and writes

- `query Things = Things` reads a root entity; `query Name = Parent.Children with { }` reads a relation.
- Add repeated `where` clauses, one `order by Field [asc|desc]`, and `limit N` inside `with { }`.
  Queries and lists expose `.Count` and `is empty`.
- Guard first-fill `loading`/`error`; `empty` means a ready zero-row result. `refreshing` and `stale`
  retain already-filled rows.
- Use `loop Things / Thing` to render rows.
- `create Thing { Field: Value }`, `update Thing { ... }`, and `delete Thing` operate on live handles.
  Defaults fill omitted create fields; labels resolve ambiguous fields.

## Fixtures and scenarios

Declare deterministic rows in `fixture Name { Handle = create Thing { ... } }`, then attach one with
`fixture Name` in a `scenarios` group. Scenario syntax is available in release 1; interactive Studio
review arrives in release 3. Fixtures feed those scenarios; ordinary behavior journeys
start with a fresh isolated store and do not receive fixture rows.

## TypeScript adapters

Release 2 adds HTTP through typed adapters. Then use a sidecar when an external API cannot be
expressed in Tao. Derive a datasource from `Http`, type
its `Adapter` with `item is Export from ./Adapter.ts`, and export that exact named value. In the
sidecar, import `TR` from `@runtime/TR`, build `TR.Http.adapter`, declare supported query shapes with
`TR.Http.on`, and call `upsert` or `upsertInto`. Rows reconcile by the entity's one `(unique)` field.

Tests must run a deterministic adapter variant, not the network. Optional fields, arbitrary query
transforms, user-triggered refresh syntax, and direct provider-state test steps are unavailable.
