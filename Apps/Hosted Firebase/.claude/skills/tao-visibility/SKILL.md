---
name: tao-visibility
description: Resolve Tao names across files, feature folders, project packages, generated source, and standard packages.
---

# Tao Visibility

Declarations are private to their file unless a visibility word broadens them:

- Omitted or `file`: visible only in the declaring file.
- `folder`: visible automatically to sibling files in the same folder.
- `package`: importable from anywhere in the same Tao package, including parent and child folders.
- `project`: importable across modules under the same `.tao` root.
- `public`: importable by consumers through modules included in their selected publication.

In a normal project tree, the root and ordinary feature folders form one package. A declaration in
`Feature/Feature.tao` therefore needs `package` before `use X from ./Feature` in a root file can see
it. `folder` is enough only for siblings in `Feature/`.

```tao SkillVisibility.tao
use Text from @tao/ui

folder
view SkillFolderNotice() {
   render Text("Visible to sibling files")
}

package
view SkillProjectNotice() {
   render Text("Importable elsewhere in this project package")
}
```

## Import paths

- `use X from ./Feature`, `../Data`, or `./` uses a folder path, never a filename.
- Bare `use X` imports a visible declaration from the same package.
- Data names are independent: `use Workspaces, Workspace from @data` imports the collection and
  entity; import only the form used. A loop's local row binder needs only the collection import.
- A folder named `@name` is a Tao module. Use it as `@name` or `@name/subfolder`, never by a
  relative path.
- `@/` is the reserved generated project package. Authored code may import its public declarations
  as `use X from @/generator`, but must not edit it or cross into it by relative path.

Implemented standard package paths include:

- `@tao/ui`, `@tao/ui/basic`, `@tao/ui/native`
- `@tao/nav`, `@tao/nav/basic`, `@tao/nav/native`
- `@tao/data/providers/local`, `memory`, `dev`, `http`, `instantdb`, `icloud`, and `cloudkit`
- `@tao/text`, `@tao/time`
- `@tao/device/haptic`, `@tao/device/clipboard`, `@tao/device/share`
- `@tao/keys` and `@tao/code-editor`

These paths describe the development checkout. The public release-1 datasource surface is Local,
Memory, and Dev; Http arrives in release 2 and private CloudKit sync in release 4. InstantDB and
iCloud remain outside the five public releases. See `tao-data` for datasource usage by release.

An `unknown name` diagnostic usually means the declaration is still file-local, a `use` is missing,
or the import names the wrong folder. Widen only as far as needed.

Local dependency imports require a `requires <project-path> version <range> { @module as @alias }`
in the owning app or publication. Omitting a publication name selects only the unnamed/default
package. Named selection uses `requires "Name" from <project-path> version <range> { @module }`.
Only public declarations in included modules enter the consumer API. Private root/module helpers and
TypeScript implementations may remain reachable behind that API. Opening multiple roots in an editor
never grants cross-project visibility. Remote publishing remains deferred.
