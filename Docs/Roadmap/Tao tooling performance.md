# Tao tooling performance

Research report, 2026-09-21. It answers four questions in order: where verification time goes, what
makes the developer-facing `tao` commands slow, how fast the current stack (TypeScript, Bun, Langium,
Jest, Expo) can be made, and whether a different stack would raise that ceiling enough to matter.
The largest single defect it found (5.1) was fixed in the change that landed it; everything else is
proposed, with section 8 the sequence and section 9 the judgments that are the Developer's.

The bar is interactive-grade: a warm single-file check or fix under 100ms, a whole-app check under
1s, one behavior test re-run under 1s, a whole app's tests under 10s, and an edit visible in the
preview within 1-2s.

## Current effect projection follow-up, 2026-10-07

Whole-app session checking exceeded its unchanged 1.3-second performance ceiling on current
main and the Studio speed candidate. Within each canonical effect snapshot, every callable
was independently projecting the same complete call, read, native, constructor and unit
inventory. That owner-independent projection now runs once per exact snapshot identity.
Only completed immutable inputs are retained weakly; each callable still receives its own
source-root context, discovery traversal and effect analysis. Different snapshots, semantic
evidence and fresh linked builds remain cold. Factory provenance is checked on every call.
No validation reports, entry graphs or mutable ASTs are shared across builds by this change.

The owning package's 359 tests pass. New tests prove shared input identity, ordered cold-fact
parity, distinct owner roots, changed native evidence and missing-to-repaired dependencies.
Disabling retention and incorrectly reusing inputs across snapshots both make those tests fail.
An isolated ten-iteration diagnostic benchmark on the 732-line, 51,927-byte WordFlower fixture
passes every existing median budget: session check 983 milliseconds, one-shot check about
1.2 seconds, session validation 135 milliseconds and session compile 470 milliseconds.
Its named report is `2026-10-07T19-37-01-244Z-38935.log`. These are diagnostic measurements;
standalone quiet qualification and paired Studio editor-save paint measurements remain pending.
Apply this compiler-only change to both comparison roots when isolating Studio preview delivery.
Worker admission, shared workspaces and dependency-directed compilation remain separate work.

## 1. Summary

1. **The slowness is ours, not the stack's.** An uncached `tao check` of WordFlower (13 files, 2,442
   lines) takes 20-27s. Parsing that app _and_ the standard library with Langium takes **14ms**.
   88.6% of the run is `fs.realpathSync`, called twice per `use` statement per workspace file per
   reference resolved. A ten-line memo takes check from 22s to 2.3s, fix from 9s to 1.2s, compile
   from 3.2s to 0.8s, and test from 26s to 14s. A second memo halves the link phase again.
2. **Three structural habits cost the next order of magnitude.** Scope resolution recomputes every
   import against every document for every reference; every entry file rebuilds the whole graph
   from disk, standard library included, so 13 entries means 13 builds; and every command is a fresh
   process that throws its workspace away, including the recompile `tao run` runs on each save.
   Langium's own incremental update handles a one-file edit in the same workspace in **7-35ms**, and
   nothing in the CLI, the dev loop, or the test runner uses it.
3. **The current stack meets the bar for check, fix, fmt, and compile.** Measured floor: 250k
   lines/s parsing, about 85ms to parse, link, and validate WordFlower's 22-file graph from scratch,
   about 50ms for a warm one-file re-check. The one hard floor is a cold process, about 350ms before
   any work, which a watch mode or a long-lived process removes and nothing else does.
4. **`tao test` is the loop the current stack cannot make snappy as built.** Jest with the Expo
   preset costs 2.8s with every cache warm and 6-9s after any edit, because each compile writes to a
   fresh path and misses Babel's cache. Stable output paths recover the first; only leaving Jest for
   the inner loop reaches one second. A throwaway headless runner in Bun, with `react-native`
   stubbed, ran all 29 WordFlower journeys green in 1.2s and a single journey in 0.22s, with the
   existing test runner unchanged (section 6.1).
5. **A different stack is not what makes this fast, and two of the candidates make the loop
   slower.** Emitting SwiftUI and Compose trades sub-second Fast Refresh for multi-second native
   incremental builds. A fixed native runtime that interprets the app (Hypen, Lynx, Redwood) does
   give millisecond reloads and headless tests, at the price of owning an engine, three renderers,
   and a replacement for the Expo module ecosystem; Hypen itself is five months old. A native
   toolchain core would buy a further 10-30x on CPU-bound phases that, after the fixes above, already
   fit the budget at MVP app sizes. Both are worth a dated re-look, not a move now.

## 2. Method

- Machine: 18-core Apple silicon, macOS. Other sessions were landing work during the measurements,
  so every wall-clock figure carries the load average it was taken under (5-10 unless stated) and
  CPU profiles are preferred to stopwatches where the two disagree. Full verification lanes were not
  re-run; their numbers come from the recorded timing history.
- Commands ran inside the agent sandbox, which makes path-resolving syscalls about 4x dearer
  (`realpathSync` 49µs sandboxed, 13µs unsandboxed). The headline defect is not a sandbox artifact:
  the same uncached check run unsandboxed took 15.1s, 12.4s of it system time.
