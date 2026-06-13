# Package Access

## Purpose

Exercise positive behavior for local project package access, package-indexed imports, bare same-package imports across package folders, project-visible imports, and local project metadata.

## Belongs Here

- `project { name "..." remote none license ... }` metadata.
- `use ... from @package/subfolder` where the package folder is nested inside the project.
- Bare `use Foo` for `package` declarations in sibling files, sibling folders, and child folders in the same `@package`.
- `project` declarations imported across indexed local packages.
- Runtime rendering for package-imported views and aliases.

## Does Not Belong Here

- Invalid package-resolution, duplicate-package, or visibility diagnostics.
- External projects, `requires`, install/update/publish commands, remotes, or lockfiles.
- Import aliases such as `use Foo as Bar from @package`.

## Edit When

- Local package resolution or project metadata behavior changes.
- Runtime package import behavior changes in ways that affect valid app execution.

## Behavior Test Notes

- `packages/runtime/runtime-tests/runtime-e2e.jest-test.tsx` renders this app and asserts the visible output.
- Expected visible output:
  - `Package access works`
  - `Package sibling file works`
  - `Package sibling folder works`
  - `Package child folder works`
  - `Project alias works`
  - `Project UI works`
