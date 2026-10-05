# Tao Projects, Modules, and Packages

Status: source implementation written. Release validation and acceptance are tracked in
[the execution plan](../Roadmap/Plan%20-%20Tao%20projects%20modules%20and%20packages.md).

The implemented package surface includes `@tao/text`, `@tao/time`, `@tao/linking`, and the curated
`@tao/device/{haptic,clipboard,share}` capabilities. Zero-argument view declarations may omit `()`;
argumentful views and every action/function declaration retain parentheses.

`@tao/text` exports `CountWords(Value text)` and `Join(Values list of text, Separator text)`.
`CountWords` trims and counts Unicode-whitespace-delimited words, returning zero for empty or
all-whitespace text. `Join` preserves source order, inserts the separator only between adjacent
values, returns empty text for an empty list, and returns a one-item list's value unchanged.

`@tao/time` exports the `Ticker` type and `Interval(Every duration)`. A ticker is a reactive library
value: `Value` is the time as of its latest tick, `Running` whether it ticks, and `Start()` and
`Stop()` control it. It ticks for as long as the view holding it is mounted, and an ordinary `let`
over `Value` recomputes on every tick. There is no clock declaration, no live binding, and no `every`
clause: a ticking clock is a library value, not a language construct.

`@tao/device/haptic` exports `HapticKind`, `Haptics`, and `Haptic()`. `Haptics.Play(HapticKind)`
accepts the semantic cases `Selection`, `Light`, `Medium`, `Heavy`, `Success`, `Warning`, and
`Error`; the runtime translates them to the platform vocabulary. Haptics safely does nothing on
web or when the backing capability is unavailable.

`@tao/device/clipboard` exports `Pasteboard` and `Clipboard()`. A pasteboard has `Copy(text)` and
`Read()` actions plus reactive optional `Value`: `Value` is `none` until a read finishes, then holds
the result of the most recently started read once it finishes; an older in-flight read cannot
overwrite it. Copying does not update `Value`, because the system clipboard remains independently
mutable.

`@tao/device/share` exports `ShareSheet` and `Share()`. `ShareSheet.Open(text)` opens the platform
share sheet and waits for the native operation, but exposes no shared-versus-dismissed result.
Action outcomes remain future language work rather than a reactive lookalike result.

`@tao/linking` exports `OpenUrl(Url text)`. The action hands the URL to the platform URL service
and waits for that handoff. An empty URL is a no-op. Test hosts skip the external launch so a
journey can press the command without opening a browser.

These packages are ordinary Tao declarations bound to TypeScript sidecars through the same
expression-position `from` a third-party package would use, which is the whole mechanism — no
compiler-known names are involved.

## Creating a Tao Project

- `tao create "<description>"` creates a new project directory from a sentence describing the app.
  The description may name web pages and local image files; Tao reads the pages to text and the
  images to a color palette before any model is involved.
- The command writes the canonical layout of `Docs/Roadmap/Tao Revolution/Decisions.md` §1, as far
  as the toolchain runs it today: `App.tao` (app metadata and configuration), `Data.tao`, `Chrome.tao`,
  `Design.tao`, one folder per feature with a list and a detail scene, `Scenarios.tao`,
  `<App>.test.tao`, `tsconfig.json` (extending the generated `.tao/cache/typescript/tsconfig.json`), a tracked
  `.tao/store/project.json` project identity, and the committed generated-Tao scaffold `@/.gitkeep`. The result is
  formatted, validated, and its behavior tests are run before the command reports success;
  `--skip-tests` skips only the test run.
- The initial app `id` is also the directory name. `--id <id>` chooses it; otherwise it is suggested
  from the display name and confirmed at the prompt. An id is lowercase letters, digits, and
  hyphens.
- A model may shape the plan — the app's name, entities, fields, colors, and sample rows — but never
  writes Tao: Tao validates the plan and decides every placement. Lanes are tried in order and the
  first one the person accepts is used: an installed agent harness, a listening Ollama,
  then Apple's on-device model. `--ai <lane>` picks one, `--ai none` writes the plain starter, and
  `--yes` accepts the first lane, the suggested id, and the plan without asking. Without a terminal
  to ask, no lane is used unless `--yes` or `--ai` chooses one.