- Fixture: `Apps/WordFlower/1 - Current` — 13 `.tao` files, 5 of them tests, 29 journeys; the main
  entry reaches 22 files including the standard library (24 files, 925 lines).
- Profiles: `bun --cpu-prof --cpu-prof-md`. Phase timings: a scratch script calling the product
  `Parser` and `Workspace` directly. Experiments: two env-gated memos applied to the working tree,
  measured, and reverted; the patch is appendix A. All scratch material is under
  `.artifacts/tmp/perf/`, which Git ignores.

## 3. Where verification time goes

Medians from the main checkout's `.artifacts/timings/history.jsonl` (32 recorded lanes). Gates run
in parallel, so a lane's wall time is its critical path, not the sum.

| Gate or suite (whole, unsharded)   | Median  | What it spends the time on                                   |
| ---------------------------------- | ------- | ------------------------------------------------------------ |
| `tao-cli`                          | 92-122s | CLI tests that open workspaces, compile apps, run `tao test` |
| `tao-apps`                         | 81-108s | `tao test` over every app (WordFlower alone: 54s)            |
| `studio`                           | 47-62s  | Studio server tests, compiling apps                          |
| `_tao-check`                       | 39s     | whole-repository `tao check`, 126 files                      |
| `runtime-toolchain`                | 24-30s  | app generation through `Workspace.compile`                   |
| `runtime-jest`                     | 22-25s  | Jest with the Expo preset                                    |
| `dev`                              | 22-24s  | repository automation tests                                  |
| `validator`                        | 9-28s   | validator tests, each opening workspaces                     |
| `_fix-tao`                         | 16-17s  | whole-repository `tao fix`; never memoized                   |
| `compiler`                         | 11-15s  | compiler tests, each opening workspaces                      |
| `_typecheck`                       | 3.6s    | `tsc` over the packages                                      |
| host lanes in `verify-full` (each) | 12-43s  | browsers, simulators, bundles                                |

Every row above `_typecheck` except `dev` and `runtime-jest` is the product pipeline run many times:
open a workspace, parse, link, validate, compile. Whatever makes `tao check` slow for a Tao
developer is what makes these suites slow, multiplied by the number of tests. That is why the rest
of this report is about the product commands; the lanes follow.

Three lane-only costs are already on the ledger and are not repeated here: `tao fix` never reaching
the check memo, one Expo-host test file spawning five `tsc` runs, and the cache fingerprint hashing
all of `packages/`.

## 4. Where the `tao` commands spend their time

Wall-clock seconds on the fixture, sandboxed, caches disabled unless stated.

| Command                                      | Today           | + realpath memo | + use-statement memo |
| -------------------------------------------- | --------------- | --------------- | -------------------- |
| `tao check` (13 files)                       | 19.9-27.6       | 2.3             | 1.9                  |
| `tao check`, unsandboxed                     | 15.1            | —               | —                    |
| `tao check`, memo hit (this repository only) | 0.45-0.55       | —               | —                    |
| `tao check` of one leaf file                 | 0.37            | 0.39            | 0.38                 |
| `tao fix`                                    | 8.4-9.9         | 1.2             | 1.1                  |
| `tao fmt`                                    | 0.35            | —               | —                    |
| `tao compile --app WordFlower`               | 3.0-3.4         | 0.83            | 0.80                 |
| `tao test`, cold compile                     | 26.0 (Jest 8.8) | 14.0 (Jest 9.2) | —                    |
| `tao test`, nothing changed                  | 3.6 (Jest 2.8)  | —               | —                    |
| `tao test --name Focus` (4 journeys)         | 6.7 (Jest 5.9)  | —               | —                    |

Inside one process, per phase:

| Phase                                                         | Time          |
| ------------------------------------------------------------- | ------------- |
| Import `@parser` (Langium, Chevrotain, generated grammar)     | 75-80ms       |
| Import the compiler on top                                    | 14ms          |
| Construct Langium services                                    | 0.2ms         |
| Materialize the Chevrotain parser (first access)              | 41ms          |
| Lex all 37 files (app + stdlib, 3,404 lines, 146KB)           | 1.1ms         |
| Parse all 37 files                                            | 13-15ms       |
| `Workspace.parse` of the main entry (22 files), today         | 1,500-1,640ms |
| … with the realpath memo                                      | 99-147ms      |
| … with both memos                                             | 50-97ms       |
| Tao validation on top of that                                 | about 30ms    |
| `DocumentBuilder.update` for one changed file, warm workspace | 6.5-35ms      |
| Format one file, warm                                         | 8-9ms         |

The existing `./agent bench` shows the same thing from the outside: its `session` strategy, which
reuses one workspace across iterations, is no faster than `one-shot` (1.2s against 1.4s), because a
reused workspace reuses nothing.

## 5. Root causes, ranked by what they cost a Tao developer

### 5.1 Import resolution calls `realpath` inside the linker's inner loop

`Packages.targetMatches` guarded every candidate file against escaping its package through a
symlink with two `realpathSync` calls per question, asked before the cheap path comparison that
turns nearly every candidate away. The question is asked for every workspace file, for every `use`
statement, every time a reference is resolved (`Packages.createResolver`, reached from
`value-scope.ts:645-708`). For a 13-file app that was on the order of 450,000 syscalls: 22.0s of a
24.8s profile. This one defect was most of `tao check`, `tao fix`, the validate stage of `tao test`,
and a large share of every suite in section 3.

