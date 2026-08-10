# Tao Project and Packages

Status: partially implemented design draft. The current implementation supports local `project { name "..." remote none license ... }` metadata, the transitional `package`/`project`/`publish` visibility words, `use ... from ...` imports for relative Tao source paths and `@tao/...` stdlib paths, bare same-package `use Foo`, and local `@package[/subfolder]` imports through an in-memory workspace package index. The intended visibility vocabulary in this specification is `file`, `package`, `workspace`, and `public`; its migration is not implemented yet. Project IDs, `tao create`, import renaming, `requires`, external workspace installation, lockfiles, remotes, other CLI package commands, and package publishing remain future work.

## Creating a Tao Project

- The intended command is `tao create <id>`.
- It will create `<id>/App.tao`, using the new project's directory name as its developer-supplied, checked-in project ID and initial display name. This command and richer repository scaffolding remain future work.
- For example, `tao create "My TODOs"` creates `./My TODOs/App.tao` with `id "My TODOs"`.

### Creating a Tao app

- Only the workspace root can declare an `app`.
- The app selects a primary navigator; see `Tao Presentation and Navigation.md` for its behavior.

```tao
use Button, Col, List, Text from @tao/ui
use @tao/nav as Nav

project {
   id "example.chat"
   name "Chat"
   remote none
   license MIT
}

data Chat {
   Messages/Message {
      Text text
      optional Parent Message
      Thread Messages
   }
}

app ChatApp {
   Name "Chat"
   Navigator Nav.StackNav { Initial ThreadListUi }
}

ui ThreadListUi {
   query Chat.Messages { Text }

   render Col {
      List Messages {
         Text Message.Text
         on select -> Message { present ThreadUi Message }
      }
   }
}

ui ThreadUi Message Chat.Message {
   render Col {
      Text Message.Text
      Button "Open thread", on press -> { present ThreadUi Message }
   }
}
```

The project `id` is an opaque, immutable value chosen by the developer and checked into the project declaration. `tao create <id>` uses its new directory name as the ID. For an existing project, `tao project id <id> [path]` creates and persists a missing ID; repeating it with the same value preserves the existing declaration. The ID travels with clones and published artifacts and does not change when the project later moves, gains a remote, or advances to another commit. A fork that becomes an independent Tao project runs `tao project id <new-id> [path] --replace`. Required dependencies retain their own project IDs; lockfile revisions select code but do not alter declaration identity. Ordinary checking, compiling, formatting, and launching never invent or modify identity as a side effect.

The data declaration supplies singular and plural values. The UI presents configured semantic destinations; `StackNav` owns the corresponding native transition.

## Using packages and publishing projects

Packages can make code available to other packages, and even other workspaces.

### Creating a Tao `@package`

- You create a package by naming a folder `@<package name>` and writing `.tao` files in it
  - Declarations under `@<package>` are referenced via `use Foo from @<package>`
  - A declaration is referenced by its folder name, _not_ its file's name
  - A workspace root folder cannot be a `@package`

### Making packages available to other files

