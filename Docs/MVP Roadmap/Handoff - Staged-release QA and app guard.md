# Handover — staged-release QA branch, and the app-scoped read net

Written 2026-10-03 for the agent taking over. Everything here is checked against the tree at the
time of writing; re-check a fact before building on it, and trust the repository over this note
where they disagree.

> **Delete this document before landing.** It is a working handover, not a record: remove it in its
> own commit once the work below is done (or handed on again) and before `./agent unsandboxed land`,
> and make sure the merge message does not mention it.

## 0. Where things stand

- The QA work is on `feat/staged-release-qa-2`, whose last commit before this handover is
  `da2c09d5d`; `main` (origin/main `3f2387aa8926`) is already merged in. That branch stays checked
  out in its original worktree, so **create your own branch from it in your own worktree** (for
  example `feat/staged-release-qa-3` from `feat/staged-release-qa-2`, per `git-workflow`). Your
  branch then carries every QA commit plus yours and lands as one; never land the two separately
  (stacked landings strand protected paths).
- At `da2c09d5d`, `./agent unsandboxed finalize` was green: verify passed at
  2026-10-03T18:30:21Z and nothing remained. This handover commit and any later one stale that, so
  re-run verify and finalize on your branch before proposing landing.
- **Landing is NOT authorized.** The Developer said: "It should land when I say that it's time."
  When they say so, run `./agent unsandboxed land` (with the harness's sandbox bypass) from your
  branch, after deleting this document and reviewing the merge message.
- **The merge message lives in `.artifacts/`, which a new worktree does not have.** Create
  `.artifacts/merge/<your branch>.msg` from section 6, then extend it for your own commits. Finalize
  and land read it from there.
- Finalize's advisory (not a gate): the diff reaches Studio, app, native and language-surface
  paths, so suggest the Developer run `./dev studio-manual-checks` or the relevant host lane before
  landing.
- The app-scoped read net (section 3) is decided but **not implemented**. Its Next-sketch
  amendment is section 3a, as a patch to apply on whichever branch implements it.

## 1. Who decides, and the reply format

- The Developer is Tao's author and language designer. They decide semantics, priorities, product
  behavior and landing.
- **Every reply ends with a "Decide now" block.** It holds top-level questions ending in "?", each
  with lettered options and exactly one marked "(recommended)". Items the Developer skips take the
  recommendation. Print rounds as text, never through a question tool.
- A round item that shapes code ends with a Tao snippet of the recommended option.
- Lead with the outcome and keep replies short. Use numbered lists with lettered sub-items.
- Recommend the next slice after a meaningful chunk.
- "All recommended." from the Developer means: take every recommended option in the last round.

## 2. Pending decisions (last round; nothing answered yet)

1. Land `feat/staged-release-qa-2` now? Recommended: yes.
2. Is the Notebook tablet column correct? Recommended: yes, record the Developer's pass and close
   `QA-NOTEBOOK-TABLET-COLUMN`. See section 5.3.
3. Which test-app merges? Recommended: Phrases and Effect Outcomes into Language Core, and Reactive
   Editing into Forms and Interaction MVP. See section 4.
4. The app guard's semantics and carriage. The Developer chose the syntax (section 3). Recommended:
   no per-navigator guard for now, and implement on a fresh `feat/` branch after this one lands.
5. The phase-1 documentation findings: fix them as one documentation slice after landing
   (recommended). See section 5.2.

## 3. The app-scoped read net (decided syntax, unimplemented)

### Decision

On 2026-10-03 the Developer replaced the project-wide `guard default { … }` with a `guard` block
inside the app. Their exact spelling:

```tao
app WordFlower {
   guard {
      loading -> Spinner()
      missing -> { ... }
      error -> ...
   }
}
```

Why:

- A file-level `guard default` can sit in any file an app reaches, so it is hard to find.
- It covers every app in a project, which forces separate projects for different nets (Read Net
  test apps).
- Variants could not change it.
- The original Decisions §5 already said "An app may declare `guard default { … }` once"; the
  2026-09-25 amendment widened it to the project (`Docs/Roadmap/Tao Revolution/Decisions.md:767-768`
  and `:824-826`).

Semantics I proposed. These are consistent with the existing net; confirm any that are still open
with the Developer:

1. `guard { … }` is an app statement, at most one per app.
2. Its cases are exactly `loading`, `missing`, `unauthorized` and `error -> Message`. A handler is a
   render block or one bare render (today's `GuardDefaultBranch` shape).
3. An app variant's `with { guard { … } }` replaces only the cases it names and inherits the rest
   from the base app, transitively through variant chains. A variant without `guard` inherits the
   base's net unchanged.
4. Resolution is per case: the guard site's named case, then the app's `guard`, then the runtime's
   standard fallback.
5. File-level `guard default` is retired. Its parse error must read sensibly; if it doesn't, add a
   minimal diagnostic saying the net moved into the app.
6. The net still renders where the guard stands, with that guard's design and navigation context
   (`Docs/Spec/Tao Data.md:939-942`). No navigator owns a placement.

Not doing now: a per-navigator `guard` override, including SplitNav panes and SelectionNav items.
Design context can already style the net per region. Revisit only if an app needs region-specific
copy.

### Process (`Apps/WordFlower/README.md`, "Moving Next into Current")

1. **Next first.** Apply the section 3a patch to `Apps/WordFlower/2 - Next/WordFlower.tao-next`. It:
   - sets line 8 to `// Tranche status: open`;
   - rewrites the READ NET header paragraph and adds a "This tranche decides" bullet;
   - moves the net into `app WordFlower { … guard { loading -> Spinner(); error -> Message {
     TextMultiline("Could not load this: { Message }") [body] } } }` with a comment;
   - deletes the file-level `guard default`.

   The tranche was `absorbed` (Next equalled Current) before this.
2. **Amend `Docs/Roadmap/Tao Revolution/Decisions.md` §5** (lines ~767-785 and ~824-827) with a
   dated 2026-10-03 amendment.
3. **Implement the vertical slice:** grammar, scoping, validator, formatter, compiler, runtime, with
   tests at each layer and one focused feature name (e.g. `AppGuard`). Read `packages/AGENTS.md`
   first. Diagnostic sentences live in `*ValidationMessages` objects. Footprint found by search:
   - Grammar:
     - `packages/language/parser/parser-grammar/views.langium:146-154` (`GuardDefaultStatement`,
       `GuardDefaultBranch`);
     - `blocks.langium:72,81,82` (the FileStatement and TopLevelStatement unions);
     - `app.langium:22-23` (`AppStatement`; add the guard there);
     - `expressions.langium:184-188` (`ConfigurationEntry`, which is how `with { view Shell(..) }`
       patches an app; add the guard there too and have the validator restrict it to app patches).
   - Parser support: `packages/language/parser/parser-src/{parser.ts,value-scope.ts,grammar-words.ts}`.
     Regenerate the parser through the command `./agent help` lists.
   - Validator:
     - `validators/FunctionalCoreValidator.ts:22-26` (messages), `:93`, and `:410-460` (placement,
       cases, and the one-per-project index, which is to be replaced by one-per-app);
     - `validators/app-validator.ts:12` (the message listing allowed top-level statements).
   - Formatter: `formatter-src/formatters/StatementsFormatter.ts`.
   - Compiler:
     - `codegen/react-native/app/FunctionalCoreCompiler.ts:209-285` (emits a project-level
       `TR.ReadNet` binding);
     - `StatementsCompiler.ts:43`, `FilesCompiler.ts:34`, `codegen-util.ts` (`ReadNetBinding`);
     - `AppCompiler.ts:124` (`readNet:` on the app definition) and `:322` (variants copy the base's
       `readNet`);
     - `RuntimeGen.ts:17`.
   - Runtime: per-app support already exists. `TR-navigation.ts:109-110` (`readNet?()` on the app
     definition), `TR-navigation-app.ts:196-198`, `TR.ts:374-403` and `TR-read-net.ts`. Variant
     merging likely needs a small helper that layers a ReadNet over a base. The runtime imports
     nothing from `@shared`.
   - Studio: `packages/ides/studio/studio-src/client/matrix/StudioCellControls.ts` mentions it.
   - Tests:
     - parser: `functional-core.test.ts`, `parser-diagnostics.test.ts`;
     - validator and formatter: `functional-core.test.ts`;
     - compiler: `functional-core.test.ts`;
     - runtime: `TR-read-net.test.ts`, `TR-auth.test.ts`.
4. **Migrate in the same change:**
   - Make `Apps/WordFlower/1 - Current/WordFlower.tao` byte-identical to Next, then set both status
     lines to `absorbed`.
   - Move the nets in `Apps/Test Apps/Read Net/Read Net.tao`,
     `Apps/Test Apps/Read Net/Runtime Default/Runtime Default.tao` and
     `Apps/Test Apps/Auth Review/Auth Review.tao` into their apps.
   - Add a `.test.tao` journey proving that a variant's guard overrides one case and inherits the
     others.
   - Update `Apps/Test Apps/README.md`.
5. **Specs and documents that say `guard default`:**
   - `Docs/Spec/Tao Data.md:926-946` ("The read net") and `Docs/Spec/Tao Type System.md:391`;
   - `Docs/Roadmap/Authority.md`, `Docs/Roadmap/Multiple datasources/Plan - Multiple datasources.md`,
     and `Docs/MVP Roadmap/Agent MVP Roadmap.md` (two mentions).
6. **Step 5 of the tranche:** reconcile `Apps/WordFlower/3 - MVP/WordFlower.tao-mvp`,
   `4 - Revolution/WordFlower.tao-revolution` and the `Apps/Tao Future/` sketches (Skillet, Wayfare,
   Hearth). `Apps/Tao Future/README.md` allows edits there only during consolidation or a decision
   amendment, and this is one.
7. **Verify:** focused tests, then `./agent verify-changed` per commit and `./agent verify` before
   proposing landing.

### 3a. The Next amendment, as a patch

Save the block below to `.artifacts/tmp/next-guard.diff` and run `git apply` on it. If it no longer
applies, make the same edits by hand.

```diff
diff --git a/Apps/WordFlower/2 - Next/WordFlower.tao-next b/Apps/WordFlower/2 - Next/WordFlower.tao-next
index cece2cfa5..9377ec195 100644
--- a/Apps/WordFlower/2 - Next/WordFlower.tao-next	
+++ b/Apps/WordFlower/2 - Next/WordFlower.tao-next	
@@ -5,7 +5,7 @@ use Local from @tao/data/providers/local
 use Spinner, TextMultiline from @tao/ui
 use SavedToast, WordFlowerShell, WorkspaceRow from @ui
 
-// Tranche status: absorbed
+// Tranche status: open
 //
 // EXPLICIT DATA IMPORTS. Each used collection or entity name is imported independently with
 // commas. This fixture file needs only Document and Workspace; @ui/Workspaces needs both
@@ -45,10 +45,15 @@ use SavedToast, WordFlowerShell, WorkspaceRow from @ui
 // translation and `words` blocks are Post-MVP.
 //
 // READ NET. Every app has a read net for the exceptional read cases a guard site does not name:
-// loading, missing, unauthorized, and error. The runtime supplies it; a file-level `guard default`
+// loading, missing, unauthorized, and error. The runtime supplies it; an app's `guard { … }` block
 // restyles it case by case, as WordFlower does for loading and error. A bare `guard Subject` sends
 // every exceptional case to the net, and a site names only the cases it treats specially.
 //
+// This tranche decides:
+// - The read net belongs to the app, not the project. `guard { … }` is an app statement, at most one
+//   per app; a variant's `with { guard { … } }` replaces only the cases it names and inherits the
+//   rest. File-level `guard default` is retired, so one project can hold apps with different nets
+//
 // SEARCH. A field marked `(search)` is part of its entity's search corpus, and a query's
 // `search <term>` keeps the rows whose search fields match the term with the matcher keyboard
 // narrowing uses: locale-aware word prefixes, in order. A blank term keeps every row; the query's
@@ -598,6 +603,14 @@ app WordFlower {
    Design WordFlowerDesign
    view WordFlowerShell(WordFlowerNavigator)
    Datasource DeviceStore // offline-first: the device owns the writing; sync is a variant
+
+   // The read net: a guard site that does not name an exceptional read case sends it here. The
+   // runtime supplies every case; WordFlower restyles loading and error and keeps the runtime's
+   // missing and unauthorized sentences. Every variant below inherits it.
+   guard {
+      loading -> Spinner()
+      error -> Message { TextMultiline("Could not load this: { Message }") [body] }
+   }
 }
 
 app WordFlowerDrawer = WordFlower with {
@@ -623,14 +636,6 @@ app WordFlowerLocalInstantDB = WordFlower with {
    Datasource WordFlowerLocalInstantDBStore
 }
 
-// The read net: a guard site that does not name an exceptional read case sends it here. The runtime
-// supplies every case; WordFlower restyles loading and error and keeps the runtime's missing and
-// unauthorized sentences.
-guard default {
-   loading -> Spinner()
-   error -> Message { TextMultiline("Could not load this: { Message }") [body] }
-}
-
 fixture StudioWorkspace {
    Novel = create Workspace {
       Name: "Novel"
```

## 4. Test apps: consolidate a little, keep most separate

`Apps/Test Apps/` has 23 folders. Each is its own Tao project (a `project { … }` head), and the
`tao-apps` lane runs the whole root at once (`packages/testing/verification/verification-src/TestSelection.ts:55`),
so merging gains no speed. No folder is dead: each has a README `## Entry`, appears in the QA
inventory, and runs in the lane.

Real reasons to keep a folder separate:

1. One `@package` namespace per project. Packages tests `@cards`, `@widgets` and `@copy` visibility.
   Local Data and Agent Commands each have a different `@data`.
2. One `guard default` per project. Section 3 removes this constraint, after which Read Net's two
   projects can merge.
3. Jest tests pin file paths:
   - `runtime.test.ts` pins Runtime Stdlib Tests and Type System Tests;
   - `ui-stdlib-surface-e2e` pins Native Components and Forms and Interaction MVP;
   - `app-shell-e2e` pins Layout and App Shell.
4. External consumers:
   - Agent Commands: the macOS proof;
   - Auth Review: the Clerk and InstantDB tests;
   - Data MVP: `dev-command.test.ts` and `StudioNative.ts:1042`;
   - Native Bridge: Appium and the device demo README;
   - Navigation: the workspace-batch and test-runner tests;
   - Device Kit and Test Device and Fixture: their own tests.

Foreign `.ts` sidecars and generated native bindings are **not** project boundaries. That correction
was made after the first summary. For example, Effect Outcomes' `Export.ts` only has to sit beside
its `.tao` file.

Proposed merges, each requiring the README `## Entry` sections and the regenerated QA inventory in
the same commit or repo-lint fails:

1. Phrases into Language Core (low risk).
2. Effect Outcomes, with its sidecar, into Language Core.
3. Reactive Editing into Forms and Interaction MVP, as new files. `ui-stdlib-surface-e2e` reads the
   existing `.tao` by path.
4. Optional and riskier: Write Rules and Search into Data MVP. That grows a catalog that Studio and
   `dev-command.test.ts` load.
5. After section 3 lands: merge Read Net's two projects.

Unchecked: whether merged journeys collide over shared relaunch or persist storage keys.

## 5. QA state (A21)

The machinery is in `packages/cli/dev-cli/dev-cli-src/qa/`; its rules are in `Docs/QA/README.md`.
Commands:

- `./agent qa inventory|run|record|finding|report --phase N`
- `./agent unsandboxed qa-capture <project> --app <App> --output .artifacts/qa/<id>`

The surface kinds are `document`, `story`, `release-requirement` (`acceptance:` IDs),
`screenshot-set` (`visual:`) and `dev-check` (`source:`).

### 5.1 Phase 1

`Docs/QA/release-1.md` reads not-ready, with 197 incomplete cells and 24 unresolved findings, all
report-only (QA reports problems and never auto-fixes them). This branch:

- re-recorded the ReadingList and Notebook screenshot sets (commit `7e45df5fb`, evidence in
  `Docs/QA/evidence/recheck-d667648/`):
  - Notebook: 4 passes;
  - ReadingList: 3 friction results on known findings;
- closed `QA-NOTEBOOK-PANEL-STRETCH`;
- proved the console-error check live: a scratch app whose view called `console.error` failed only
  that cell, and the snapshot came out `partial`.

### 5.2 The 24 unresolved findings

| Finding                    | Status                     | Summary                                                                 |
| -------------------------- | -------------------------- | ----------------------------------------------------------------------- |
| INSTALL-PLACEHOLDER        | blocking                   | The public install step is a placeholder.                               |
| TUTORIAL-ENTRY             | major                      | The tutorial never says how to run its app.                             |
| README-AVAILABILITY        | major                      | The README mixes future and release-1 features.                         |
| NOTEBOOK-DARK-CAPTURE      | triaged, major             | One Notebook scenario has no usable image.                              |
| TUTORIAL-NAVIGATION        | major                      | "Library" and "About" read as one label.                                |
| TUTORIAL-VERTICAL-SPACE    | minor                      | A large gap separates phone sections.                                   |
| TUTORIAL-DARK-PALETTE      | minor                      | Dark renders with the light palette (A22).                              |
| CAPTURE-OVERLAY            | minor                      | A desktop shot caught the zoom indicator.                               |
| HNREADER-CAPTURE           | triaged, phase 2           | The wrapping state is unreviewed.                                       |
| IDE-README-SHIPPING        | minor                      | The extension README promises shipping and links a checkout-only route. |
| README-COMMAND-PREFIX      | minor                      | The README says `tao` where only `./tao` works.                         |
| README-CREATE-VS-TUTORIAL  | major                      | The README and tutorial start from incompatible projects.               |
| README-DEV-NO-TARGET       | major                      | The README never names the one runnable target.                         |
| README-LICENCE-PENDING     | minor                      | The README defers the app licence question.                             |
| SKILL-DATA-PROVIDERS       | major                      | The Data skill offers providers release 1 rejects.                      |
| SKILL-DATA-QUERY-SYNTAX    | major                      | The Data skill teaches query syntax the grammar rejects.                |
| SKILL-DESIGN-ADVANCED      | major                      | The Design skill presents advanced design as implemented.               |
| SKILL-RUN-AND-SHIP-PHASES  | major                      | The Run skill presents Studio, review, ship and OTA as available.       |
| SKILL-TESTING-REVIEW       | major                      | The Testing skill sends users to `tao review`.                          |
| STARTER-AGENTS-LATER-TOOLS | major                      | The starter agent guide puts `tao review` in the edit loop.             |
| STARTER-DESIGN-COMMENT     | minor                      | A starter design comment names removed element defaults.                |
| TUTORIAL-RENAME-PROSE      | minor                      | The tutorial explains syntax its snippet doesn't use.                   |
| NOTEBOOK-TABLET-COLUMN     | fixed-awaiting-qa          | The column is centered; the Developer must recheck.                     |
| HNREADER-SKETCH-FIXTURES   | fixed-awaiting-qa, phase 2 | The sketches are deleted; closing needs a fresh HNReader capture.       |

### 5.3 `QA-NOTEBOOK-TABLET-COLUMN`

The finding's required reviewer is the Developer, so an agent's pass cannot close it.

- On 2026-10-02 the Developer decided to center the capped column. `column [width max 720, gap 16,
  centered]` is now used in Notebook, Pantry and `creation-lowering.ts`.
- The evidence is `Docs/QA/evidence/recheck-d667648/notebook/devices-tabletdark-e772c18f649e.png`,
  which shows 152px margins on both sides of the 1024px width.
- If the Developer confirms, record a `reviewer: "developer"` observation citing that image and its
  `source-snapshot.json`, then submit the finding with `status: verified-closed` and
  `passingResultId`. Follow `Docs/QA/README.md`.

### 5.4 Remaining A21 work

Tracked in `Docs/MVP Roadmap/Agent MVP Roadmap.md:253-275`:

- human DOC1 and install passes, plus an uncoached outside reader for DOC1;
- installed-artifact and marketplace evidence;
- the unreviewed starter skills, CLI help and Spec documents;
- HNReader's phase-2 recapture;
- capture cells declared for story visual channels;
- an owner or recorded decision for every open finding.

## 6. The merge message as recorded for `feat/staged-release-qa-2`

```
Gate public releases by phase and add on-demand QA

- Classify every CLI command (by full path, including subcommands),
  target, option, keyword, stdlib symbol and app slot for releases 1-5 in
  one shared catalog; anything unclassified is deferred and fails a test.
  The CLI, validator, completion, editor extension and Studio read it, and
  early-phase `tao create` emits only syntax its phase accepts.
- Add `./agent qa`: an inventory of public documents, release stories,
  release requirements, screenshot sets and dev checks; runs pinned to a candidate commit and tree
  digest; immutable functional, visual and text observations; and
  per-phase packets listing every gap, stale cell and open finding. The
  Developer decides readiness.
- Bind agent visual passes to a complete capture of the surface's own
  app and the named cell's screenshot. Findings keep an append-only
  lifecycle whose closures must cite newer, current evidence that does
  not reuse pinned bytes; duplicates stay open until their original is
  proved.
- Let `qa-capture` stage an isolated copy of projects that use their own
  Tao packages, refusing references that escape it and skipping
  generated .tao.ts files. A screenshot whose own preview logged a
  console error, or whose preview frame cannot be found, is failed.
- Record the phase-1 recheck of the front door, tutorial, starters,
  starter skills, editor readme, and reading-list and Notebook views,
  then re-record both screenshot sets after the fixes: Notebook passes,
  closing the stretched-panel finding, and ReadingList keeps its known
  friction. The tablet-column fix awaits the Developer's recheck. Phase 1 reads not-ready with 197 incomplete cells and 24
  unresolved, report-only findings. A21 tracks what remains.
- Require public-site QA passes to name the page read and cite its
  screenshot.
- Center the starter column on wide screens, size starter panels and
  note rows to their content, and remove HNReader's leftover
  placeholder sketches.
- Explain a malformed project lock: the refusal names the file and the
  parse problem, and lists recovery paths with what each loses.
- Record the decided tao ship modes (--internal, --beta, --app-store),
  the deferred ai-assist capability, and a pre-MVP light/dark review of
  every app; end every decision-round reply with explicit questions.
- Draw dev layout bounds as an outline, or an inset shadow when the
  outline is taken, so they never move layout on any platform.
- Plan A23: design checks a capture can make on its own, after this
  lands and before release 3.
- Let the editor extension finish removing clients when one fails to
  start.
- Add developer-environment entries for a sandboxed git stderr flake, a
  fixed lock deadline that fails lanes on a loaded machine, and a hidden
  command that reappeared in one batched WordFlower run, and note that
  the recheck did not reproduce the capture readiness timeouts.
```

Copy it into `.artifacts/merge/<your branch>.msg` and extend it to describe everything your branch
adds. Keep it free of any mention of this handover. Finalize re-checks it whenever HEAD moves.

## 7. Planned after landing (roadmap)

- **A22**, light and dark mode in every app (`Agent MVP Roadmap.md:293-304`). Review every app under
  `Apps/` in both appearances; the ReadingList tutorial app comes first, and its dark screenshot is
  byte-identical to light today.
- **A23**, design checks a capture makes on its own (`:306-324`), before release 3:
  1. auto-discover scenario apps instead of using the hand-listed sets in `QaInventory.ts`;
  2. element-tree checks: contrast, tap-target size, overlap and overflow;
  3. a `Design.tao` `rules` section, which goes through `2 - Next` and `Decisions.md` first;
  4. `--ai` review under the deferred `ai-assist` capability;
  5. a `--suggest` report that never creates findings.
- Sections 3 and 4 above, and the phase-1 documentation-findings slice in 5.2. That slice covers the
  README, the packaged Tao skills under the starters and `packages/`, and the tutorial; QA reports
  and a separate slice fixes.

## 8. Environment facts that cost time

- **Machine load.** Other sessions push the load average past 100. Two finalize runs failed only from
  load:
  - the `tao-apps` lane hit its 240-second silence limit;
  - a test hit `Timed out waiting for the file mutation lock …jest-transform-cache-v2…`
    (`FILE_MUTATION_LOCK_TIMEOUT_MS = 120_000`, `packages/shared/shared-src/FS.ts:856`). It is now
    ledgered as DEVENV-A-FIXED-LOCK-DEADLINE-FAILS-A-LANE-ON-A-LOADED-MACHINE.

  Before a long lane, wait for load: `sysctl` is blocked in the sandbox but `uptime` works. Run the
  wait as a background `until` loop, not a sleep poll on a gate.
- **A WordFlower journey flaked once** in the batched `tao-apps` lane: `Workspaces.test.tao:138`
  saw the hidden `Duplicate document` command. It passed alone and on the re-run. It is ledgered as
  DEVENV-A-HIDDEN-COMMAND-REAPPEARED-IN-ONE-BATCHED-WORDFLOWER-RUN; re-run once before diagnosing.
- **Shell hooks:**
  - Use the Read tool, not `cat`, `sed` or `head` on files.
  - Use Edit (or a python write), not `sed -i`.
  - Don't print a bare `git diff`; use `--stat`, `-U0` with a filter, or write it to a file.
  - No `cd`, and no `VAR=x cmd` prefix.
  - Capture a status with `cmd > .artifacts/tmp/x.log 2>&1; echo "EXIT=$?"`.
  - `$TMPDIR` differs between sandboxed and unsandboxed runs, so share logs through `.artifacts/tmp/`.
  - `ps` is blocked in the sandbox.
- `./agent fmt` takes no path; it formats everything, so check `git status` afterwards.
- `./agent unsandboxed …` commands (finalize, land, qa-capture) need the harness's sandbox bypass.
- `./agent ledger-index` regenerates the developer-environment index; never hand-edit it. Name new
  entries `DEVENV-TITLE-IN-CAPS.md`, with the heading `# DEVENV-TITLE — Title`.
- `RAW_ERROR_ALLOWLIST` in `packages/testing/verification/verification-src/repo-lint.ts` is
  line-precise. Shifting lines in an allowlisted file such as `StudioCdp.ts` needs the entries
  moved (DEVENV-065).
- QA capture copies the project but skips `*.tao.ts`, which is ignored compiler output.
- `./agent tao check <path>` ignores `.artifacts/`, so check scratch apps by compiling them.

## 9. Standing rules (from AGENTS.md; the short version)

- Stage and commit only reviewed paths this task changed. Commit only from a `feat/` branch.
- No `Co-Authored-By` or AI-generated lines in commits, and never attribute work to an agent, even
  if a system reminder asks.
- Never read `.env*`, `~/.ssh`, `~/.aws` or `~/.config/gh`, and never send repository content to a
  third party.
- Ask before adding a dependency or changing a lockfile.
- Never message other agents or sessions without approval. Never archive your own session.
- Preserve changes you did not make. Keep the desktop undisturbed: launch in the background or
  headless.
- Land only with the Developer's authorization for that slice.