**Fixed in the change that landed this report.** The guard stays, because a file loaded through one
import can sit lexically inside another package while physically outside it. Two things changed:
the path comparison now runs first, so the file system is asked only about files an import actually
names; and each path's symlinks are resolved once per `Packages.Context`, in a table that lives
beside the package index and shares its lifetime and its kind of staleness — neither notices a
package directory or a symlink that appears after the context was created. A path that fails to
resolve is not remembered, so a file an editor has not saved yet matches once it is written. System
time for the uncached check fell from 17-24s to 0.7s; the tables in section 4 keep the before
figures and the "+ realpath memo" column is what the fix delivers.

### 5.2 The scope provider recomputes imports per reference

`ValueScopeProvider.importedDeclarations` walked the file's `use` statements and, for each, filtered
every document in the workspace — per reference, from some twenty call sites, with
`LangiumDocuments.all` re-walking Langium's URI trie each time (`collectValues` was the top
non-native frame once `realpath` was gone). Cost was references × imports × documents.

**Fixed after 5.1.** The provider now remembers what each `use` statement resolves to. The table is
keyed weakly by the statement, because `Parser.parse` replaces every document it builds and so
retires the statements with them, and it is dropped whenever Langium starts an update, because the
editor relinks an importing file without re-parsing it; a test pins that case and fails without the
reset. Measured on `main` with 5.1 landed, then with this: check 2.17s → 1.80s, fix 1.23s → 1.04s,
compile 0.87s → 0.85s. `folderDeclarations` still walks every document per call and is the next
candidate for the same treatment, though what is left of `tao check` is almost all 5.3.

### 5.3 Every entry rebuilds the whole graph, and nothing survives between entries

`Parser.parse` deletes every document the workspace holds, re-reads and re-parses each reachable
file from disk, and runs a full eager-linking build (`parser.ts:133-139`, `266-291`).
`Workspace.validateFiles` calls it once per entry (`Workspace.ts:99-111`), so checking a 13-file app
parses and links the standard library 13 times. This is what is left of `tao check` after 5.1 and
5.2: 1.8s where one build of the union would be about 0.2s. It is also why the LSP-grade
incremental path — 7-35ms for a one-file change — is unreachable from any command.

Building the union once is only safe if no file comes to see more than it sees in its own graph,
and two things stand in the way. The loader keeps `.test.tao` files out of an app file's graph
(`folderSiblingPathsIn`, `parser.ts:496-510`), while `ValueScopeProvider.folderDeclarations` walks
every document the workspace holds without excluding them, so in a union build a folder-visible
declaration in a test file would leak into its app-file siblings; the provider has to apply the
loader's rule itself. And a validator that reads the whole workspace would see every entry's files
instead of one entry's, so each entry has to be validated against its own reachable set, computed
from the shared linked graph, the way `validateFiles` already scopes everything but project
identity. The editor has always linked on the union, so the first of these is a latent difference
between the editor and `tao check` today, not one a union build would introduce.

A third constraint was a language question before it was an engineering one. Three of the grammar's
cross-references — `ProjectDefaultApp.app` (`app X` in a project declaration),
`ViewDeclaration.response` (a responding view's type), and `TestDeclaration.dependencies` (what a
test says it exercises) — fell through to Langium's default scope, which offers every top-level
declaration of every document the workspace holds, imports and visibility ignored. What they resolved
to, and whether `tao check` reported them unresolved, therefore depended on which files an entry
happened to load, and differed between the CLI and the editor; a union build would have changed
those answers. A textual audit of the grammar found the first two, and logging the fall-through
during a whole-repository check found the third, which is the method to trust.

**Scoped since.** `app` inside project metadata follows the rule `Decisions.md` already states — one app declaration
from this project, wherever in the project it is declared, test sidecars excluded because they are
loaded only when they are the file being checked. A response type and a test's dependencies follow
ordinary visibility, declared in the file or reached by `use`, as every other reference does. The
provider's fall-through now returns an empty scope, so a reference the grammar gains without a rule
resolves to nothing and says so. The whole repository checks clean under all three rules, and each
has a test that loads the declaration it must not find and fails when the rule is removed.

**Built since, and what it bought.** `Workspace.parseFiles` builds a workspace's entries once;
every entry keeps the graph it alone reaches and is validated against it, and both copies of the
folder-sibling rule now leave test sidecars out. `tao check` and `tao fix` had a second per-file
rebuild this section missed: the canonical-source pass parsed each file as an entry of its own
(`source-commands.ts`, `canonicalizeFile`), which was 1.1s of the 1.8s; it now reads the same build,
and falls back to a parse of its own the moment any file of the workspace is found changed. Checked
both ways across the repository's 20 workspaces, the two builds report identical diagnostics, and a
test holds the Navigation app to that. WordFlower: check 1.8s → 1.22s, fix 1.04s → 0.80s. The
repository: uncached check 7.3s → 6.6s.