- You make a declaration available to other files by declaring its visibility: `file`, `package`, `workspace`, or `public`.

  - `file` is the default and is normally omitted.
    - `view Foo { ... }` is equivalent to `file view Foo { ... }` and cannot be used outside its file.

  - To make declarations visible to other files in _the same package_ you use `package` visibility:
    - `package view Foo { ... }`
      - `Foo` can now be referenced from other files in the same package, e.g:
      - `use Foo` from any file in the same package
      - `use Foo from ./` from a file in the same folder
      - `use Foo from ./<sub-folder>` from a parent folder (that's in the same package)
      - `use Foo from ../<parent-folder>` from a child folder (that's in the same package)

  - To make declarations visible to files in the same workspace you use `workspace` visibility:
    - If `workspace view Bar { ... }` is declared in `@foo/filename.tao`:
      - then `use Bar from @foo` can be used from any file in the same workspace
    - If `Bar` is declared in `@foo/bar/utils.tao`
      - then `use Bar from @foo/bar` can be used from any file
    - A `workspace` declaration remains inaccessible to consumers even when the workspace is published.

  - To make declarations visible to consumers of a published workspace you use `public`:
    - If workspace `<workspace id>` has package `@animals` with `public view Cat { ... }`
      - then a workspace with `requires <workspace id> @animals`
      - can `use Cat from @animals`
    - `public` is a visibility rule. `tao publish` is the CLI operation that distributes the workspace and its public API.

  - A folder is not allowed to make two declarations with the same name visible
    - If `@<package>/file.tao` has `package view Foo { ... }`, then:
      - `@<package>/file2.tao` with `package view Foo { ... }` is not ok
      - `@<package>/file2.tao` with `workspace view Foo { ... }` is not ok
      - `@<package>/file2.tao` with `public view Foo { ... }` is not ok
      - `@<package>/subfolder/file3.tao` with `<visibility> view Foo { ... }` _is_ ok

## Using available code from other packages

- Packages and their subfolders can be referenced via `@<package>` and `@<package>/<subfolder>`
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
    - `public view Foo { ... }`, then Foo is available via `@<package>`:
    - `use Foo from @<package>`
  - If `@<package>/<subfolder>/<filename>.tao` has:
    - `public view Bar { ... }` then Bar is available via `@<package>/subfolder`:
    - `use Bar from @<package>/<subfolder>`

### Package cycles and order of evaluation

- Cyclical package imports are allowed when their value dependencies are valid.
- Tao discovers declarations and resolves references across the complete package graph before initializing values. Source order, import order, and generated TypeScript module traversal do not define language semantics.
- Callable declarations may refer across an import cycle because discovering them does not eagerly evaluate a value.
- Immutable values initialize according to their dependency graph. Strongly connected value components with no already-available base value produce one deterministic initialization-cycle diagnostic.
- A cyclic import graph with an acyclic value-dependency graph initializes successfully in dependency order.
- Generated modules must preserve this model rather than exposing JavaScript temporal-dead-zone or partial-module behavior.

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
- You can also publish an app to app stores and the web with `tao publish --app`
  - And you install a published app to your device with `tao install --app <tao project>`

## The `.tao-project` folder

- The root project folder contains `.tao-project/`, with installed projects, lockfiles, and more
  - `.tao-project/installs/...`
  - `.tao-project/installs-lock.jsonc`
  - `.tao-project/cache/...`

## Dependency version locks

- Tao installs required sub-projects in `.tao-project/installs/...`
  - And tracks the required packages and resolved versions in `.tao-project/installs-lock.jsonc`
  - `installs-lock.jsonc` is a flat resolved graph for all dependencies
    - `requires` entries declare what a project requested: `version` (a semver range) or `ref` (a git branch/commit/tag), never both
    - Every resolved project is pinned to an immutable `resolved_commit`; `resolved_version` is also recorded when resolved from a semver range
    - A root build resolves only one version of each project, so each project id appears exactly once in `projects`
    - If two incompatible version ranges are required inside one project, `tao install` errors with a diagnostic showing the conflicting requesters and their requested versions/refs
  ```jsonc
  {
    "lockfile_version": 1, // lockfile format version
    "requires": { // the root project's requires
      "tao:std": { "version": "0.0.1" },
      "github:marcuswestin/tao-gaz": { "version": "^1.0.1" },
      "git+https://example.com/foo/tao-bar": { "ref": "main" },
    },
    "projects": { // flat map of all resolved projects, any depth
      "tao:std": {
        "project_id": "<immutable tao project id>",
        "resolved_version": "0.0.1",
        "resolved_commit": "<commit sha>",
      },
      "github:marcuswestin/tao-gaz": {
        "project_id": "<immutable tao project id>",
        "resolved_version": "1.0.3",
        "resolved_commit": "<commit sha>",
        "requires": { // this project's requires; resolutions are top-level
          "tao:std": { "version": "^0.0.1" },
        },
      },
      "git+https://example.com/foo/tao-bar": {
        "project_id": "<immutable tao project id>",
        "resolved_commit": "<commit sha>", // no resolved_version for ref requires
      },
    },
  }
  ```

- Packages may export configured navigation, data, design, asset, permission, localization, and other capability values. The app imports and selects only properties supported by its typed app surface. The current app contract has required `Name` and `Navigator` properties plus optional `Auxiliaries`; see `Tao Presentation and Navigation.md`.
- A general app-capability bundle and ambient `app.*` access model are not part of the current contract. Their ownership and lookup semantics remain deferred under `LANG-003` in `Roadmap/Deferred Tao language decisions.md`.