- `Apps/Starters/` holds the exact output for the reference plans; `Apps/Starters/README.md` owns
  that contract.
- For example, `tao create "A notebook for short notes I can pin" --ai none --yes` creates
  `./a-notebook-for/` with `id "a-notebook-for"`, and `--id notebook` names it `./notebook/`.

### Creating a Tao app

- The app selects a primary navigator; see `Tao Presentation and Navigation.md` for its behavior.

```tao
use Local from @tao/data/providers/local
use StackNav from @tao/nav
use Col, FormButton, Text from @tao/ui

data Messages / Message {
   Text text
   CreatedAt time (default now)
   order by CreatedAt
}

app ChatApp {
   id "chat"
   version "0.1.0"
   name "Chat"
   Navigator ChatStack
   Datasource Local {
      StorageKey "ChatData"
   }
}

nav ChatStack = StackNav { Initial ThreadListUi }

scene ThreadListUi() {
   Title "Threads"
   query Messages { }

   render Col() {
      loop Messages / Message {
         Text(Message.Text)
         FormButton("Open thread") {
            on press -> { present ThreadUi(Message) }
         }
      }
   }
}

scene ThreadUi(Message) {
   Title Message.Text
   render Col() {
      Text(Message.Text)
      FormButton("Open another occurrence") {
         on press -> { present ThreadUi(Message) }
      }
   }
}
```

A project is the nearest ancestor containing a `.tao/` directory. A tracked `.tao/store/project.json`
contains an automatically generated project ID, retained across clones and build snapshots. The ID
keeps persisted declaration origins independent of physical checkout paths. No special Tao filename or `project` declaration is
required. Root Tao files may contain ordinary declarations, apps, and publications. Nested projects
are isolated; discovery excludes generated and installed trees.

Every runnable app has effective lowercase `id`, `version`, and `name`. `with` inherits these fields,
configuration, and dependencies and may override them. Effective ID/version pairs must be unique
within the defining project, and versions accept full SemVer including prereleases. The effective app
ID identifies Tao-managed persistent state across release versions. Explicit datasource configuration
independently controls backend sharing. Older state stores remain untouched during the identity-key
transition; they are not deleted or automatically merged.

An app's runnable identity and dependencies do not publish an importable module API. Publishing code
requires a separate `package` declaration and its explicit module inclusion and visibility rules.

A module is a named `@<name>` folder and its subfolders. Names are local to their project; lookup
never enters a nested project or climbs beyond the owning root. Registered dependency aliases and
local module names must be unambiguous. Module names are import addresses, while a `package`
declaration describes a publication. The `package` visibility modifier retains its narrower,
same-module meaning.

The top-level data declaration supplies singular and plural names. Each explicit import exposes
only the name listed:

```tao
use Workspaces, Workspace from @data // collection and entity
use Workspaces from @data            // collection only
use Workspace from @data             // entity only
```

These are alternative import lines. Importing `Workspaces` does not make `Workspace` available as
an entity type or `create` target, and importing `Workspace` does not expose the `Workspaces`
collection. A `loop Workspaces / Workspace` declares a local row binding and needs only the
collection import. Accessing a relationship such as `Workspace.Documents` does not require an
import of the root `Documents` collection. Local declarations and implicitly visible `folder`
declarations retain both names. Import organization and unused-import diagnostics track each
imported form independently.

`use all from Path` imports every public declaration from that target, including both names of
public entity data. It supports the same relative, module and dependency paths as named imports;
named imports retain their existing visibility rules. Wildcard imports never expose file, folder
or module-private declarations. Type and value names occupy separate namespaces. Every wildcard
binding must be unambiguous, even when unused: collisions with local declarations or another import
are errors. Import organization preserves the wildcard, and unused-import checks do not recommend
removing individual exports from it. Generated runtime imports include only referenced values.

```tao
use all from @tao/ui
use all from ./PublicData
```

The UI presents first-class
view values; bare `@tao/nav` selects the native kit, so `StackNav` owns the corresponding native
transition and reads a directly presented scene's reactive `Title` and optional `Toolbar`; a plain
view receives Back-only chrome.

## Modules and declaration visibility