That is well short of the 0.5s this report projected, and the projection was wrong in two ways worth
keeping. Validation is still one pass per entry over that entry's whole graph — 212 file validations
for WordFlower's 28 files, 0.34s against 0.17s for the build itself — because several validators
genuinely read the entry's graph (navigation reachability, selection keys, datasource membership,
global commands), so a file cannot simply be validated once. Separating file-local validators, which
are most of them, from graph-reading ones would remove most of it and is a change to the validator's
contract rather than a defect. And opening a workspace cost 0.10-0.15s before any file was read:
`Packages.createContext` scanned the project for package directories, 2.2s of the repository's 6.6s
across 20 workspaces, paid again by every test that opens one.

**Opening a workspace, fixed since.** Counting child processes, not time, found that opening one
workspace asked Git five times — once for the project roots, once for the package directories, once
per package for its sources — and built two Langium containers to ask whether a file declares a
project, a question its syntax alone answers. One `git ls-files` now serves every question
(`Repo.listUnder`), and the project question is a syntax parse on the shared context. Measured on
WordFlower at the same load: `Workspace.open` 181ms → 37ms, a package context 458ms → 23ms once
warm, one spawn where there were five. This was also the cause of the "opens one root concurrently"
test's timeouts under load, which `main` had since covered by raising every test wait's budget.

### 5.4 Every command is a cold process, including the ones in a loop

A one-file check costs 370ms wall and 0.73s of CPU before it has anything to say: Bun start, the
command's share of a 1,269-module graph, parser construction, and a `git` spawn for file discovery. Bundling the CLI to one
file changes this by less than the noise, because Bun already caches transpiled sources; the cost is
evaluating Langium and building the parser, not finding files. It is paid:

- once per `tao check`, `fix`, `compile` — tolerable alone;
- on **every save** under `tao run` — which, this report wrongly said, spawned a `tao compile`
  process per change. It does not: `Run.compileApp` calls `Runtime.generateApp` in-process
  (`packages/apps/expo-host/expo-host-src/dev-loop/Run.ts`), and only parser generation spawns.
  What a save still pays is a fresh workspace per compile — new Langium services and a new package
  context, about 0.1-0.15s — on top of the compile itself, measured on a live workspace at load 30
  as parse 97ms, validate 44ms, codegen 65ms. A live workspace updated through
  `DocumentBuilder.update` would take the fresh-services cost and most of the parse, roughly 0.1-0.15s
  of a 0.3s save; validation and codegen, not parsing, are now the larger part. Metro's rebuild and
  Fast Refresh, the other side of edit-to-preview, have not been measured;
- several times per `tao test`: the CLI, a Bun worker per test directory, then Node and Jest.

**Studio preview follow-up (2026-09-28):** Ordinary Studio revisions now reuse one preview-owned
workspace for the session; Feed source overrides still get an isolated workspace. This removes
repeated workspace setup. Code editor draft admission now uses the syntax-only parser instead of
building the reachable graph before the full preview compile. `Parser.parseEntries` still reloads and links the reachable documents,
Tao validation still runs, and the backend still emits every source file. Publication already skips
byte-identical generated files. The next step for Studio is Langium document invalidation and then
dependency-aware emission, while retaining the full path for graph-shape changes.

### 5.5 `tao test` pays Jest, Babel, and React Native on every run

With nothing changed, 29 journeys cost 2.8s inside Jest, almost none of it the journeys. After any
edit the same run costs 6-9s. Each compile writes into a fresh `run-<timestamp>-<random>` directory
with fresh `app-run-*` directories beneath it, Babel's cache is keyed by path, and
`transformIgnorePatterns: []` (`packages/apps/expo-host/jest.shared.config.cjs:41`) leaves nothing
exempt — so every edit re-transforms every compiled app. WordFlower's five test files compile eight
app variants. The mechanism is inferred from the path scheme and the timings (same run root 2.8s,
new run root 5.9-9.2s) and wants one confirming experiment with stable paths.

**Confirmed since, and it was larger than inferred.** Counting the files Jest's transform cache
gains per run is a measure machine load cannot disturb. Every run into a new run root added exactly
2,135 — not the compiled apps alone but every module the run loads, React Native included. The
cause is one directory: the generated Jest entrypoints sat inside the run root, that directory is a
`roots` entry in `jest.tao-test.config.cjs`, and Jest hashes its whole configuration into the key of
every transform. With every path held still, a second run added none. The entrypoints name Tao test
files and nothing a compile produced, so they now live beside the run roots under a name that is a
function of the plan alone, and the run-root lifecycle is untouched: a compile after an edit adds
650 files instead of 2,135.

The 650 that remained were the compiled apps: WordFlower's eight test apps each carried their own
copy of the same compiled modules, in a directory whose name changed with every compile, and five
of the eight compiled to one module tree byte for byte. Making those paths stable the simple way —
a fixed directory per app that each compile overwrites — would have been unsound: a run could read
a mixture while another compile wrote, and a published run root's manifest could come to name newer
output than it was fingerprinted for, a stale green. What was built instead is a content-addressed
store beside the run roots (`TestRunRoot.intern`): everything the compiler writes beside `App.tsx`
is stored once as a tree under the hash of its contents, an app under the hash of its `App.tsx`
plus that tree with each entry of the tree a relative symlink beside `App.tsx`, and a path in the
store names immutable bytes. A run root now holds only its manifest. Counted the same way: a fresh
run root with nothing changed adds **0** files to Jest's cache, and an edit to one WordFlower source
file adds **116** — the one tree that changed and the three apps that link to it — where it added
650, and 2,135 before that. Jest resolves a symlink to its real path, so the shared tree is one
cache entry however many apps link to it, and a module's import of `../../NavKinds`, a file the
compiler writes beside `App.tsx`, resolves inside the tree; the first cut shared only `modules/` and
broke exactly there, which is why the tree's boundary is `App.tsx` and nothing narrower. The cache
itself never evicts anything and held 3.49 million files when counted; the ledger has the entry.

