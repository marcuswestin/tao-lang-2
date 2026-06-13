# Tao Project and Packages

Status: partially implemented design draft. The current implementation supports local `project { name "..." remote none license ... }` metadata, `package`/`project`/`publish` visibility, `use ... from ...` imports for relative Tao source paths and `@tao/...` stdlib paths, bare same-package `use Foo`, and local `@package[/subfolder]` imports through an in-memory project package index. Import aliases, `requires`, external project installation, lockfiles, remotes, CLI package commands, and package publishing remain future work.

## Creating a Tao Project

- You start a new tao project with `tao create <project name>`
  - This creates a folder named `<project name>` with
    - `<ProjectName>App.tao`, a barebones app stub
    - `AGENTS.md`, `.tao-project/...`, `.git/...`, `.gitignore`, `agents/skills/...`

### Creating a Tao app

- Only the project root can declare an `app`
  - The barebones app uses tao's default ui, theme and navigation:
  - `<ProjectName>App.tao`:

  ```tao
  // Use some of the @tao/ui library.
  use Col, Text, List, Button from @tao/ui
  use DarkTheme, Pad from @tao/themes
  use StackNav from @tao/nav
  use Log from @tao/logs

  // Project info
  project {
     name "<project name>"
     remote none
     license MIT
  }

  // Datasources are realtime by default.
  // All users will immediately see all chat messages.
  datasource Chat {
     Message, Messages {
        Text text
        ParentMessage optional Message
        Thread Messages
  }  }

  // Create an app with our datasource, a dark theme, and
  // native stack navigation that counts each navigation.
  app ChatApp {
     datasource Chat
     theme DarkTheme
     nav StackNav RootScreen {
        on navigation -> Nav {
          NavCount += 1
          Log "Navigate to { Nav.Screen }"
  }  }  }

  // Create a root screen with a button to open chat, and
  // a text snippet displaying the current navigation count.
  state NavCount = 0
  screen RootScreen {
     render Col {
        Text "Navigation count { NavCount }"
        Button "Chat" [centered] {
           on press -> {
              app.nav.push ThreadView ParentMessage none
  }  }  }  }

  screen ThreadView ParentMessage Chat.Message? {
     query Chat Messages {
        where ParentMessage = ParentMessage
        Text
        Thread
     }
     render Col {
        // Option 1
        alias Pad .0
        if ParentMessage {
           realias Pad .2
        }
        // Option 2
        alias Pad when ParentMessage is {
           empty -> .0
           else -> .2
        }

        ParentMessage ? {
           Text <color gray> "Thread: { ParentMessage.Text }"
        }
        List Messages <Pad, gap .1> {
           Pressable Row {
              Text Message.Text
              on press -> app.nav.push ThreadView Message
  }  }  }  }
  ```

Some things to notice:

- The app uses @tao standard libary for common ui elements
- A simple datasource automatically provides realtime sync for all users
- Closing brackets auto-formats to collapse onto a single indented line
- Data items are declared in both singular and plural form
- Native stack navigation automatically works on ios, android and web
- The button to open chat is layed out centered on the screen
- ThreadView takes an optional parent message and queries its thread
- List takes Messages, and tao knows that Message refers to the singular item
- `<color .grey>` knows we refer to a theme and defaults to `app.theme.colors.*`
- `alias Pad .0` type-matches to `Pad from @tao/themes`, which resizes with user-set OS preferences
- Pressable makes each message row interactive
- Selecting a message pushes another ThreadView on the stack but with _its_ thread to be displayed

## Using packages and publishing projects

Packages can make code available to other packages, and even other projects.

### Creating a Tao `@package`

- You create a package by naming a folder `@<package name>` and writing `.tao` files in it
  - Declarations under `@<package>` are referenced via `use Foo from @<package>`
  - Declarations are referenced by it's folder name, _not_ its file's name
  - A project root folder cannot be a `@package`

### Making packages available to other files