### Creating a Tao module

- You create a module by naming a folder `@<module name>` and writing `.tao` files in it
  - Declarations under `@<package>` are referenced via `use Foo from @<package>`
  - A declaration is referenced by its folder name, _not_ its file's name
  - The project root is not itself a named module

### Generated project package

Every Tao project reserves its root `@/` directory for committed generated Tao source. It is one
package named exactly `@`, with one subfolder per generator. Studio owns `@/studio`, whose public
views are imported normally, for example `use View1 from @/studio`. Existing named package spellings
such as `@tao/ui` are unchanged. Only the project-root directory has this meaning; a nested directory
whose literal name is `@` is an ordinary directory and remains reachable within its containing
package.

Generated source may use ordinary relative imports back into its owning project, such as
`use Playlist from ../../Data` from `@/studio/View1.tao`. This is a narrow one-way exception: authored
project source cannot cross into `@/` by relative path, generated source cannot cross relatively into
another named package, and all declaration visibility rules still apply.

Generated files are read-only working-tree artifacts. `tao fix`, `tao fmt`, and repository dprint
lanes check them but never rewrite them. The owning generator temporarily enables only owner-write,
restores mode `0444` after success or failure, and repairs that mode when it opens a project. A
generated file begins with an ownership header; moving it to an authored package removes that
ownership and any generator-private rectangle markers, then rewrites its `@/studio` import sites.

### Making packages available to other files