### 5.6 A Tao developer outside this repository has no cache at all

`check-cache.ts:18-24` and `test-cache.ts` deliberately stamp only inside this repository's own Git
worktree, because a packaged CLI cannot name its toolchain by hashing `packages/`. The 0.5s warm
check is therefore a repository-only experience; a published `tao` pays the uncached cost on every
run. A packaged build can key the toolchain on its own version and keep stamps in a user cache
directory.

## 6. The floor of the current stack

| Loop                           | Bar     | Floor on TypeScript + Bun + Langium, and what it takes                                                                                                                                                                                                                                                                |
| ------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Warm single-file check or fix  | <100ms  | **40-70ms** measured (update 7-35ms + validation 30ms). Needs a live workspace: watch mode, the LSP, or a daemon.                                                                                                                                                                                                     |
| Cold single-file check         | —       | **about 0.35s**, the process floor. Lazy imports might reach 0.2s. Not reducible below about 0.15s on this stack.                                                                                                                                                                                                     |
| Whole-app check, cold process  | <1s     | **about 0.5s** for WordFlower (0.35s process + one 0.1-0.2s build). About 1s at ten times the size; parse alone scales to 25k lines in 0.1s. Measured with the one build in place: 1.22s — the build is 0.17s as projected; per-entry validation (0.34s) and opening the workspace (0.15s) are what is left, see 5.3. |
| Format                         | instant | 8ms per file warm; 0.35s cold, all of it the process.                                                                                                                                                                                                                                                                 |
| Recompile on save in `tao run` | 1-2s    | **about 0.2s** in-process (update + validate + about 0.1s codegen), then Metro Fast Refresh. Meets the bar with room.                                                                                                                                                                                                 |
| Re-run one behavior test       | <1s     | **Not on Jest** (2.8s best case). **0.22s** in a prototype headless Bun runner. See 6.1.                                                                                                                                                                                                                              |
| Whole app's tests              | <10s    | 3.6s today when nothing changed, 14-26s after an edit; about 5s fixed and still on Jest; **1.2s** headless for WordFlower's 29 journeys.                                                                                                                                                                              |

So the language tooling is nowhere near its floor, and the floor clears the bar. Public evidence
agrees on where the ceiling is. TypeFox, who build Langium, shipped a Go successor in March 2026
because Langium was 28x slower on a 250KB workspace and 49x on a 12MB one, with 80ms against 8ms
first response, and attribute it to garbage collection and single-threading at scale. WordFlower's
graph is 146KB. Tao reaches that ceiling somewhere past 100k lines of Tao in one workspace, which is
a post-MVP problem with a known exit (section 7.2).

What the wider field says about the three moves that matter, independent of language:

- **Incremental, query-shaped computation** is the largest lever everywhere it has been tried:
  rust-analyzer's salsa, ReScript's interface-gated rebuilds, Flow's persistent server, Turbopack's
  function-level memo. Langium already has the per-document version of this; Tao bypasses it.
- **A long-lived process** is how every JavaScript-hosted tool escapes its start-up cost: `tsserver`,
  `eslint_d` and `prettierd` (a warm process behind a socket with an idle timeout), Biome's daemon
  serving both editor and CLI. The known costs are staleness and memory, and the well-regarded
  designs bound both with a version handshake and an idle exit. No Langium-based CLI was found doing
  this; the language server Tao already ships is the natural host.
- **Bundling and bytecode** buy 50-150ms elsewhere and measured nothing here.

### 6.1 Test execution

Public numbers match ours: nobody reports a sub-second run on Jest with the Expo preset. Teams get
2-3x from an SWC transformer, and everything past that comes from leaving Jest's process-per-run and
registry-per-file model. Real React Native cannot be loaded under Bun at all (Flow syntax, and lazy
getters Bun enumerates eagerly), so "move the same tests to `bun test`" is closed. React's own test
renderer is deprecated in favour of `universal-test-renderer`, a reconciler that renders to a plain
tree with no React Native dependency, which React Native Testing Library 14 now sits on.

| Option                                                                                              | Expected floor      | Cost and risk                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Keep Jest; compile to stable, content-addressed paths; one app variant per distinct config       | 3-4s per run        | Small. Recovers the 3-6s Babel re-transform. Cannot reach 1s.                                                                                                                                                                      |
| B. Keep Jest warm (`--watch`-style resident runner driven by `tao test --watch`)                    | 1.5-2.5s per re-run | Medium. Registry isolation still reloads React Native per test file.                                                                                                                                                               |
| C. Headless runner in Bun: the compiled app against a stub `react-native` and a plain-tree renderer | 0.2s one, 1.2s all  | Medium. The runtime reaches React Native through one seam (`TR-react-native.ts`, `TR-native-modules.ts`). Loses React Native's own JavaScript behaviour (Pressable, TextInput plumbing, FlatList); keep Jest as the fidelity lane. |
| D. Journeys evaluated against a language-owned runtime core with no React at all                    | milliseconds        | Large: the runtime today is React components, and `@tao/runtime/core` holds utilities, not a view evaluator. This is the same investment as section 7.3's hybrid.                                                                  |

