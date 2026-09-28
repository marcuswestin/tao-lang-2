# Tao Project and Packages

Status: partially implemented design draft. The current implementation supports local
`project { id "..." name "..." version "..." app AppName remote none license ... }` metadata,
`tao create` and project-ID migration, `file`/`package`/`workspace`/`public`
declaration visibility, `use ... from ...` imports for relative Tao source paths and `@tao/...`
stdlib paths, bare same-package `use Foo`, local `@package[/subfolder]` imports, the reserved root
`@[/subfolder]` generated package, and public self-hosted `nav` and `datasource` declarations. Import renaming,
`requires` resolution, external workspace installation, remotes, other CLI package commands, and package
publishing remain future work. `.tao-project/lock.jsonc` is already the single Tao-written envelope for
shipping; its `installs` concern is reserved for the future package resolver rather than a second lockfile.

The implemented package surface includes `@tao/text`, `@tao/time`, `@tao/linking`, and the curated
`@tao/device/{haptic,clipboard,share}` capabilities, and requires parentheses on every view, action,
and function declaration parameter list.

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
  as the toolchain runs it today: `App.tao` (project and app), `Data.tao`, `Chrome.tao`,
  `Design.tao`, one folder per feature with a list and a detail scene, `Scenarios.tao`,
  `<App>.test.tao`, `tsconfig.json` (sidecar TypeScript resolves `@tao/*` from the CLI-bundled
  runtime), and the committed empty generated-package scaffold `@/.gitkeep`. The result is
  formatted, validated, and its behavior tests are run before the command reports success;
  `--skip-tests` skips only the test run.
- The project `id` is also the directory name. `--id <id>` chooses it; otherwise it is suggested
  from the display name and confirmed at the prompt. An id is lowercase letters, digits, and
  hyphens.
- A model may shape the plan — the app's name, entities, fields, colors, and sample rows — but never
  writes Tao: Tao validates the plan and decides every placement. Lanes are tried in order and the
  first one the person accepts is used: an installed Claude Code or Codex CLI, a listening Ollama,
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

project {
   id "chat"
   name "Chat"
   version "0.1.0"
   app ChatApp
   remote none
   license MIT
}

data Messages / Message {
   Text text
   CreatedAt time (default now)
   order by CreatedAt
}