- You make a declaration available to other files by declaring its visibility: `package`, `project`, or `publish`

  - By default a declaration is visible only inside its own file
    - `ui Foo { ... }` cannot be used outside its file

  - To make declarations visible to other files in _the same package_ you use `package` visibility:
    - `package ui Foo { ... }`
      - `Foo` can now be referenced from other files in the same package, e.g:
      - `use Foo` from any file in the same package
      - `use Foo from ./` from a file in the same folder
      - `use Foo from ./<sub-folder>` from a parent folder (that's in the same package)
      - `use Foo from ../<parent-folder>` from a child folder (that's in the same package)

  - To make declarations visible to files _the same project_ you use `project` visibility:
    - If `project ui Bar { ... }` is declared in `@foo/filename.tao`:
      - then `use Bar from @foo` can be used from any file in the same project
    - If `Bar` is declared in `@foo/bar/utils.tao`
      - then `use Bar from @foo/utils` can be used from any file

  - To make declarations visible _in other projects_ you use `publish`:
    - If project `<project id>` has package `@animals` with `publish ui Cat { ... }`
      - then a project with `requires <project id> @animals`
      - can `use Cat from @animals`

  - A folder is not allowed to make two declarations with the same name visible
    - If `@<package>/file.tao` has `package ui Foo { ... }`, then:
      - `@<package>/file2.tao` with `package ui Foo { ... }` is not ok
      - `@<package>/file2.tao` with `project ui Foo { ... }` is not ok
      - `@<package>/file2.tao` with `publish ui Foo { ... }` is not ok
      - `@<package>/subfolder/file3.tao` with `<visibility> ui Foo { ... }` _is_ ok

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

- Cross-package references are referenced by `@<package name`, from anywhere in the project
  - Cross-package references _do not_ use relative paths
  - `use Cat from @cat` is ok
  - `use Mat from ./@mat` not ok
  - `use Bat from ../<sibling folder>/@animals` not ok

- Declarations are referenced by their folder, not their file names
  - If `@<package>/<filename>.tao` has:
    - `publish ui Foo { ... }`, then Foo is available via `@<package>`:
    - `use Foo from @<package>`
  - If `@<package>/<subfolder>/<filename>.tao` has:
    - `publish ui Bar { ... }` then Bar is available via `@<package>/subfolder`:
    - `use Bar from @<package>/<subfolder>`

### Package cycles and order of evalutation

- Cyclical package use is ok
  - Each used package file is evaluated once, in depth-first order, by the typescript runtime.
  - E.g if:
    - `App.tao` uses, in this order, `@foo`, `@bar`, `@cat`
    - `@foo/Foo.tao` uses `@cat`
    - `@cat/cats.tao` uses `@baz`, `@bar`
    - `@bar/b.tao` and `@baz/z.tao` have no dependencies
  - Then evaluation order is determined as follows:
    - `App.tao` queues: `[App.tao -> Foo.tao -> bar.tao -> cats.tao]`
    - `@foo/Foo.tao` queues: `[App.tao -> [Foo.tao -> cats.tao] -> bar.tao -> cats.tao]`
    - `@cat/cats.tao` queues: `[App.tao -> [Foo.tao -> [cats.tao -> z.tao -> b.tao]] -> b.tao -> cats.tao`
    - `z.tao` and `b.tao` don't add to the queue.
  - Since each file is evaluated once the order becomes
    - `[App.tao -> Foo.tao -> cats.tao -> z.tao -> b.tao]`, with `@bar` evaluated _last_ despite being listed second in `App.tao`

## Using external Tao Projects and packages

- To import another tao project and its packages you list them them in `project { ... }` with `requires ...`:

  ```tao
  project {
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
  - `tao require <tao repo> @<package1>, @<package2> --as @<alias>`
    - Now `project { ... }` has `requires <tao repo> @<package1>, @<package2> as @<alias>`

- You reference external packages the same way as internal packages:
  ```tao
  use <declaration> from @<package> // use a declaration
  use <decl1>, <decl2> from @<package> // use two declarations
  use <declaration> as <alias> from @<package> // use a declaration by an alias
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
        "resolved_version": "0.0.1",
        "resolved_commit": "<commit sha>",
      },
      "github:marcuswestin/tao-gaz": {
        "resolved_version": "1.0.3",
        "resolved_commit": "<commit sha>",
        "requires": { // this project's requires; resolutions are top-level
          "tao:std": { "version": "^0.0.1" },
        },
      },
      "git+https://example.com/foo/tao-bar": {
        "resolved_commit": "<commit sha>", // no resolved_version for ref requires
      },
    },
  }
  ```

- Import cycles are allowed in v1, but should be diagnosed
  - Import cycles are resolved by the generated TypeScript/runtime module system when possible
  - The compiler may warn about cycles that affect initialization order
  - The compiler should error on cycles that require impossible initialization order

- Any package can declare themes, navigation graphs, data sources, assets, permissions, strings, and other app capabilities
  - The app file imports and selects the active capabilities
  - Example:
    - `use AppTheme from @theme`
    - `use AppNav from @nav`
    - `use DataSource from @data`
    - `app { theme AppTheme, nav AppNav, data DataSource }`
  - For v1, a root build resolves only one version of each project so app capabilities and runtime initialization have a single project instance

- Accessing the currently active app capabilities is always done through `app.*`
  - For fully declared access paths:
    - `app.theme.colors.Primary`
    - `app.theme.spacing.1`
    - `app.data.MyDataSource`
    - `app.strings.profile.Title`
    - `app.assets.Logo`
  - For type-inferred references:
    - `Text "Foo" <color .primary>` resolves to `app.theme.colors.Primary` in the current theme
    - `Row [gap .1] { ... }` resolves to `app.theme.spacing.1` with the current accessibility spacing size
    - `query Foo from .DataSource` resolves to `app.data.DataSource` with the current environment target
    - `Text .profile.Title` resolves to `app.strings.profile.Title` in the current locale
    - `Image Src .Logo` resolves to `app.assets.Logo`