**Option C was prototyped and works.** A throwaway runner under
`.artifacts/tmp/perf/headless-test/` executes the already-compiled WordFlower journeys in one Bun
process with no Jest, no Expo preset, no Babel, and no real `react-native`:

| Measure                                      | Headless in Bun | Jest today                        |
| -------------------------------------------- | --------------- | --------------------------------- |
| All 29 journeys, process wall time           | **1.17s**       | 2.8s all warm, 6-9s after an edit |
| One journey (the slowest), process wall time | **0.22s**       | 5.9s (`--name`, 4 journeys)       |
| Module load before the first journey         | 55-60ms         | —                                 |
| Per-journey median / max                     | 22ms / 150ms    | —                                 |
| Journeys passing                             | 29 of 29        | 29 of 29                          |

There is no warm and cold distinction, because nothing is transformed or cached: a run after an
edit costs what a repeat run costs. What it took, which is also the size of a real implementation:

- A stub `react-native` of string host components shaped to `TR-react-native.ts:4-37`. The runtime
  and standard library touch exactly 14 of its members. `Button` and `FlatList` needed real
  implementations, because `@tao/ui/native/Native.tao:48` relies on React Native's `Button`
  rendering its title as a `Text` child.
- React Native Testing Library 13.3 loads unmodified over the stub, so the existing
  `test-runner.tsx` ran unchanged. It wanted a global `expect` with a no-op `extend`, the
  `IS_REACT_ACT_ENVIRONMENT` flag the Expo preset normally sets, and stubs for `expo-clipboard` and
  `expo-haptics` in place of the `jest.mock` calls.
- One behavioural divergence to settle before productizing: the Jest harness calls RNTL's
  `cleanup()` after each journey on top of the runner's own unmount (`tao-journey-harness.tsx:6`,
  `test-runner.tsx:77`); doing both in one long-lived process failed 14 journeys with an unmounted
  renderer, and dropping the second fixed them.
- Bun's runtime does not run `Bun.plugin` `onResolve` hooks for bare specifiers (1.3.13), so
  substitution rides on `mock.module` and the per-package `tsconfig.json` paths.

What it cannot catch that Jest with real React Native can: React Native's own `StyleSheet`
validation, the real `Button`, `FlatList`, `Pressable`, and `TextInput` JavaScript, RNTL helpers
keyed on native host names (`RCTSwitch`, `RCTScrollView`), and module-initialization side effects.
None of today's journeys depend on those, which is the argument for C as the inner loop and Jest as
the fidelity gate rather than for replacing Jest outright.

Combined with Phase 0 and a live workspace, the edit-to-result loop for one journey becomes roughly
50ms to re-link and validate, 100ms to regenerate, and 200ms to run: about **0.4s**, from 14-26s.

## 7. Would a different stack raise the ceiling?

### 7.1 Parser technology

Parsing is 14ms of a 20s command and 15% of a fully fixed one, so no parser swap is visible to a
user today. For the record:

- **Hand-written recursive descent in TypeScript** would run perhaps 2-5x faster than Chevrotain and
  remove about 100ms of import and parser construction from every cold start, which is the only part
  a user would feel. It gives up the grammar-generated AST types and Langium's linking, indexing, and
  LSP scaffolding — most of what `packages/language` leans on.
- **Tree-sitter** reparses incrementally in under a millisecond and is what editors (Zed, Neovim,
  Helix, GitHub) want for highlighting, which is an ecosystem reason to publish a Tao grammar. As a
  compiler front end it yields an untyped concrete tree with its own error-recovery semantics, and
  the typed layers over it (`type-sitter`, `rust-sitter`) are heavy and admit immature error
  handling. It solves a problem Tao does not have.
- **Fastbelt** (TypeFox, Go, v0.1 in March 2026) is the closest thing to "Langium, but fast":
  28-49x on workspace builds. It is new, its grammar compatibility with Langium is undocumented, and
  a Go core has no good browser story for Studio. Worth re-reading in six months.

### 7.2 A native toolchain core

Ports of JavaScript-hosted tools to Go or Rust report 8-35x (TypeScript 7 about 10x, Biome 25-35x
over Prettier, oxc 20-50x over Babel), from native code, shared-memory parallelism, and
single-pass, low-allocation design together. Two cautions from the same record: Prisma moved _off_
its Rust engine because serializing across the language boundary cost more than Rust saved, and
ReScript moved its build driver back to OCaml to keep one implementation language. A native Tao core
would only pay if the whole pipeline — parse to emitted TSX — stayed on the native side, shipped as
per-platform binaries in the esbuild pattern, with a WASM build for Studio's browser editor. That is
two toolchains to keep in step until the TypeScript one is deleted.

