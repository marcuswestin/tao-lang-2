# Tao projects, modules, packages, and generated TypeScript

Status: source implementation written; release acceptance remains a separate requirement.
The complete migration must pass validation before landing. This records the agreed contract;
implemented specifications are updated at integration checkpoints.
Tracked `.tao/store/project.json` IDs now preserve declaration origins across clones and build snapshots;
computed TypeScript sidecar paths produce located diagnostics. Selected dependency initialization,
test-cache safety, external configuration watching, and concurrent contract publication have focused
regression coverage. Generated app bindings execute the persistence runtime and retain state across
release versions; this does not establish mounted native UI acceptance. Standalone CLI acceptance,
including the disk-edit watch loop, VSIX packaging, and bundled-server diagnostics/hover/definition
have separate checks; they do not establish installed-editor activation or native UI behavior.
Final review repairs preserve declaration-level publication closure, private sidecar type contracts,
and existing runtime-valued Tao case imports without including unrelated runtime providers. These
repairs have focused compiler, refresh, CLI consumer and Studio integration coverage. The compiler's
direct TypeScript5.9.3 declaration is approved
and installed through the official lock refresh. Native Bridge's declared Expo packages are installed;
explicitly selected test-file apps participate in their own graph without entering publication APIs.
Shared sidecar inspection tracks standalone declarations, external files, and lexical/physical marker
boundaries. Build snapshots copy exact external files; watch observes missing-file and marker recovery;
check caching includes empty nested markers and declines external-sidecar workspaces. These paths have
focused regression coverage. Final acceptance must use artifacts rebuilt from the final source tree,
complete repository verification, and the isolated installed-editor probe. Protected adapters are
regenerated through setup. Exact verdicts belong to command reports and the execution checkpoint.

The standalone build recipe is exposed as `./agent standalone-cli-build` for local packaging checks.
Publication preflight already enforces strict dependency-sidecar ownership; copy planning also
checks each binding before using its cache. Pre-existing duplication of shared transitive TS helper
modules remains outside this migration's acceptance claims.

Review preserves Studio's existing local private TypeScript host graph in unmarked directories;
relative imports still cannot enter another marked Tao project. Consumed publication snapshots keep
their implementation sources in their defining root. A future portability design for publications
that use external unmarked TypeScript trees remains separate from this implementation.

## Contract

1. A project is the nearest ancestor containing `.tao/`. A tracked marker preserves discovery after
   cloning. Its automatically generated `.tao/store/project.json` ID is retained across clones and builds.
   Root Tao files are allowed; neither a particular filename nor a `project` declaration is
   required. Nested roots remain isolated.
2. A module is a named `@<name>` folder and its subfolders. Module names and registered aliases are
   unambiguous within the defining project. Organizational containers such as `Apps/` remain.
3. A package is a publication declared only in root-level Tao files. It has optional `name`, required
   `version` and `license`, its own dependencies, and `includes` listing named modules. There may be
   one unnamed/default package and multiple uniquely named packages. Included modules may overlap.
4. Consumers reach only `public` Tao declarations in included modules. Root helpers, excluded modules,
   and TypeScript helpers may belong to the reachable private implementation closure, but are never
   direct publication entrypoints. A public Tao declaration may delegate to TypeScript.
5. Runnable apps require effective lowercase `id`, `version`, and `name` and own their dependencies.
   `with` inherits configuration and dependencies and may override identity fields. Effective
   ID/version pairs are unique per defining project; full SemVer, including prereleases, is accepted.
   Primitive app contracts are not runnable declarations.
6. Effective app ID identifies Tao-managed persistent app state across versions. Explicit datasource
   configuration controls backend sharing independently. Existing pre-migration stores remain untouched;
   report the one-time state-key transition without deleting or automatically merging old stores.
7. `project` replaces `workspace` visibility and covers only the same `.tao` root. Other visibility
   scopes retain their meaning. Opening multiple roots in an editor grants no cross-project access.

## Dependency selection

```tao
requires ../widget-library version ^1.0.0 {
   @ui as @widgets
   @icons as @widget-icons
}

requires "Widget Package Foo" from ../widget-library version ^2.0.0 {
   @icons as @extra-icons
}

requires ts npm:date-fns version 4.1.0 as date-fns-v4
```

Each Tao requirement selects one project, one publication, and one version range. Omitted publication
name selects the truly unnamed/default package, never a sole named package. Requested modules must be
included. Local locators resolve relative to the requiring project root. Quoting supports spaces and
compound selectors. Alias renaming preserves origin identity and module subpaths. Distinct targets or
versions require distinct aliases; identical repeated bindings may be deduplicated.

Installation defaults to dependencies of all apps and publications. Explicit selection must preserve
unrelated installations. Local Tao publication resolution and npm installation are in scope. Managed
manifests and reproducibility metadata live in dot directories; native npm lookup uses root
`node_modules`. The shared lock moves from `.tao-project/lock.jsonc` to `.tao/store/lock.jsonc`, retaining its
shipping/toolchain sections, exact pins, and tracking exception.

## TypeScript and development

Generated contracts and executable parameter/return/arity checks live at
`.tao-ts/<source-path-from-root>.tao.ts`. Authored sidecars retain relative imports such as
`import type { Drawer } from './Drawer.tao'`. Generated imports are relative to their actual output;
dependency-origin mappings keep identical relative paths in different projects distinct.
Module paths must be literal strings (including interpolation-free template literals); computed
`import(...)` and module-loading `require(...)` paths are diagnosed at their source location.

