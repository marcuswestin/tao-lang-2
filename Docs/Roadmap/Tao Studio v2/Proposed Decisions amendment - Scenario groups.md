# Proposed Decisions amendment - Scenario groups

Status: proposed wording for Ro to incorporate into
`Docs/Roadmap/Tao Revolution/Decisions.md`. The implementation and migrations use this settled project
decision, but this document does not replace the authoritative Decisions file.

## Replace dotted singular scenarios with named groups

Scenarios are declared as a string-named group containing one or more string-named entries:

```tao
scenarios WorkspaceRow "states" {
   fixture StudioWorkspace
   device phone

   scenario "novel" {
      render (Workspace: Novel)
   }
}

scenarios WordFlower "devices" {
   fixture StudioWorkspace

   scenario "phone" {
      device phone
   }

   scenario "tabletDark" {
      device tablet 1024 x 1366
      appearance dark
      network offline
   }
}
```

- `scenarios [Subject] "group" { ... }` has an optional app or view subject and a required string group
  name. Each nested `scenario "entry" { ... }` has a required string entry name.
- Group clauses are inherited defaults. An entry clause of the same kind replaces the group clause
  wholesale; this includes the mutually exclusive `run`/`render` subject clause.
- After inheritance, every entry must have exactly one fixture, device, and subject. A declaration
  subject supplies an omitted `run App` or the view name in `render (...)`.
- Entry names are unique within their group. A one-entry group is the singleton form.
- The former dotted spelling, such as `scenario WorkspaceRow.novel`, is retired without a compatibility
  alias.
- Language identity is `(group, entry)`. Compiler and Studio IDs additionally include the source path
  so the pair remains stable and unambiguous across project files.

## Migration

- `WorkspaceRow.novel` becomes group `"states"`, entry `"novel"`.
- WordFlower app device cases become group `"devices"`, with entries `"phone"` and `"tabletDark"`.
- Every other migrated dotted family preserves its old prefix exactly as the group string and its old
  suffix exactly as the entry string.
- A clause moves to the group only when it is identical for every entry. Otherwise it remains in the
  entry, preserving behavior during migration.

The compiler and Studio preview manifests advance to version 2 and carry `group` separately from the
entry label. The Studio matrix uses groups as rows and entries as left-to-right cells; source actions
address an entry with `scenarioGroupName` plus `scenarioName`.

The implementation covers grammar, scoping, validation, formatting, compiler and preview identity,
source actions, Future-app and WordFlower migration, generated focused-view execution, grouped browser
rows, keyed cell reconciliation, and offscreen iframe suspension. What remains is product validation: a
complete multi-group browser/native interaction pass, imported-scenario mounting or explicit rejection,
and execution or explicit rejection of `run App at Destination(...)` rather than default-route fallback.