What it would buy: a cold `tao check` of about 20ms instead of 350ms with no resident process, and
headroom past 100k lines. What it would not buy: anything in `tao test` or the preview loop, which
are bounded by Jest, Babel, Metro, and React Native. After section 8's first two phases the CPU-bound
work is 50-200ms per command, so the realistic gain is 0.3s per cold invocation. That is not worth a
rewrite before MVP. It becomes worth it if Tao must compile on-device inside a native host, or if
real projects outgrow Langium's heap, and the trigger should be one of those, observed.

### 7.3 The runtime: Expo, native source, or a fixed engine

- **Emit SwiftUI and Jetpack Compose source.** The shipped app improves; the loop does not. 2025-26
  reports have SwiftUI previews and Xcode incremental builds at 2-12s, and Compose hot reload reached
  1.0 only in January 2026 and is desktop-JVM-first. React Native's Fast Refresh is sub-second.
  Skip.tools shows Swift-to-Kotlin transpilation is viable and that its native mode builds slower
  than its transpiled one. It also means two code generators, two runtime libraries in two languages,
  simulator-bound behavior tests, and no web target. A plausible _release_ backend later; the wrong
  move for speed.
- **A fixed native runtime that interprets the app** — Hypen, ByteDance's Lynx, Yandex DivKit, Cash
  App's Redwood and Treehouse. A prebuilt host holds an engine and native renderers; the app is data;
  reload is a tree patch in milliseconds with no bundler and no per-app native build; tests run
  headlessly in the engine. This is the architecture that would make the whole loop instant. Hypen in
  particular is a Rust engine (Chumsky parser, reactive graph, reconciler) emitting patches to
  SwiftUI, Compose, DOM, and canvas renderers, compiled to WASM or embedded natively — but its
  documented deployment runs state and actions on a server and streams patches over a WebSocket, the
  repository is five months old with 35 commits and two contributors mirroring a private tree, and it
  publishes no performance numbers. It is an existence proof by a small team, not something to build
  on. The proven examples (Lynx, Redwood) are sustained efforts by large companies. For Tao the price
  includes replacing what Expo gives for free: device modules, over-the-air updates, store builds,
  the InstantDB JavaScript client, and the TypeScript injection surface the bridge roadmap depends on.
- **The hybrid worth keeping in view.** A language-owned core that evaluates state, actions,
  navigation, and queries headlessly, with React Native as one thin renderer among possible others.
  It would make journeys millisecond-fast and renderer-independent (option D above), keep Expo for
  everything it is good at, and leave SwiftUI and Compose renderers as additions rather than a
  rewrite. Redwood is the prior art: a Compose-driven core in a JavaScript VM, native widget bindings,
  a JSON protocol between them. Today's runtime is React components, so this is a redesign of
  `packages/apps/runtime` and the code generator, not a refactor.

## 8. Proposed sequence

Phase 0 — remove the defects (days; no design decisions; unblocks every lane in section 3):

1. ~~Resolve the physical-boundary guard once per path (5.1).~~ Landed with this report.
2. ~~Remember what each `use` statement resolves to instead of recomputing it per reference (5.2).~~
   Done.
3. ~~Build the union of a workspace's entries in one pass and validate each entry over the shared,
   linked graph (5.3).~~ Done; check 1.22s and fix 0.80s on the fixture, not the 0.5s projected below,
   for the two reasons 5.3 ends on. `./agent bench` now measures a whole-app check beside parse,
   validate, compile, and format, and fails when a steady-state median passes its budget. The
   budgets are loose on purpose — about 2.5 times what a machine at load 40 measured — so they catch
   a defect of ten times and not one of two; the tests that count work rather than time hold those.
4. ~~Keep Jest's configuration and the compiled apps' paths still across compiles (5.5).~~ Done: the
   entrypoint directory beside the run roots, then a content-addressed store for the compiled apps.
   An unchanged run re-transforms nothing; an edit re-transforms the one module tree it changed.
5. ~~Give a packaged CLI a version-keyed cache in a user cache directory (5.6).~~ Dropped by the Developer on
   2026-09-21: no packaged CLI exists yet, and a published `tao` pays the uncached cost, 1.2s for
   WordFlower, until the standalone CLI plan gives it a home.

Expected on the fixture: check 20s → about 0.5s, fix 9s → about 0.5s, compile 3.2s → about 0.5s,
test after an edit 26s → about 5s; `_tao-check`, `_fix-tao`, and the `tao-cli`, `tao-apps`,
`validator`, `compiler`, `runtime-toolchain`, and `studio` suites shrink with them.

Phase 1 — keep the workspace alive (weeks):

6. `tao run` compiles in-process on a live workspace through `DocumentBuilder.update` instead of
   spawning `tao compile` per save.
7. `tao check --watch` and `tao test --watch` on the same live workspace. `tao test --watch` exists
   as an outer loop (`packages/cli/tao-cli/cli-src/test-watch.ts`): debounced, serialized, and
   rerunning the whole one-shot pipeline, so it costs a full `tao test` per change. What remains is
   giving it the live workspace as its run body, which it takes as a dependency.
8. One resident language service shared by the editor extension, Studio, and optionally the CLI,
   with a version handshake and an idle exit.