- You make a declaration available to other files by declaring its visibility: `file`, `folder`, `package`, `project`, or `public`.

  - `file` is the default and is normally omitted.
    - `view Foo() { ... }` is equivalent to `file view Foo() { ... }` and cannot be used outside its file.

  - To make declarations visible to other files in _the same package_ you use `package` visibility:
    - `package view Foo() { ... }`
      - `Foo` can now be referenced from other files in the same package, e.g:
      - `use Foo` from any file in the same package
      - `use Foo from ./` from a file in the same folder
      - `use Foo from ./<sub-folder>` from a parent folder (that's in the same package)
      - `use Foo from ../<parent-folder>` from a child folder (that's in the same package)

  - To make declarations visible to files in the same project you use `project` visibility:
    - If `project view Bar() { ... }` is declared in `@foo/filename.tao`:
      - then `use Bar from @foo` can be used from any file in the same project
    - If `Bar` is declared in `@foo/bar/utils.tao`
      - then `use Bar from @foo/bar` can be used from any file
    - A `project` declaration remains inaccessible to consumers even when the project publishes a package.

  - `public` declarations in modules listed by a selected publication are its consumer API.
    Root declarations and excluded modules are never direct publication entrypoints, even when
    marked `public`. Included code may call reachable private helpers under the defining project's
    visibility rules. Those helpers and their TypeScript implementations remain private to consumers.
    A corresponding public Tao declaration is required for every exported sidecar-backed entrypoint.

  - A folder is not allowed to make two declarations with the same name visible
    - If `@<package>/file.tao` has `package view Foo() { ... }`, then:
      - `@<package>/file2.tao` with `package view Foo() { ... }` is not ok
      - `@<package>/file2.tao` with `project view Foo() { ... }` is not ok
      - `@<package>/file2.tao` with `public view Foo() { ... }` is not ok
      - `@<package>/subfolder/file3.tao` with `<visibility> view Foo() { ... }` _is_ ok

## Using available code from other packages

- Packages and their subfolders can be referenced via `@<package>` and `@<package>/<subfolder>`;
  generated project source uses the reserved forms `@` and `@/<subfolder>`
  - `use Foo from @<package>`
  - `use Bar from @<package>/<subfolder>`
  - `use Cat, Mat from @<package>/<subfolder1>/<subfolder2>`
  - A package file can reference other `package`-visible declarations in the same package:
    - `use Foo` // By declaration name, without a path
    - In subfolders, by relative path
      - `use Foo from ./<subfolder>`
      - `use Bar from ./<subfolder1>/<subfolder2>`
    - In parent folders (if same package)
      - `use Foo from ..`
      - `use Bar from ../..`
    - In sibling folders (if same package)
      - `use Foo from ../<sibling folder>`
      - `use Bar from ../<sibling folder>/<nephew folder>`

- Cross-package references are referenced by `@<package>`, from anywhere in the project
  - Cross-package references _do not_ use relative paths
  - `use Cat from @cat` is ok
  - `use Mat from ./@mat` not ok
  - `use Bat from ../<sibling folder>/@animals` not ok

- Declarations are referenced by their folder, not their file names
  - If `@<package>/<filename>.tao` has:
    - `public view Foo() { ... }`, then Foo is available via `@<package>`:
    - `use Foo from @<package>`
  - If `@<package>/<subfolder>/<filename>.tao` has:
    - `public view Bar() { ... }` then Bar is available via `@<package>/subfolder`:
    - `use Bar from @<package>/<subfolder>`

### Package cycles and order of evaluation

- Cyclical package imports are allowed when their value dependencies are valid.
- Tao discovers declarations and resolves references across the complete package graph before initializing values. Source order, import order, and generated TypeScript module traversal do not define language semantics.
- Callable declarations may refer across an import cycle because discovering them does not eagerly evaluate a value.
- Immutable values initialize according to their dependency graph. Strongly connected value components with no already-available base value produce one deterministic initialization-cycle diagnostic.
- A cyclic import graph with an acyclic value-dependency graph initializes successfully in dependency order.
- Generated modules must preserve this model rather than exposing JavaScript temporal-dead-zone or partial-module behavior.

### Package-owned protocol declarations and identity

Navigation kinds and datasource providers are self-hosted by ordinary package declarations. The
stdlib definitions are the proof rather than compiler exceptions:

The `nav` and `datasource` heads declare values; reusable types use
`type Name is nav|datasource with { ... }`. Their explicit `nav`/`provider` clause fills the
primitive family's implementation requirement as a protocol binding, not as ordinary Tao data.

```tao
public
type StackNav is nav with {
   Initial ui

   nav StackNavKind from ./NavKinds.ts
}

public
type Memory is datasource with {
   provider MemoryProvider from ./Providers.ts
}
```

These declarations are top-level rather than nested. Their physical file location does not change
this rule: package scope describes declaration ownership, not a requirement to live in an
`@package` folder. Each binds exactly one package-scope implementation with
`nav <Export> from <path>` or `provider <Export> from <path>`, naming a sibling `.ts` file; the
inline fence is retired. The compiler copies the sidecar into generated output and imports the
named export. That export is a zero-argument factory, invoked once when its defining generated
module initializes. `TR.NavKind` and `TR.DataProvider` are published protocols, with
`TR.testNavKind` and `TR.testProvider` conformance suites. Tao validation checks the sidecar's
location, existence, and named export; generated-output TypeScript checks and those runtime suites
establish type and behavioral conformance. The shipped `StackNav` and `Memory` declarations use the
same mechanisms available to copied or third-party packages.

### Transparent package aliases and standard kit layout

A configurable type may publish another package member transparently:

```tao
use package ./native

public type StackNav = native.StackNav
```

Unlike `type Name is Base with { ... }`, this form does not derive a new nominal declaration. The
alias and target are the same declaration identity and expose the same inferred interface,
primitive family, configuration type, implementation binding, and host-slot contract. Alias chains
must resolve to a configurable type and may not cycle. Generated code imports and re-exports the
target binding; it never emits a second protocol declaration.

The standard component kits use this facility consistently:

```text
@tao/ui/            root aliases native views
@tao/ui/native/     platform-native implementations
@tao/ui/basic/      portable implementations
@tao/nav/           root aliases native nav types
@tao/nav/native/    platform-native navigation hosts
@tao/nav/basic/     portable navigation hosts
```

Thus `use StackNav from @tao/nav` is native by default, while
`use StackNav from @tao/nav/basic` selects the clause-honoring basic host without changing the
configuration or any presentation call. Native and basic forms of a nav family publish identical
configuration and host-slot read/require sets. See `Tao Presentation and Navigation.md`.

The compiler copies the named implementation file and follows its transitive relative static imports,
literal dynamic imports, module-loading `require` calls, and re-exports across TypeScript, TSX,
JavaScript, JSX, and JSON files. Computed module paths produce a source diagnostic; interpolation-free
template literals count as literal paths. Local functions named `require` are ordinary code. It preserves
the relative graph under generated output and rewrites sibling `.tao` type imports to their emitted
declarations. Installed-package imports such as `@tao/runtime` remain external and are resolved by the
CLI-bundled `@tao/*` modules.

An explicitly ascribed action value may bind a bare function export through the same expression
boundary (`let OpenUrl is action(text) = OpenUrl from ./OpenUrl.ts`); `do` passes plain JavaScript
arguments and follows synchronous or promise completion. Packages do not need a compiler-known
primitive for each platform effect.

For every Tao source `X.tao` containing these declarations, the compiler also emits TypeScript
declarations named `<DeclarationName>Config`. A sibling sidecar can therefore import its readonly
configuration contract directly from the Tao module, for example
`import type { StackNavConfig } from "./X.tao"`. A recognized navigation profile exposes the
normalized runtime configuration received by `TR.NavKind`; other configuration declarations expose
their declaration-facing readonly property shape. A custom navigation profile that the compiler
does not yet normalize receives a conservative readonly string-keyed contract and proves its more
specific protocol/configuration join in TypeScript.

Configuration is declaration-driven. The validator reads ordinary property names, types, required
entries, and keyed-item shape from the linked declaration; it does not branch on names such as
`StackNav`, `Local`, or `Memory`. A bare block constructs a configured value. `with` patches an
existing value while retaining the originating declaration and leaving the base unchanged.

The construction model is uniform. `Type { ... }` is value-position sugar for
`Type with { ... }`; deriving from an existing value must retain `with`. Universal auto-typed `let`
remains valid, while `nav Name = ...`, `datasource Name = ...`, and `app Name = ...` provide
equivalent family-constrained heads for common product values. Those heads declare values, not new
types; reusable types use `type Name is Base with { ... }`.

Every generated protocol declaration owns a unique runtime identity. Its defining module exports
that binding, and imports and value aliases carry the same binding rather than looking the name up
again. Two generated modules may therefore declare the same spelling without overwriting or
cross-wiring each other. Configuration, mounted navigation targets, and provider selection retain
the declaration object across module boundaries and import traversal order.

## Publications and dependencies

Package declarations occur only in root-level Tao files. Each has a version, license, dependencies,
and `includes` listing named modules. An optional `name` distinguishes named publications. A project
has at most one unnamed/default publication and any number of uniquely named publications. Included
modules may overlap; publication membership does not confer directory ownership or depend on source
order. Root helpers may be used privately by included modules but cannot be published directly.

```tao
package {
   version 1.0.0
   license MIT
   includes @ui @icons
}

package {
   name "Widget Package Foo"
   version 2.0.0
   license MIT
   includes @icons
}
```

Apps and publications each declare their own dependencies. A Tao requirement selects one project,
one publication, and one version range, then binds requested included modules to local import names:

```tao
app Example {
   id "example"
   version "1.0.0"
   name "Example"
   requires ../widget-library version ^1.0.0 {
      @ui as @widgets
      @icons as @widget-icons
   }
   requires "Widget Package Foo" from ../widget-library version ^2.0.0 {
      @icons as @extra-icons
   }
   requires ts npm:date-fns version 4.1.0 as date-fns-v4
   view Main()
}
```

Local project paths are relative to the declaring project root. Omitted publication name selects
only its unnamed/default package, never a sole named package. Every requested module must be listed
by the selected publication. Aliases preserve module subpaths and originating declaration identity;
selected versions remain distinct in dependency provenance. A publication's private transitive
requirements do not grant the consumer ambient access to those modules.

Consumer Tao imports use registered aliases, for example `use Button from @widgets`. TypeScript
sidecars use native npm resolution, for example `import { format } from 'date-fns-v4'`. Installation
supports npm's native aliases, package exports, and subpaths. `tao install` defaults to all apps and
publications; explicit selection preserves unrelated installations. Remote Tao fetching, publishing,
and Companion URL installation remain deferred.

Installation reports its active phases, elapsed timings, and npm invocation count. It delegates
checking and repairing each selected npm installation to npm, including on repeated installs. Each
dependency origin's aliases share one npm tree installed by one invocation, so a peer they share is
installed once; a scoped install keeps the aliases an earlier install linked into that tree.
Repeated installs preserve unchanged managed manifests and alias links. npm uses its ordinary
cache and lock behavior; Tao does not maintain a separate installation-validity cache.

Checks and runtime publication validate each selected installed alias against its declared package
name and version range, and against its exact pin when recorded in the shared Tao lock. A compatible
package installed under the wrong alias identity cannot substitute for the declared dependency.
The lock keys each install environment by its project root relative to the locking project, so a
committed lock reads the same in every checkout and `tao install` reuses its pins anywhere.
A missing or mismatched install fails with a diagnostic that names the `tao install` command to run.
Before `tao run`, `watch`, `build`, `compile`, `ship`, or `test` compiles a project in an interactive
terminal, Tao offers to run `tao install` when the project's lock pins packages that are not
installed. Declining, or running without a terminal, leaves the compile to report them; aliases a
source declares that no lock pins yet surface only through that diagnostic.

## The `.tao` folder

The project `.tao/` contains exactly `.gitignore`, committed `store/`, ignored `local/`, and ignored
`cache/`. Stable project identity lives at `.tao/store/project.json`; the shared Tao lock lives at
`.tao/store/lock.jsonc`. Managed package installs live under `.tao/cache/install/` and generated
TypeScript configuration under `.tao/cache/typescript/`. Temporary files and locks, including the
TypeScript generation lock at `.tao/cache/locks/ts-gen-lock`, live under cache.

## Tooling files and TypeScript

```text
project/
  .tao/
    .gitignore               ignores local/ and cache/
    store/
      project.json           tracked stable project identity
      lock.jsonc             shared Tao lock: installs, ship, toolchain concerns
    local/                   developer state for this project
    cache/
      install/                managed package installations
      typescript/tsconfig.json  generated TypeScript base
      locks/ts-gen-lock      TypeScript generation lock
  .tao-ts/                   generated TypeScript contracts and checks
  node_modules/              native installed dependencies
  tsconfig.json              developer configuration
  App.tao
  @ui/
    Drawer.tao
    Drawer.ts                handwritten implementation
```

The initial root configuration contains only `{"extends":"./.tao/cache/typescript/tsconfig.json"}`.
Developer overrides are preserved; incompatible overrides are diagnosed. The checker and editor
use the same native TypeScript configuration for strictness, source selection, and import resolution.
Required overlay and implementation-check options cannot be disabled.
Generated contracts mirror
source paths, for example `.tao-ts/@ui/Drawer.tao.ts`, and contain implementation parameter, return,
and arity checks. A handwritten `Drawer.ts` retains
`import type { Drawer } from './Drawer.tao'`; the authored/generated overlay resolves the contract.
Generated imports are relative to their actual location. Dependency snapshots have isolated origin
paths so equally named files from different projects cannot resolve to one another.

The extension hides root `tsconfig.json` and `node_modules` through folder-scoped Explorer settings,
preserves intentional overrides, and provides commands to show tooling files and open configuration.
Generated origins record relative Tao source paths and exact declaration line/column for navigation.

One saved-file refresh/watch service supports `tao run`, `tao watch`, the language server, and hosts.
It refreshes initially, debounces changes for 250 ms, queues changes during active work, serializes
writers per project, and writes changed content only. It observes external file changes and local
Tao dependencies and the actual transitive TypeScript configuration inputs, including external
`extends` files, while excluding generated/install trees. Invalid Tao leaves last-good contracts
explicitly stale, reports current errors, and cannot replay a successful check. Recovery publishes
fresh contracts. Deletion prunes identified generated outputs only. `tao run` launches the app;
`tao watch` refreshes without launching a runtime. There is no public `tao dev` compatibility alias.

Project checking also covers sidecars when no runnable app is declared. Private local sidecars may
reach unmarked host directories; their exact relative source files and ownership-marker paths are
watched. Marker changes invalidate ownership even when no source bytes change, and symbolic links
cannot conceal another marked project. Builds copy only the reached external files. Checks with
external sidecar inputs are not cached; ordinary project caches include nested marker existence.
Consumed publication implementations remain confined to their defining project.