app ChatApp {
   Name "Chat"
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

The project `id` is an opaque, immutable value chosen by the developer and checked into the project
declaration. `tao create` writes it as the new directory's name, from `--id` or the confirmed
suggestion. For an existing directory,
`tao project id <id> [path]` creates `Project.tao`; when metadata already exists it adds the missing
ID, and repeating the same value preserves it. The ID travels with clones and published artifacts
and does not change when the project moves, gains a remote, or advances to another commit. A fork
that becomes an independent Tao project runs `tao project id <new-id> [path] --replace`, which
explicitly severs persisted-state compatibility. Required dependencies retain their own project IDs;
lockfile revisions and consumer installation names select code but do not alter declaration
identity. Two distinct dependency roots claiming the same ID are a hard resolution error. Ordinary
checking, compiling, formatting, and launching never invent or modify identity as a side effect.

A project is the self-contained ownership and dependency unit. It may expose several public package
surfaces through checked-in `@folder` names. A consuming app project installs the library project and
imports only its public declarations from those package surfaces. The defining project supplies the
canonical identity of each declaration; consumers read that identity and never recompute it.

Package names are local to their defining project. Two independent projects may both declare
`@data`, and each project's files resolve `use ... from @data` only against its own folder. Package
lookup never climbs above the owning project root or enters a nested project. When external package
installation lands, dependency declarations inside `project { ... }` will explicitly select which
package surfaces from another project enter the consumer's namespace.

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

The UI presents first-class
view values; bare `@tao/nav` selects the native kit, so `StackNav` owns the corresponding native
transition and reads a directly presented scene's reactive `Title` and optional `Toolbar`; a plain
view receives Back-only chrome.

## Using packages and publishing projects

Packages can make code available to other packages, and even other workspaces.

### Creating a Tao `@package`

- You create a package by naming a folder `@<package name>` and writing `.tao` files in it
  - Declarations under `@<package>` are referenced via `use Foo from @<package>`
  - A declaration is referenced by its folder name, _not_ its file's name
  - A workspace root folder cannot be a `@package`

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

- You make a declaration available to other files by declaring its visibility: `file`, `package`, `workspace`, or `public`.

  - `file` is the default and is normally omitted.
    - `view Foo() { ... }` is equivalent to `file view Foo() { ... }` and cannot be used outside its file.

  - To make declarations visible to other files in _the same package_ you use `package` visibility:
    - `package view Foo() { ... }`
      - `Foo` can now be referenced from other files in the same package, e.g:
      - `use Foo` from any file in the same package
      - `use Foo from ./` from a file in the same folder
      - `use Foo from ./<sub-folder>` from a parent folder (that's in the same package)
      - `use Foo from ../<parent-folder>` from a child folder (that's in the same package)

  - To make declarations visible to files in the same workspace you use `workspace` visibility:
    - If `workspace view Bar() { ... }` is declared in `@foo/filename.tao`:
      - then `use Bar from @foo` can be used from any file in the same workspace
    - If `Bar` is declared in `@foo/bar/utils.tao`
      - then `use Bar from @foo/bar` can be used from any file
    - A `workspace` declaration remains inaccessible to consumers even when the workspace is published.

  - To make declarations visible to consumers of a published workspace you use `public`:
    - If workspace `<workspace id>` has package `@animals` with `public view Cat() { ... }`
      - then a workspace with `requires <workspace id> @animals`
      - can `use Cat from @animals`
    - `public` is a visibility rule. `tao publish` is the CLI operation that distributes the workspace and its public API.

  - A folder is not allowed to make two declarations with the same name visible
    - If `@<package>/file.tao` has `package view Foo() { ... }`, then:
      - `@<package>/file2.tao` with `package view Foo() { ... }` is not ok
      - `@<package>/file2.tao` with `workspace view Foo() { ... }` is not ok
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

- Cross-package references are referenced by `@<package>`, from anywhere in the workspace
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
dynamic imports, and re-exports across TypeScript, TSX, JavaScript, JSX, and JSON files. It preserves
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

## Using external Tao Projects and packages

- To import another tao project and its packages you list them in `project { ... }` with `requires ...`:

  ```tao
  project {
     id "example.my-app"
     requires <tao project repo> @foo @bar // e.g:
     requires tao:<std package> @ui
     requires github:<author>/<repo> @baz --version 1.0.1 // declare what version to use
     requires git+https://<domain>/<path-to>/<repo> @mat --ref <branch/commit/tag> // use a specific git ref
  }
  ```

- To install all required projects and packages you use the tao CLI `tao install`
  - `tao install` honors existing lockfile pins, and only resolves requires not yet in the lockfile
  - `tao update [<project id>]` re-resolves version ranges and branch refs, and updates the lockfile pins
  - You can also add required project and packages using the CLI:
  - `tao require <tao repo> @<package1>, @<package2> --as @<local-package-name>`
    - Now `project { ... }` has `requires <tao repo> @<package1>, @<package2> as @<local-package-name>`

- You reference external packages the same way as internal packages:
  ```tao
  use <declaration> from @<package> // use a declaration
  use <decl1>, <decl2> from @<package> // use two declarations
  use <declaration> as <local-name> from @<package> // import under a local name
  // e.g:
  use Foo from @foo // now `Foo` from `@foo` is available inside this file
  use Bar, Bar2 from @bar // `Bar` and `Bar2` are now both available in this file
  use Baz as BarBar from @bar // `Baz` is available as `BarBar` inside this file
  ```

## Publishing a Tao Project for others to use

- You publish a project and its packages using `tao publish`
  - The project repo must be clean to publish it
  - `tao publish` bumps the project version, commits it, creates a git version tag, and pushes everything
  - `tao publish` fetches the remote's version tags first, and refuses to publish a version that isn't greater than the highest published version
- Shipping an app to the stores is a different motion with its own verb, `tao ship`, implemented as
  a filesystem-only transaction; `tao publish` distributes the project and its public API only
  - You install a published app to your device with `tao install --app <tao project>`

## The `.tao-project` folder

- The root project folder contains `.tao-project/`, with installed projects, lockfiles, and more
  - `.tao-project/installs/...`
  - `.tao-project/lock.jsonc` — the project's only Tao-written lock, sectioned per concern; package
    resolution will own `installs` and the implemented shipping path owns `ship`. Each writer atomically
    merges fresh state so the concerns do not overwrite one another.
  - `.tao-project/cache/...`

## Dependency version locks (planned)

- Tao will install required sub-projects in `.tao-project/installs/...`
  - And track the required packages and resolved versions in the `installs` section of
    `.tao-project/lock.jsonc`
  - `installs` is a flat resolved graph for all dependencies
    - `requires` entries declare what a project requested: `version` (a semver range) or `ref` (a git branch/commit/tag), never both
    - Every resolved project is pinned to an immutable `resolvedCommit`; `resolvedVersion` is also recorded when resolved from a semver range
    - A root build resolves only one version of each project, so each project id appears exactly once in `projects`
    - If two incompatible version ranges are required inside one project, `tao install` errors with a diagnostic showing the conflicting requesters and their requested versions/refs
  ```jsonc
  {
    "schemaVersion": 1,
    "installs": {
      "lockfileVersion": 1,
      "requires": { // the root project's requires
        "tao:std": { "version": "0.0.1" },
        "github:marcuswestin/tao-gaz": { "version": "^1.0.1" },
        "git+https://example.com/foo/tao-bar": { "ref": "main" },
      },
      "projects": { // flat map of all resolved projects, any depth
        "tao:std": {
          "projectId": "<immutable tao project id>",
          "resolvedVersion": "0.0.1",
          "resolvedCommit": "<commit sha>",
        },
        "github:marcuswestin/tao-gaz": {
          "projectId": "<immutable tao project id>",
          "resolvedVersion": "1.0.3",
          "resolvedCommit": "<commit sha>",
          "requires": { // this project's requires; resolutions are top-level
            "tao:std": { "version": "^0.0.1" },
          },
        },
        "git+https://example.com/foo/tao-bar": {
          "projectId": "<immutable tao project id>",
          "resolvedCommit": "<commit sha>", // no resolvedVersion for ref requires
        },
      },
    },
    "ship": { "apps": {} }, // independent concern, preserved by installs writes
  }
  ```

- Packages may export configured navigation, data, design, asset, permission, localization, and other capability values. The app imports and selects only properties supported by its typed app surface. The current primitive app contract requires `Name` and the internal `Navigator nav`; authored `view Root(args)` is sugar that fills `Navigator` with a synthesized SlotNav, while direct `Navigator` remains legal for navigation-root and legacy/test apps. `Datasource` is optional, and keyed auxiliary nav entries exist only for genuine app-specific hosts such as windows. Every nav hosts its own overlays, and toasts are app-level transient presentation, so neither is modeled as an auxiliary. See `Tao Presentation and Navigation.md`.
- A general app-capability bundle and ambient `app.*` access model are not part of the current contract. Their ownership and lookup semantics remain deferred under `LANG-003` in `Docs/Roadmap/Deferred Tao language decisions.md`.