Phase 2 — the test loop (decision 9.1): build option C as `tao test`'s inner loop, with Jest kept as
the fidelity lane in `verify`. The prototype is 575 lines of scratch in an ignored directory of the
worktree this report was written in; it disappears with that worktree, and section 6.1 lists what
it took so it can be rebuilt from the description.

Phase 3 — evidence-gated, after MVP: the language-owned runtime core (7.3) and a native toolchain
core (7.2), each opened only by its named trigger.

## 9. Judgments that are the Developer's

1. **Is a lower-fidelity inner test loop acceptable?** Option C runs journeys against a stub of
   React Native. Decided by the Developer on 2026-09-21: yes. Headless is `tao test`'s default while iterating,
   and the Jest run stays the gate in `verify` that proves a journey against real React Native
   JavaScript. Phase 2 opens after Phase 1's first slice.
2. **May the CLI rely on a resident process?** Decided by the Developer on 2026-09-21: yes, it may. Also decided
   the same day: Phase 1 starts with `tao run` compiling in-process, before watch modes, because the
   1-2s edit-to-preview bar is the one people feel; a shared background service comes only if cold
   one-shot commands still feel slow after that, because daemons cost lifecycle bugs. That decision
   rested on 5.4's claim that a save spawned a process, which was stale (see 5.4); the in-process
   part already exists, and what a live workspace is worth is about 0.1-0.15s per save. Whether to
   build it now, measure Metro's side first, or go to Phase 2 first was put back to the Developer on 2026-09-22
   and is open.
3. **Does the runtime stay React-shaped after MVP?** The hybrid core is the only option here that
   improves the loop _and_ opens native renderers. Recommended: decide nothing now; open a
   time-boxed spike after MVP, informed by what Phase 2's headless runner had to stub.

## 10. Sources

- Langium and successors: <https://www.typefox.io/blog/fastbelt-introduction/> (2026-03-27);
  <https://www.typefox.io/blog/optimizing-parser-performance/>;
  <https://langium.org/docs/recipes/performance/caches/>;
  <https://langium.org/docs/reference/document-lifecycle/>;
  <https://github.com/eclipse-langium/langium/discussions/1621>;
  <https://github.com/mermaid-js/mermaid/issues/4401>.
- Tree-sitter as a front end: <https://docs.rs/type-sitter/latest/type_sitter/>;
  <https://www.shadaj.me/writing/introducing-rust-sitter>;
  <https://github.com/tree-sitter/tree-sitter/discussions/3413>.
- Resident processes: <https://github.com/mantoni/eslint_d.js/>;
  <https://biomejs.dev/internals/architecture>;
  <https://github.com/microsoft/TypeScript/wiki/Standalone-Server-(tsserver)>.
- Native ports and their limits: <https://devblogs.microsoft.com/typescript/typescript-native-port/>;
  <https://oxc.rs/docs/guide/benchmarks>;
  <https://www.prisma.io/blog/from-rust-to-typescript-a-new-chapter-for-prisma-orm>;
  <https://rtfeldman.com/rust-to-zig>; <https://github.com/yyx990803/bun-vs-node-sea-startup>.
- Incremental architectures: <https://rust-analyzer.github.io/book/contributing/architecture.html>;
  <https://rescript-lang.org/docs/manual/latest/build-performance>;
  <https://nextjs.org/blog/turbopack-incremental-computation>.
- React Native testing: <https://github.com/jestjs/jest/issues/10833>;
  <https://dev.to/changwoolab/running-react-native-testing-3x-faster-3j98>;
  <https://github.com/oven-sh/bun/issues/10083>;
  <https://github.com/mdjastrzebski/universal-test-renderer>;
  <https://github.com/callstack/react-native-testing-library/discussions/1698>.
- Runtimes: <https://github.com/hypen-lang/hypen>; <https://docs.rs/hypen-engine/latest/hypen_engine/>;
  <https://github.com/cashapp/redwood>;
  <https://code.cash.app/native-ui-and-multiplatform-compose-with-redwood>;
  <https://github.com/divkit/divkit>; <https://skip.tools/docs/modes/>;
  <https://blog.jetbrains.com/kotlin/2026/01/the-journey-to-compose-hot-reload-1-0-0/>.

Not independently verified, and used only as colour: third-party Lynx cold-start figures, secondary
reports of Biome's speedup over Prettier, and the 2025 accounts of SwiftUI preview regressions.

## Appendix A. The two experimental memos

Applied, measured, and reverted; neither is a proposed implementation, since a real fix scopes the
table to a build and invalidates it on file-system change.

```ts
// Packages.ts, remainsInsidePhysicalBoundarySync: resolve each path once per process.
const memo = (globalThis as any).__realpathMemo ??= new Map<string, string>()
const real = (p: string): string => {
  let value = memo.get(p)
  if (value === undefined) {
    value = FS.realPathSync(p)
    memo.set(p, value)
  }
  return value
}
return FS.pathIsWithin(real(path), real(resolution.physicalBoundaryRoot))

// value-scope.ts, collectTargetDeclarations: resolve each use statement once per document lifetime.
const useMemo: WeakMap<object, AST.Declaration[]> = (globalThis as any).__useMemo ??= new WeakMap()
const held = useMemo.get(useStatement)
if (held !== undefined) {
  return held
}
// … existing body …
useMemo.set(useStatement, declarations)
```