Root `tsconfig.json` initially contains only:

```json
{ "extends": "./.tao/cache/typescript/tsconfig.json" }
```

The generated base owns the authored/generated overlay and contract checking. Root overrides are
preserved; incompatible overrides are diagnosed rather than silently changing emission or `rootDir`.
The extension hides root configuration and `node_modules` through folder-scoped Explorer settings,
preserving unrelated settings and intentional overrides, and provides show-tooling/open-config commands.

Origin references contain a relative Tao path and exact declaration line/column. Editor links navigate
to the original source. Invalid Tao retains last-valid contracts explicitly marked stale while current
errors still fail checking and invalidate successful-cache replay. Recovery publishes fresh contracts.
Deletion prunes only identified generated files, never handwritten TypeScript.

One shared disk refresh/watch service supports `tao run`, `tao watch`, the language server, and hosts.
It performs initial refresh, uses a 250 ms debounce, queues changes received during refresh, locks
writers per project, writes only changed content, observes local dependency/configuration changes,
ignores generated/install output, and disposes cleanly. It observes saved disk contents, including
external edits, independently of unsaved editor buffers. Failed edits retain the last working preview.
`tao run` replaces public `tao dev` without an alias; `tao watch` refreshes without launching a runtime.

## Execution and barriers

| Slice | Work and ownership                                                                           | Integration evidence                                                                                          |
| ----- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1     | One language workstream: parser, AST utilities, validator, formatter, source actions         | Marker roots, metadata, dependencies, public selection and private closure, visibility fixtures               |
| 2     | Separate compiler/state and shared project-tooling workstreams after graph interfaces freeze | Selected publication compiler input; private helper execution; inherited metadata and app-ID state            |
| 3     | Reuse compiler and tooling owners                                                            | Contract relocation, config preservation, diagnostic mappings, stale recovery, cleanup, locking/watch fixture |
| 4     | Parallel CLI, editor, and host workstreams against frozen refresh interfaces                 | Install/check/run/watch/build/ship, editor navigation/diagnostics, Studio/Expo publication agree              |
| 5     | Disjoint application/fixture migration; shared documentation/configuration integration       | All repository projects, starters, tests, stdlib and live references migrated                                 |
| 6     | Independent review and verification                                                          | Full checks, standalone CLI and VSIX packaging, actual editor/run/watch acceptance; host gaps explicit        |

The integration owner owns root manifests, aliases, dependency locks, generated artifacts,
documentation, and the Git index. Implementation workstreams have exclusive paths, preserve concurrent
changes, and do not stage or commit. Approximately three writers run at once, only after their upstream
interfaces stabilize. Diffs and cited evidence are reviewed at every barrier. Reuse the existing
TypeScript/chokidar versions; manifest and lock changes follow the named dependency approval workflow.

The semantic graph distinguishes project-internal symbols, selected publication public candidates,
reachable private implementation sources, and origin/alias bindings. Language semantics remain in AST
utilities and emission in the compiler. The shared tooling package owns configuration, publication and
checking, refresh status, and watching; installation remains CLI-owned. Result, diagnostic, mapping,
fresh/stale, and disposal interfaces freeze before client implementation.

Shipping reads effective selected-app metadata. Version writes target the selected declaration or
override, preserve the base app and full Tao SemVer, and respect native packaging constraints. Compiler
input must not pull unrelated dependency-project data or declarations into a selected publication.
Initialization and cycle rules remain; publication membership cannot depend on source order.

Migrate all applications, starters, inline fixtures, standard-library metadata, help/completion,
wrappers, discovery/packaging, and affected guidance sources. Future-app changes cover layout/metadata
without changing unrelated deferred language designs. Update implemented Specs and authoritative
decisions alongside code. Frozen historical documents stay unchanged. Remove former project
declarations, workspace visibility, public dev command, adjacent generation, and lock layout paths;
there is no pre-MVP compatibility branch. Do not land partially migrated slices.

## Acceptance and deferred work

Acceptance covers fresh-clone/nested discovery; root-only, overlapping, default/named publications;
aliases/version errors; public API isolation with private helper execution; app inheritance/identity/
prereleases/shipping updates and stable state; npm aliases/subpaths/private transitive dependencies;
relative Tao type imports/signature errors/origin navigation/custom configuration/cache invalidation;
external edits and changes during compilation/add-delete-rename/stale recovery/concurrent writers/
shutdown/no loops; complete migration and standalone CLI/VSIX/live editor/run/watch behavior.

Focused checks run throughout, `verify-changed` covers coherent integration units, and full repository
verification follows migration. Source, editor, packaging, runtime, build/ship, and host-dependent
evidence are reported separately. Only reviewed task-owned paths are committed; landing requires its
own authorization.

Remote Tao fetching/publishing and Companion URL installation, public TypeScript entrypoints,
workspace visibility, IDE save hooks, and the
[semantic sidecar value API](Tao%20sidecar%20value%20API.md) remain deferred. Before MVP, settle the
[source compatibility promise](../MVP%20Roadmap/Plan%20-%20Tao%20source%20compatibility.md). Historical
adapters are later: isolated versioned parsing and sequential AST conversions into the current AST,
preserving source mappings rather than scattering version branches through current compiler logic.
