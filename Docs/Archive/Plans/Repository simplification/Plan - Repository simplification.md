# Plan - Repository simplification

Audited at commit `37c32830` (Complete Tao Studio v2), 2026-08-31. Every finding below was produced
read-only and verified against code at that commit — file:line references drift, so re-verify each
claim against the current tree before acting on it. Findings carry a **Done** / **Skipped** /
**Blocked on Ro** marker as they land; where re-verification contradicted a finding, the tree won
and the finding is corrected in place.

## Status

`main` is merged in at `91bef867`. Every Part 7 decision is answered; none remain blocking.

| Phase                                     | State                                                                                                                                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Dead code (Part 1)                     | **Done**                                                                                                                                                                                |
| 2. Environment quick wins (4.2, 3.3, 4.3) | **Done**                                                                                                                                                                                |
| 3. Test-harness modules (2.6)             | **Partly done** — shared helpers landed; the three package-local `test-*.ts` modules and all adoption remain                                                                            |
| 4. Test surface (2.1–2.5)                 | **Partly done** — four of five Test App merges landed (17 folders → 11); the TR, studio, pipeline, and dev/CLI passes remain                                                            |
| 5. Production structure (Part 3)          | **Partly done** — the TR error consolidation, the generated-run lifecycle, and the preview symlink landed; the Studio protocol/route/guard consolidation and the god-file splits remain |
| 6. Command surface (4.1)                  | **Not started**, and re-scoped: Ro's ruling keeps `./tao`, `Justfile`, and `./dev` distinct rather than collapsing them                                                                 |
| 7. Conventions (Part 5)                   | **Partly done** — the error-handling redesign landed (451 raw throws → 16, all deliberate); the `ValidationContext` flip and the export/rename sweep remain                             |
| 8. Documentation (Part 6)                 | **Not started**                                                                                                                                                                         |

Work that arrived outside the original plan, because a decision or a discovery called for it: the
error-handling redesign (Part 5 item 8), retiring Typir onto `Type` (Part 7 item 4), the `relaunch`
test step, and per-check isolation of device-local persisted state.

Known pre-existing failure, unrelated to this plan's execution: the smoke-lane test
`packages/dev/studio-smoke/studio-simulated-user.test.ts` fails at
`document.querySelector('.studio-preview-group-label')?.textContent === 'states'`. Confirmed
identical at `2668490d`, before any simplification work. Because the smoke lane sits outside
`verify` (guardrail 6), nothing catches this rot; fold a fix into 2.3 step 8, which already
rewrites that file's vacuous assertions.

This plan is the working document for an executing agent. It makes concrete several open Roadmap.md
items: "Review all tests", "Clean up the TR package", "Rework the rest of the markdown set",
"Remove magical strings", "Improve utility function usage", "Apply the named-const export pattern",
"Change the argument order of `ValidationContext.error`", and "Improve the imports and exports
structure". When a slice of this plan lands, reconcile the corresponding Roadmap.md entry in the
same change.

## How to execute

- Work in independently landable slices; the phase order in Part 8 minimizes rework. Run focused
  tests while working and `./agent verify` before every commit.
- The guardrails below override individual findings. When a finding and a guardrail collide, the
  guardrail wins; note the skip rather than forcing the change.
- Items marked **Ro decision** are collected in Part 7. Do not act on them without Ro's answer;
  everything else is executable on repository evidence.
- Test consolidations must keep every distinct behavior provable somewhere. Each removal names its
  surviving proof — if re-verification shows that proof is gone, keep the test.
- `repo-lint` machine-checks the Test Apps README↔folder contract; every Test App merge must update
  `Apps/Test Apps/README.md` in the same commit or the gate fails.
- Documentation moves must keep all Revolution feature surface referencable: consolidate and move
  with pointers, never delete feature-surface content. `Docs/Roadmap/Archive/` is frozen — move
  files into it; never edit files already there.

## Guardrails — verified keep-as-is

The audit confirmed these are deliberate and load-bearing. They exist to protect against
overzealous cleanup:

1. **The vertical-slice pipeline layout is correct.** Parser asserts AST shape, validator asserts
   diagnostics, formatter asserts canonical text, compiler asserts emitted code; the parser/validator
   boundary is structurally enforced. Do not consolidate stages or their per-slice test files across
   packages.
2. **`runtime` vs `runtime-toolchain` is a packaging contract** (peer-deps-only runtime, boundary
   test in `TR-tests/runtime-package.test.ts`). Never merge them. `TR-switch.ts` duplicating the
   shared `Switch` is boundary-mandated.
3. **`code-editor` stays its own package** — it is the stdlib foreign-view target (`@tao/code-editor`),
   a runtime-toolchain dependency, and pinned by `DependencyCompatibility`.
4. **`workspace` and `stdlib` stay as-is** — composition root and RN-dependency isolation respectively.
5. **The Studio strangler boundary stands — with one carve-out Ro has since made.** Promoting the
   Tao editor to document authority is strangler-plan work sequenced after the external
   browser/native validation gates in `Docs/Roadmap/Tao Studio v2/Plan - Tao Studio v2.md`; it is
   not cleanup and is not in this plan's scope. **Superseded in part:** Ro decided Part 7 item 2, so
   the legacy standalone dev fallback — `buildDirectClientBundle`, `StudioClient.ts`, and the
   `embedded !== true` branches it kept alive — _is_ removed. Everything else about the boundary is
   unchanged.
6. **The smoke lane is deliberately outside `verify`.** "The smoke lane already proves this" is never
   a reason to delete a gate-lane test — it would move coverage from every-commit to on-demand.
7. **Pattern-filtered runs skip the Tao app suite entirely** (`TestRunner.ts` returns no tao-apps
   suite under a pattern). Keep package tests for anything developers iterate on with
   `./dev test <pattern>`; delete a package test only where the Tao-level behavior test is genuinely
   the contract.
8. **The runtime navigation module split is spike-settled** — the dense-looking cross-imports are
   type-only and acyclic. Do not re-merge the navigation family.
9. **Do-not-touch test files:** `TR-navigation-restoration.test.ts` (proof of the Coverage.md
   restoration row that no journey replaces: snapshot encoding, schema fallback, variant keying,
   and entity handles are not observable from a Tao check, even now that `relaunch` restores),
   `TR-navigation-browser-history.test.ts`, `TR-action-transactions.test.ts`,
   `runtime-package.test.ts`, `TR-error-containment.test.ts`, `studio-launch-manifest.test.ts`,
   `studio-protocol.test.ts`, `studio-compile-coordinator.test.ts`, `studio-matrix-session.test.ts`,
   `studio-state-library.test.ts`, `studio-session-manager.test.ts`, `studio-readiness.test.ts`,
   `studio-release-and-canary.test.ts`, `studio-watch-health.test.ts` (minus the one slim noted in
   2.5), `gate-runner`, `repository-doctor`, `dependency-compatibility` (minus the gate change in
   4.2), `agent-config-generation`, and the git-fixture test in `agent-worktree-profile.test.ts`
   (git there is fixture setup, not the subject — the remembered "test that tests git" no longer
   exists).
10. **Not dead, keep:** `TR.ActionDescription`/`TR.ActionSummary` (Decisions.md §8 palettes/Siri —
    pending consumer), `TR.testProvider`/`TR.testNavKind` (spec-published conformance),
    `actionFailuresOf` in `ast-structure.ts` (staged for the pending action-failures amendment;
    reclaim only if that amendment lands elsewhere), the local InstantDB stack (referenced by
    WordFlower, compiler tests, stdlib tests, and the doctor).

## Part 1 — Remove dead code (production)

All claims grep-verified at the audit commit; re-verify each with a repo-wide search (exclude
`_gen_*`) before deleting. One commit per bullet-group keeps blame readable. Effort S each unless
noted.

### runtime

- **Done.** `TaoRuntime-src/TR-navigation-web-history.ts` (135 lines) — zero importers; superseded by
  `TR-navigation-browser-history.ts`.
- **Done.** `TR.Alert` — zero references anywhere, including tests. The `Alert?: any` entry in
  `TR-react-native.ts` went with it.
- **Done.** `TR.IsEmpty` — never emitted by the compiler. Corrected: it had **five** test callers
  (not one), all in `TR-functional-core.test.ts`; all now call `TR.IsCase(x, 'empty')`.
- **Done.** Deprecated `TR.Enum(caseNames)` array overload plus the `ephemeralEnumDeclaration`
  counter — the compiler always emits the identity form. Five array-form test call sites updated
  (`TR-action-transactions.test.ts` ×3, `TR-functional-core.test.ts` ×2).
- **Skipped — the finding was wrong.** `TR.VisualNativeRoot` is _not_ test-only: production stdlib
  calls it at `packages/stdlib/@tao/ui/native/Native.tao:17` and `:37`. Kept.
- **Done.** `setTestStatus` (`TR-data-registry.ts`, re-exported from `TR-data.ts`) — orphaned hook
  for the retired datasource-status test step (Decisions §16); zero callers. The `activeTestSchemas`
  set went with it (write-only once its only reader was gone). The contradictory sentence in
  `Docs/Spec/Tao Testing.md` and the now-stale claim at `Docs/Roadmap/Deterministic simulation.md:93`
  were fixed in the same change.
- **Done.** `TR.Errors` was kept and consolidated (Part 7 item 1), and `Docs/Spec/Tao Actions.md`
  was amended to match.

### studio

- **Done.** `startStudioServer` single-session compatibility entrypoint and its trail:
  `defaultSessionId` threading, the legacy-root fallback of `studioSessionRoute`, `sessionId?` on
  `StartedStudioServer`, the now-constant `welcomeAtRoot` parameter, and the compat tests.
  `startManagedStudioServer` collapsed into `startStudioSessionServer`. The client root fallback in
  `StudioApiRoutes.sessionPath` now **throws** rather than silently returning a bare endpoint no
  server serves — that also keeps the `/sessions/../project` traversal rejection observable.
  Follow-up left in place: the `currentSessionId === undefined` guard at `StudioApp.ts:514-537` is
  now unreachable, but it sits inside the strangler client, so it was not touched.
- **Done.** Dead direct-HTTP file-CRUD action exports `CreateFile`/`RenameFile`/`DeleteFile`
  (`TaoStudioServerActions.ts`) — pre-ProductHost strangler leftovers. `SyncDraft`,
  `ApplySourceAction`, `UndoSourceAction` in the same file are live and were kept. Noted, not
  removed: `StudioServerForeignActions.createFile/renameFile/deleteFile` and their contract entries
  are production-unreachable but still exercised by `studio-server-datasource.test.ts:391-449` and
  still describe live server endpoints — a separate call, outside this bullet's scope.
- **Done.** `renderInspectorPanel` (`client/StudioVisualEditing.ts`) — zero references. Its three
  helpers stayed at the time because `renderInspectorAccordions` used them; that renderer has since
  gone with the legacy client (Part 7 item 2), and the `StudioInspector` helpers remain live because
  `TaoStudioProductHost.tsx` consumes them.
- **Done.** `StudioProductCapabilities` (`client/StudioProductPanels.ts`) — its one note string was
  inlined so the `embedded !== true` branch stays byte-identical, honoring guardrail 5.
- **Done.** Dead `package.json` subpath exports `./compile-coordinator`, `./lsp`, `./protocol`.
- **Done.** Local `stripAnsi` in `studio-src/StudioTestRunner.ts` — now imports shared
  `Text.stripAnsi`.
- **Done, partly deferred.** Removed `.studio-shell--embedded` (`client/StudioShell.ts`, no CSS
  rule) and `.studio-product-host-error` (`TaoStudioProductHost.tsx`, never styled). Removing the
  first left `StudioShellOptions` unused, so `studioShellMarkup()` is now zero-arg and
  `createStudioShell` lost its options parameter; `StudioMountOptions.embedded` and every
  `embedded` branch in `StudioApp.ts` are untouched. `dataset['taoStudioClient']`
  (`TaoStudioBrowser.tsx:8`) was **kept** on purpose — the smoke fix in 2.3 step 8 should assert it
  instead of the nonexistent `[data-studio-tao-drawer]`.

### tao-cli

- **Done.** `validateTaoTestFiles` + `forEachDirectoryGroup` (`cli-src/test-command.ts`) — a
  production-dead third copy of validation already implemented earlier in the same file; only its
  own test called it. `groupPathsByDirectory`, in the same range, is live and was kept. The one
  distinct behavior its test proved — a referenced app's validation error is reported at _that_
  file's path — now has a CLI-level proof in `test-command-cli.test.ts`.
- **Done, altered.** `CompileResult` (`cli-src/compile-command.ts`) was **de-exported and renamed**
  `CompileCommandResult`, not removed: `runCompile` uses it as its return type, and the compiler's
  same-named type is a different shape, so the two were only a name collision.

### parser / validator / formatter / shared

- **Done.** Dead functions in `parser-src/ast-structure.ts`: `appDeclarationOf` (superseded by the
  live `ASTUtils.rootAppValue`), `isAppVariantDeclaration` + its type, `configurableTypeAliasTarget`.
  Its sibling `configurableTypeAliasResolution` is live (`use-package-validator.ts:74`) and was kept.
- **Done.** Unused `./validation` subpath export in `packages/validator/package.json`.
- **Done.** De-exported internal-only symbols (code kept). All eight verified internal-only:
  `primitiveDeclaration`, `slotFillRootTag`, `configuredPrimitiveOfValueDeclaration` (ast-structure),
  `unitFamilyOfPrimitive` (`Type.ts`), `hasInteriorComments` (`formatting.ts`),
  `isStackNavDeclaration` (navigation-validator), `WeightedRigidClaim` (layout-validator), and the
  three request types in `package-resolver.ts`.
- **Done.** `formatsUnchanged` in `formatter-tests/test-format.ts` — referenced nowhere.
- **Not dead — do not re-litigate.** The two Langium "declared but never referenced" warnings
  (`imports.langium:19` `PackageMemberReference`, `actions.langium:29` `CommandDeclaration`) are
  false positives: Langium walks reachability from each file's own entry rule, so a rule declared in
  one imported file and called from another is misreported. Both rules are live
  (`types.langium:17`, `views.langium:28`; `blocks.langium:41/50/61/62`, `expressions.langium:327`),
  and `ParserGenerate.ts` already carries them in `ACCEPTED_DIAGNOSTICS` with reasons, matched by
  exact rule name at the reported line so a genuinely new dead rule still fails the gate.
- Shared-facade functions exercised only by their own tests — `CLI.runSync`, `CLI.formatCommand`,
  `HCI.askText`, `Log.setTransport`: **Ro decision** (Part 7) — delete, or keep deliberately as API
  symmetry; decide once per facade rather than re-litigating per audit.

### Justfile / devenv (commands with zero references)

- **Reverted — the finding's premise was wrong.** These four recipes (`just lint`, `just fmt`,
  `just studio-test`, `just studio-smoke-native`) were removed for having zero references, then
  restored on Ro's ruling: _"Many human invoked recipes should be composed, and invocable
  stand-alone trivially. The justfile should also do a good job at surfacing commonly useful dev
  options that would otherwise perhaps not be easily answered — e.g. `just` shows all recipes, and
  there should be a single just command that performs all fixing and gates, and then separate
  commands for many of the smaller parts."_ A human-facing command surface is discovered through
  `just --list`, not through code references, so "zero references" does not mean dead here. The
  `./agent fmt` passthrough was restored with them. **Apply this rule to the whole Justfile:** do not
  delete a public recipe for lack of callers; judge it by whether a human would want it.
- **Done** (Ro approved). Removed the unused devenv pins `oxlint`, `watchexec`, `jq`, `fd`, and
  `npm.enable` from `devenv.nix`. All five had zero repository references (the only `fd` match was a
  `logFile.fd` property; no `npm`/`npx` command is invoked anywhere). Re-evaluated afterwards:
  devenv still builds and `node`, `bun`, `just`, `dprint`, and `git` all resolve.
- `just bench` / `./agent bench` — **Ro decision** (Part 7): the regression policy already runs on
  every test pass via `performance-checks/language-performance.test.ts`; the module stays either way.

## Part 2 — Test surface

Census at audit time: ~1,626 package tests (validator 344, runtime TR 256, studio 188, dev 221,
parser 114, compiler 86, formatter 76, cli 48, others fewer) plus 17 Test Apps and the WordFlower
tiers. Wall-time note: the dominant cost of a full run is the single tao-apps gate, not individual
package tests — cut package tests for redundancy and maintenance load; cut app _folders_ for wall
time. No `.skip`/`.todo`/commented-out tests exist anywhere.

### 2.1 Test Apps: 17 → 10

Mechanics that make this safe: one folder may hold many `app` declarations and each `.test.tao`
picks its app with `run <Name>` (the WordFlower Harness pattern); the Revolution coverage matrix
never names a Test App (all rows prove through WordFlower), so coverage risk is nil provided each
journey keeps a home. Each merge lands atomically with its `Apps/Test Apps/README.md` rewrite.

| Target app                                    | Absorbs                                               | Must carry over                                                                                                                                                                                                                                                                                                                                                                                                                  | Effort |
| --------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **Language Core** (base: Functional Core MVP) | State Action MVP                                      | Compound `set` operators, `do` chaining, `action()`-typed view parameter, inline `on press -> { }` — one counter view + one test block                                                                                                                                                                                                                                                                                           | S      |
| **Navigation** (base: Navigation MVP)         | Basic Navigation, Sheet Presentation, Resizable Split | Four app declarations in one folder: native `@tao/nav` stack; explicit `@tao/nav/basic` kit with `command`/`Toolbar`/intent-`Title`; `as sheet`/`as overlay` + dismiss + cover/restore; `SplitNav` keyed panes + persisted width. The README currently mandates the MVP/Basic split — keeping them as separate app declarations preserves it. `Docs/Spec/Tao Studio.md` mentions the "Resizable Split test app" — one-line edit. | M      |
| **UI Rendering** (base: Layout and App Shell) | Runtime Stdlib Tests                                  | Migrate only `Image` (informative + decorative), `Spinner`, `Progress`, `Number`; the container smoke (Box/Col/Row/Stack/TextFrame/TextMultiline/WrappingRow) duplicates what Layout already renders with assertions — drop. Repoint the hardcoded path in `runtime-toolchain-tests/runtime.test.ts:7`. Drop the no-op "Tap me" press (subsumed by Native Components' Button contract).                                          | S      |
| **Packages** (base: Package Access)           | Component Aliases                                     | `use package @pkg [as name]`, pass-through alias view, shadow-avoidance — add an `@widgets` fixture beside `@cards`/`@copy` plus one aliasing view + test block. README scope rewrite required.                                                                                                                                                                                                                                  | S/M    |
| **Time** (base: Unit Values)                  | Ticking Clock                                         | Two views + two test files in one folder; the Unit-Values/Ticking-Clock distinction survives as separate files.                                                                                                                                                                                                                                                                                                                  | S      |

Keep as-is: **Data MVP** (externally pinned by `dev-command.test.ts`, `StudioNative.ts`, and
Coverage.md), **Forms and Interaction MVP**, **Type System Tests** (path pinned in
`runtime.test.ts:8`), **Native Components** (per-component conformance-contract format — do not
dilute), **Device Kit** (native-fake harness coupling).

**Status: four of five merges done — 17 folders → 11.** Language Core ← State Action MVP;
Navigation ← Basic Navigation + Sheet Presentation + Resizable Split; Packages ← Component Aliases;
Time ← Ticking Clock. At the merge commit all 17 `.test.tao` files were byte-identical to their pre-merge
versions and all 45 test blocks survived; the `relaunch` work has since added checks to two of them,
so the files now diverge as strict supersets; only folders and three colliding view names changed. One real blocker
surfaced: Package Access kept its `project { }` block **inline**, and a sibling app in the same
folder cannot see a project block that lives in another app's import closure — it moved to
`Packages/Project.tao`.

Resizable Split's persisted-width claim was **trimmed, not proved**: the Tao test-step grammar had no `resize` and no
`relaunch` step. `relaunch` has since shipped and the entry now claims the persisted width across
one; only the `resize` half still stands, and it remains Ro's call. The README now
claims only declaration, binding, and simultaneous pane rendering, and points resize at the adapter
and persisted-state round-tripping at `packages/runtime/TR-tests/`.

**Before doing the fifth merge (UI Rendering ← Runtime Stdlib Tests), note the plan undercounts the
pins.** It names only `runtime.test.ts:7`, but there are **four** hardcoded Test App paths in
`runtime-toolchain-tests/`, and one pins the _base_ app of that merge:
`app-shell-e2e.jest-test.tsx:18` → `Layout and App Shell/Layout and App Shell.tao`, which breaks the
moment that folder is renamed to `UI Rendering`. The others are `runtime.test.ts:7`,
`language-values-e2e.jest-test.tsx:16`, and `ui-stdlib-surface-e2e.jest-test.tsx:12`, all pointing at
`Runtime Stdlib Tests`. (`runtime.test.ts:8` → `Type System Tests` and `StudioNative.ts:590` →
`Data MVP` are keep-as-is and unaffected.)

### 2.2 Runtime TR-tests (~7,674 lines → roughly −780, no contract lost)

The duplication axis is the compiled-runtime jest e2e tier (19 files, ~5,000 lines) and the
studio-tests host side — not the small Tao journey files. Ordered steps, each independently
landable; every cut names its surviving proof (re-verify each before cutting):

1. **Cut outright duplicates** (S): `TR-persisted-state-and-depth.test.ts:211-221` (256-frame cap =
   `runtime-containment.jest-test.tsx:230`; then rename the file `TR-persisted-state.test.ts`);
   `TR-views.test.ts:245-255` (= `design-e2e`), `:316-341` image a11y (keep the empty-label throw),
   `:353-376` checkbox (three existing proofs; keep the disabled case), `:424-449` spinner/progress
   (keep NaN→0); `TR-selectable-loop.test.ts:22-59` (= WordFlower journey + `selectable-loops-e2e`;
   keep diagnostics laziness); `TR.test.ts:476` (= `navigation-e2e:817`) and `:529` (move `:518` to
   `runtime-package.test.ts`); `TR-data.test.ts:604-636` (covered by `:550` + Workspaces journey);
   `TR-navigation.test.ts:499` and `:850` (journeys + `navigation-e2e`).
2. **Trim partial duplicates to their unique halves** (S): `TR-data.test.ts:969` (keep strict-handle
   throw + rehydration; drop CRUD/cascade body), `TR-navigation.test.ts:304/:440/:459/:876`,
   `TR-design.test.ts:261` (keep the two throws).
3. **Merge small files** (S): `TR-scheme.test.ts` + the duplicated Scheme half of
   `TR-studio-environment.test.ts:265-308`; `TR-share` + `TR-clipboard` + `TR-haptic` →
   `TR-device-kit.test.ts` (they triplicate `asAction`/`value`/`isPromiseLike`);
   `TR-studio-state.test.ts` keeps only the codec-registry half (compose/conflict/validate lives in
   `studio-state-library.test.ts`).
4. **Parameterize** (S): the provider conformance pairs in `TR-data.test.ts:56/:69`; the nine
   one-assertion layout tests in `TR-adaptive-layout.test.ts`; the five resolve blocks in
   `TR.test.ts:194-232`; the four `thirdPartySelectionKind` variants in `TR-navigation.test.ts`;
   `TR-scheme.test.ts:5`; `TR-haptic:106`; fold `TR-data:220` into `:243`; split the eight
   `TR.testNavKind` calls into their own conformance test.
5. **Extract `TR-layout.test.ts`** from `TR.test.ts` + `TR-adaptive-layout.test.ts` (same
   `TR.Layout` matrix; retitle the "React Native maximum" test — it is TR's own lowering contract). M.
6. **Consolidate navigation files** (M): move the browser-history-flavored tests out of
   `TR-navigation.test.ts` into `TR-navigation-browser-history.test.ts`; delete one of the two
   near-identical fake history drivers (their `pop()` signatures differ — medium care); grow
   `TR-navigation-test-fixtures.ts` to own the currently-private `configuredSlot`/
   `configuredSelection`/harness helpers.
7. **Split `TR-data.test.ts`** (1,202 lines) at its existing `Describe` seams; do not merge it with
   `TR-data-fills` (different subjects). M.
8. **React-element-harness policy** — **Ro decision** (Part 7): a further ~200 lines in
   `TR-views.test.ts`/`TR-navigation-identity.test.ts` monkey-patch React and assert element trees
   or RN vendor choice (`type === 'ActivityIndicator'`); the RN-test-renderer e2e tier owns that
   level. Cut only with that policy adopted.

Also fix `Docs/Roadmap/Tao Revolution/Coverage.md`: the restoration row implies a Tao journey
proves it; name `TR-navigation-restoration.test.ts` in the test cell so a future pass doesn't cut
the file believing a journey covers it.

### 2.3 Studio tests (~7,664 lines → roughly −700–900, 4–5 fewer real compiles)

Land the fixtures module first — it turns manifest-shape changes from a ten-file edit into one:

1. **Extract `studio-tests/test-studio.ts`** (M, first): `previewManifest(overrides)` +
   cell/scenario/environment sub-builders (replaces ~10 hand-built `StudioPreviewManifestV2`
   fixtures and six `as unknown as` casts), `sourceActionEnvelope(overrides)` (replaces twelve
   ~20-line envelope literals in `studio-project-session.test.ts`), `withStudioSession`/
   `withCompiledPreview` (replaces four named harnesses plus the same scaffold pasted inline five
   times in `studio-preview-session.test.ts`), and the async helpers from 2.6.
2. **Delete the bundle/source string-grep assertions** (S): `studio-client.test.ts:89-200` (82
   `toContain` on UI copy/CSS) and `:621-653`; `studio-product-host.test.ts:66-123` (39 `toContain`
   on raw `.tao` source); `studio-folder-expansion.test.ts:9-19`; the four re-asserted bundle strings
   after the second client build in `dev-tests/studio-dev.test.ts:79-82`. Keep the real contracts:
   XSS escape, no-inline-sourcemap, React dedupe, module-input singleton, and the programmatic
   palette cross-check (`studio-product-host.test.ts:195-200`) — that last one is the pattern to
   spread.
3. **Merge `studio-edit-to-preview.test.ts` into `studio-preview-session.test.ts`** (M): three of
   four describes are supersets/subsets; keep "scenario startup reconciliation" intact.
4. **Delete `studio-client.test.ts:1116-1131`** (panel models — fully covered through the caller in
   `studio-panel-projection.test.ts`). S.
5. **Trim `studio-project-session.test.ts:992-1150`** to its session-only surface (stale-scenario,
   handshake capabilities, endpoint assertion, one thin delegation assertion); the matrix
   reconfigure/rebase/stale logic is `studio-matrix-session.test.ts`'s. M.
6. **Collapse `studio-server-datasource.test.ts:188-341`** (S/M): the 140-line fetch stub
   re-implements the endpoint and the assertions restate the mock. Keep revision-dedup, URL
   constancy, and one row-prefix assertion.
7. **Drop the generated-file greps from `studio-smoke/studio-real-app.test.ts:44-60`** (duplicate of
   `studio-preview-session.test.ts:41-51`; keep the real-HNReader-path bindings). S.
8. **Fix the vacuous smoke assertions** (S code): `studio-simulated-user.test.ts:143` asserts a
   selector that exists nowhere and passes forever; the `.cm-content` editing assertions target the
   _hidden_ legacy editor. Assert `data-tao-editor-mounted`/`data-tao-studio-client` and target the
   Tao-mounted editor. (The deeper issue — the smoke's hand-written preview stub re-implements the
   bridge protocol, so `TR-studio-preview.test.ts` is the only real-bridge proof — is an L-effort
   conversion; note it, don't schedule it.)
9. **Dedupe `positiveNumberDraft`/`studioNumericDraft`** (S, source change in `StudioInspector.ts` /
   `TaoStudioProductHost.tsx`) — two implementations of the same validator, tested separately.
10. **Split `studio-client.test.ts`** (1,912 lines, ~12 modules) along module lines; keep the
    release-bundle gates. S/M.

### 2.4 Language-pipeline tests (fixture noise, cross-layer duplication)

The layer boundaries are clean (see guardrail 1); the redundancy is at the fixture level:

- Move the two verbatim-duplicated app fixtures (`primitiveAppValueSpellings`, ~33 lines, and
  `promptTagsApp`, ~31 lines) from validator+compiler copies into `@shared/test` `TaoFixtures`. S.
- Replace the 11 hardcoded copies of Langium's linker sentence ("Could not resolve reference to X
  named 'Y'.") with one `unresolvedReference(type, name)` helper; where wording is incidental,
  assert `Diagnostics` source `'linker'` + substring (the `parser-diagnostics.test.ts:83-85`
  pattern). This decouples 11 tests in two packages from the pinned Langium version. S.
- Table-drive `validator-tests/host-read-slots.test.ts` — `missingHostTitle` is asserted by seven
  separate tests, each a distinct reachability path (~−120 lines, all paths kept as named cases). S.
  Same treatment for `configuration-sidecars.test.ts` (whole file is one table). Do **not**
  parameterize `structural-contracts.test.ts` — its 11 case tables are already the model.
- `compiler-tests/design.test.ts`: drop the re-asserted validator warnings (keep the release-mode
  gate) and give the two assertion-free `compileCode` calls real assertions or delete them. S.
- `compiler-tests/files.test.ts:177-311`: extract a `navConfigType` builder — one 4×-repeated
  `.d.ts` literal; assert module/declarations agreement once. S.
- Convert `formatter-tests/action-failures.test.ts` and `foreign-views.test.ts` to the `formats()`
  helper (they bypass it and thereby skip the free idempotence check). S.
- Fold the nine single-test formatter tranche files into the matching `formatter.test.ts` describes
  (merge, don't delete — each tests a distinct construct); this resolves the competing
  construct-vs-tranche file axes. M.
- Rename `frame-content.test.ts` in all four packages (feature is live; the `frame` name was retired
  by the unified-view tranche) to `content-and-slots.test.ts`; fix the stale `ui Home` comment in
  `files.test.ts:121`. S.
- Fix the self-fulfilling assertion in `studio-render-occurrences.test.ts:313-324` (expectation
  built from the same `$cstNode` offsets it verifies — pin one literal offset). S. This is a
  correctness gap, not redundancy.
- Move the `unusedImport` corner-case corpus to `ast-utils-tests` against
  `ASTUtils.referencedNames` directly (currently tested twice through two consumers while the
  shared detector has zero direct tests); keep one thin test per consumer. M.
- Adopt shared stubs: ~208 inline `render inject …` stub copies across parser/compiler/validator/
  formatter tests → `stubView()`/`stubContainer()` (validator-tests already adopted them); add
  `appWith(body, { views })` + a `standardViews` constant to `TaoFixtures` to collapse the nine
  near-identical validator `*App()` wrappers; delete the shadowed helpers in
  `package-namespaces.test.ts` and `frame-content.test.ts` (re-import from `test-validate`);
  de-duplicate `stubApp`/`valueDeclarationName`/`tsFence`/`fence` local copies. M, mechanical.
- Trim `lexer.test.ts` to the custom-token-builder coverage (mode switching, `TagOrHexColor`); fold
  the three token-name tests re-proved at AST level. S.

### 2.5 Dev/CLI tests (~−450 lines, ~15 tests, 1 file)

- Remove: `check-command.test.ts:66` and `test-command.test.ts:40` (hidden-directory rule already
  owned by `shared.test.ts` and `workspace.test.ts`); `check-command.test.ts:83` (asserts git's
  `--exclude-standard` semantics); `shared.test.ts:27` (dup of `:372`); `studio-dev.test.ts:102`
  ("Bun bundled something"); `studio-release-and-canary.test.ts:206` (a constant asserting its own
  contents).
- Merge: `check-command-cli.test.ts` into `check-command.test.ts` (keep the exit-code pair and
  summary-line assertion; note repo-lint forbids repeated describe titles across files, so merging
  is the safe direction); `expo-dev-loop.test.ts:135/:197/:209` into their neighbours; the three
  Justfile-introspection tests (`agent-worktree-profile.test.ts:386/:396`,
  `performance-checks/language-performance.test.ts:23`) into a `justRecipeIssues` rule in
  `repo-lint.ts` (repo policy belongs in the lint, and it replaces eight subprocess spawns).
- Slim: `studio-electrobun.test.ts:49-97` (drop `indexOf`-ordering and `not.toContain` source
  snapshots; the build-success, copy-mapping, `allow:false`, and origin assertions stay);
  `runtime-toolchain-tests/runtime.test.ts:127-149` (drop the ~30-item `toContain` string list;
  keep the type-check and revision assertions); `ide-extension.test.ts` (reduce the seven tests
  duplicating validator/formatter/source-actions package suites to wiring smoke tests);
  `studio-watch-health.test.ts:104-108` (exact overlap list → upper bound);
  `repo-lint.test.ts` WordFlower permutations 11 → ~6; `studio-dev.test.ts:42` real-process
  escalation → fake (keep `expo-dev-loop.test.ts:70` real — process-group reaping can't be faked).

### 2.6 Test-harness consolidation

The pattern: packages with a `test-*.ts` helper module (parser, validator, compiler, formatter —
compiler's 14-line `test-compile.ts` is the model) have almost no duplication; the three largest
test bodies without one (studio, TR-tests, dev-tests) account for nearly all of it.

- Add to `@shared/test`: `Deferred<T>()` (**5 definitions confirmed**, as originally audited —
  `TR-data-fills.test.ts:41-43`, `TR-data.test.ts:1141`, `studio-client.test.ts:1823`,
  `studio-compile-coordinator.test.ts:273`, `studio-session-manager.test.ts:275`; an earlier
  "only 2" correction in this document was wrong, having searched `packages/runtime` alone),
  `settle()` + `until(predicate)` built on
  `Time.sleep` — re-measured as **11 definitions under 7 names plus 2 inline, 36 call sites**, with
  three wall-clock budgets (1,000 / 5,000 / 20,000 ms) and two turn-count budgets. **All of these
  helpers are now built** in `TestAsync.ts`, `TestTerminal.ts`, `TestReactNative.ts`, and `Test.ts`:
  `Deferred`, `settle`, `until`, `fakeTerminal`, `withCapturedOutput`, `MockModule`,
  `reactNativeStubs`, and `setClockForTest`. `shared-tests/TestRuntime.ts` is deleted.
  `until` defaults to a 2,000 ms budget — above the largest ordinary wait in the tree and below both
  runners' 5,000 ms per-test timeout, so a stuck wait reports its own description instead of being
  killed anonymously. `MockModule` uses `jest.mock(…, { virtual: true })` on the Jest side; without
  `virtual` Jest rejects specifiers that Bun registers happily.

  **Adoption is the remaining work, and belongs to the Phase 4 test passes** (call sites are listed
  per package in the harness handoff): 5 `Deferred` definitions + 20 calls, 11 wait helpers + 36
  calls, and 3 `fakeTerminal` sites in tao-cli, which own the three remaining direct `node:stream`
  imports. When `TR-selectable-loop.test.ts` and `TR-views.test.ts` adopt `MockModule` +
  `reactNativeStubs`, their two entries in repo-lint's `BUN_TEST_IMPORT_ALLOWLIST` **must** be
  dropped in the same change — repo-lint reports a scanned-but-clean allowlist entry as stale and
  will fail until they are.

  Corrections: `setClockForTest` has **one** adopter, not two (`TR-data.test.ts:246-261`); the other
  two candidates use an injected clock and `jest.useFakeTimers()`. The parse-clean primitive
  **cannot** live in `@shared/test` — `tao-parser` depends on `tao-shared`, so importing `@parser`
  there inverts the dependency; its home is a parser-owned `@parser/test` entry, which makes it Part
  5.6 deep-import work. Note `parseClean` is a _weaker_ assertion than `testParseCode` (diagnostics
  only, not lexer/parser errors), so adopting the real one may surface new failures.
  Also: `packages/runtime` src imports nothing from `@shared`, but **`TR-tests/` already does**, so
  every helper above is adoptable there.
- Create `TR-tests/test-tr.ts` (action/value doubles), `dev-tests/test-dev.ts`
  (`fakeStartedCommand` unifying the near-identical process fakes in `studio-dev`/
  `studio-smoke-launch`/`worker-session`; generic `findCheck`), and `studio-tests/test-studio.ts`
  (2.3 item 1).
- **Done.** Runtime-owned: `memoryKeyValueStorage()` and `memoryDataProvider()` now sit next to
  `testDataConnection` in `TR-data-provider.ts`. Re-measured census: **7 in-memory key-value
  storages** (5 runtime, 1 stdlib, 1 runtime-toolchain) and **4 in-memory data providers**, plus 6
  look-alikes that are deliberately not memory. The diverging semantics were real and load-bearing:
  `TR-navigation-restoration.ts:209` branches on whether `storage.removeItem` exists, and the
  runtime test copies omit it _on purpose_ to exercise the absent branch — so the shared helper
  omits `removeItem` too, and says why. Naive unification would have silently stopped testing that
  branch. The stdlib and runtime-toolchain copies genuinely need `removeItem` and were left alone.
- Mechanical: replace ~20 longhand `FS.mkTmpDir(FS.resolvePath(prefix, FS.tmpdir()))` sites with
  `mkTestDir` (not the runtime-toolchain ones rooted under `executableRoot`); replace the four raw
  `setTimeout` waits with `Time.sleep`-based helpers.

## Part 3 — Production structure

### 3.1 Studio package

- **One session-protocol module** (M, highest leverage): the handshake/event/source-action DTOs are
  declared twice (server `StudioProjectSession.ts` vs client `StudioApiClient.ts`) with six
  exact-name collisions — and the client's event union silently drops the server's
  `checkpoint-changed` and `data-invalidated` events, leaving a shadow undo stack that can drift
  from the server's checkpoint ledger. Move the DTOs into `StudioProtocol.ts` and import from both
  sides; wiring the two dropped events into the client is a behavior fix that needs a test.
- **One route table** (M): 27+ `/api/...` routes are written literally in three or four files each,
  matched independently on both sides of the wire (typo fails only at runtime). Generalize the
  contract-object pattern `TaoStudioServerActions.ts` already uses; unify the duplicate
  `GET /studio.js` handling.
- **One transport helper** (M): session-path regex ×3, ws/wss upgrader ×2, JSON-POST-unwrap ×5.
  Also single-source the session-id grammar `/^[A-Za-z0-9_-]{1,128}$/` (three independent copies).
- **One guard module** (S/M): `isRecord` ×6 in studio alone, JSON guards ×6 pairs,
  `nonNegativeInteger` ×5, byte-identical `cellIdentity` ×2, five independent cell-environment
  validators. Coordinate with the shared `isRecord` in Part 5 — the copies disagree about arrays,
  which is a latent bug class.
- **Split the god files** (after the removals land, so dead branches aren't ported):
  `client/StudioApp.ts` `mountStudio` (1,690-line closure, 28 mutable slots — L),
  `TaoStudioProductHost.tsx` (2,125 lines — M), `StudioProjectSession.ts` (1,759 lines: extract
  checkpoint ledger, file CRUD/drafts, app discovery — M/L).
- **Magical strings**: `'reactive-browser'` ×11, `'fixed-light-native'` ×12, scenario panel commands
  declared/re-matched/emitted in three places, the 10-class DOM portal contract in three places,
  duplicated viewport-preset and injected-failure tables — fold into the protocol/route/guard
  modules above.
- **Packaged-build gap** (M): `StudioHighlight.ts` reads the ide-extension's generated TextMate
  grammar by repository path; nothing stages it into the packaged payload, so
  `/api/language/highlight` likely degrades silently in a packaged build. Stage it or move the
  generated grammar somewhere both packages own; verify once on a real packaged build.
- Rename note: `StudioServerDataProvider.ts` (client side) vs `StudioServerDatasource.ts` (server
  side) is a naming asymmetry, not duplication — rename at most.

### 3.2 Runtime — the TR cleanup pass, made concrete

Ordered; each step independently landable. (Steps 1–2 are Part 1's removals + the `TR.Errors`
decision.)

3. Extract from `TR.ts` (1,190 lines): the runtime value classes (~250 lines → `TR-values.ts`) and
   the subject-case matcher (~90 lines → the data module it interrogates); dedupe `isPromiseLike`
   (defined in both `TR.ts` and `TR-action-transactions.ts`). M.
4. **Partly done.** `TR.Errors` now _is_ `ErrorControls`, exported by `TR-errors.ts` (see Part 7
   item 1). `TR.Capture` and `TR.Persisted` are still assembled ad-hoc inside `TR.ts` from free
   imports — have `TR-runtime-capture.ts` and `TR-persisted-state.ts` export their own Controls
   objects the same way. S. Note `TR-error-containment.tsx` keeps its surface on `TR.Capture`
   deliberately: `runtime-toolchain` tests bind to `TR.Capture.onFailure` and
   `TR.Capture.recoveryBackup`.
5. Rename the `'legacy-style'` design-spec kind to `'bundle'` across compiler/runtime/tests —
   bundles are decided current language; the name misleads. S.
6. `@runtime/TR-studio` subpath split — **Ro decision** (Part 7): today every production app bundles
   ~2,400 lines of Studio/dev-menu runtime because `TR.ts` statically imports them. An emit-gated
   subpath keeps production bundles lean, but it needs a compiler emit change — schedule with a
   language tranche, not this cleanup.
7. Have `TR-studio-preview.test.ts` import `TaoStudioProtocolVersions` instead of repeating
   `'tao-studio'` nine times. S.

### 3.3 Runtime-toolchain

- **Done — the biggest environment win.** A new `testing/test-run-root.ts` owns every generated run
  root under `_gen_tao-app-test/<category>/run-<epochMs>-<random>/`: `tao test` discards its root on
  a passing suite, keeps the newest failed root per category to debug against
  (`RETAINED_RUN_ROOTS = 1`), and prunes older roots once per process at harness startup. Roots
  younger than `ACTIVE_RUN_GRACE_MS` (1 hour) are left alone because a run id embeds its creation
  time and a young root may belong to a live concurrent suite; nothing outside a run root can be
  removed. `compile-app.tsx` and the test-plan worker now share one root per harness process instead
  of writing one top-level directory per render, which was the actual growth mechanism. `just clean`
  now covers the directory. Measured on the real tree: **4,307 files / 23 MB → 125 files / 608 KB**
  (the audit's 16,518-file figure had already changed). Correction to the finding: the repo tree
  genuinely had zero deleters — `StudioNative.ts:602` resolves against a _packaged payload_ root,
  not the checkout.
- **Split `runtime.ts`** (548 lines: ~350 are Studio-preview publication mechanics around a
  ~100-line generator) into an app-generation core + `studio-preview-generation.ts`; rename the
  misleading `Runtime`/`runtime.ts` (the actual runtime is the sibling package) to
  `AppGeneration`/`app-generation.ts`. M.
- **Extract the 175-line inline TSX bootstrap template** (`stablePreviewRootSource()`) into a real
  type-checked `.tsx` asset copied at generation time — today it is `any`-typed string code
  invisibly coupled to the `TR.Studio.*` API. Interpolate `TaoStudioProtocolVersions` instead of the
  hardcoded channel/version literals (a protocol bump would silently miss the generated string). M.
- Preview "compatibility copies" double every generated file write; only the revision copies join
  the live import chain — **Ro decision** (Part 7): drop the inspectability copies?
- Metro `@shared/core` alias + watch folder: plausibly dead in the Metro path (only Jest-mapped
  consumers). Verify with one Metro bundle run, then delete the alias and its test assertion — or
  document it as the blessed sidecar seam. S, medium risk.
- Settle the three coexisting test-suffix conventions (`.test.ts`, `.jest-test.tsx`, `.jest.tsx`)
  with one naming decision + comment. S.
- Adopt the migration rule for the jest e2e tier: a jest e2e test stays only if it needs a
  native/module override, asserts generated-code shape, or exercises the harness itself; otherwise
  new coverage lands in Tao and existing suites migrate opportunistically when touched. **Ro
  decision** (Part 7) to adopt; do not schedule a wholesale rewrite.

### 3.4 Compiler / parser / validator / formatter / source-actions

- Parameterize the three near-identical service-assembly forks (parser core/LSP, workspace core/LSP,
  validator session) so a new service registers in one place per layer instead of 3–5. S–M.
- One named constant for the `'/__tao__'` magic string (four copies across three packages). S.
- Replace the `RuntimeGen` pass-through wrapper with a single `renderToString` helper; call
  `Compile.*` directly (its duplicated method names make greps ambiguous). S.
- Merge the validator infra name-soup (`validation.ts` + `node-validation.ts` + `diagnostics.ts` —
  one concept in three near-synonym modules); inline `configuration-type.ts` (15 lines, one
  consumer). S each. The `type-system.ts` + `TypeSystemHelpers.ts` merge is **moot** — both files were
  deleted with Typir (Part 7 item 4).
- Rename `compiler-src/tests-compiler.ts` → `test-plan-compiler.ts` (two modules named
  `tests-compiler.ts` in one package). S.
- Split `source-actions-src/studio-actions.ts` (1,902 lines, 75% of the package) into
  `studio-contract.ts` + 3–4 concern modules; replace the double hand-written re-export block in
  the entry with grouped exports. M.
- Extract `sidecar-graph.ts` (the hand-written JS/TS import scanner) and `output-paths.ts` from
  `compiler.ts` (1,091 lines, four concerns). M.
- Flatten the Typir round-trip indirection: `ActionsValidator`/`StateValidator` register checks into
  the Typir collector only for `ExpressionsValidator` to drain them back into `ctx.error` — convert
  to plain node checks calling `ctx.typir` directly; keep the drain only for Typir-internal
  problems. M; verify diagnostic text/order parity against the validator suites.
- Split `parser-src/ast-structure.ts` (1,002 lines, ~10 feature areas) on feature seams inside the
  parser now; fold the deeper question (≈40 of its exports are semantic helpers consumed only
  downstream — the ownership rule says they belong in `@ast-utils`) into the Part 5 export sweep.
- Move the two whole-document formatter post-passes (`collapseClosingBraces`,
  `reindentInjectionFences`) out of per-node formatter modules into `formatting.ts`. S.
- Optional: a one-line dev assertion that the spread-merged dispatch hubs (`Compile.ts`,
  `Format.ts`) lost no keys — a duplicate handler name currently last-write-wins silently. S.
- When next touched (not scheduled): split the R3-oversize files `navigation-validator.ts` (774),
  `design-validator.ts` (649), `configured-item-validator.ts` (483), `types-validator.ts` (459),
  `ast-utils` `Type.ts` (1,314), `expressions-compiler.ts` (822).
- `generation` package: keep separate from compiler (the compiler dependency is type-only; its real
  consumers are studio and dev — it is an AI-service package, not a pipeline stage). Document its
  role in `packages/AGENTS.md`; optionally rename (Part 7 note). Fix its direct `node:crypto`
  import to go through a `Platform` wrapper. S. The same sweep should cover the other direct
  `node:crypto` importers, which share the gap because no shared hash/uuid helper exists yet:
  `dev-src/studio/StudioNative.ts` and `dev-src/repository-tests/ParserGenerate.ts`.

### 3.5 tao-cli

- Fold the seven copies of the catch/format/exit block into one `runCliCommand(fn)` wrapper (one
  copy inconsistently uses `setExitCode`). S.
- `dev-app-discovery.ts` re-implements `Runtime.appNames` — call it. S.
- **Reframed, and needs Ro's call.** The finding said `dev-app-selection.ts` "bypasses
  `HCI.askChoice`". It does not, and cannot: `askChoice` is readline/line-based (needs Enter),
  returns a `ValueT extends string`, and loops until a valid answer. The selector resolves on a
  single keypress, returns a three-way `{cancel} | {exit, exitCode} | {selected, app}`, keys
  `1-9` then `A-Z` **skipping `Q`** (reserved for quit), offers Esc-cancel and Ctrl-C with exit code
  130, and carries `TaoDevApp` objects grouped by project.
  `cli-tests/dev-command.test.ts:79-103` pins its prompt text and repaints. Forcing `askChoice` on
  it would be a regression. **The real duplication is raw-key input**, not prompting:
  `dev-app-selection.ts:135-181` (`withRawChoiceInput`/`readChoiceKey`/`setCustomInputRawMode`) and
  `dev-src/expo-dev-loop/keyboard-input/RawKeyInput.ts` each implement raw-mode enable → `resume` →
  `on('data')` → `pause`, with the same "a resumed stdin keeps the process alive" hazard commented
  in both. The right unification is a shared raw-key primitive in `HCI`/`Platform` — note
  `dev-app-selection.ts` also supports a non-stdin `Readable` for tests that `RawKeyInput` does not.
  **Ro's call, made and DONE: do it the right, clean way.** `HCI.startRawKeys` / `HCI.withRawKeys`
  now own raw-mode enable and restore, `resume`/`pause` with the process-stays-alive hazard, listener
  lifecycle, and chunk-to-key decoding. `RawKeyInput.ts` is deleted; the selector lost
  `withRawChoiceInput`, `readChoiceKey`, and `setCustomInputRawMode` (182 → 132 lines).
  `Platform.setStdinRawMode` generalized to `setInputRawMode(input, rawMode)`, which removed the
  selector's stdin-versus-custom branching.

  **Honest shape: one shared core, two entry points** — not a single unified call. The consumers
  differ in delivery mode, and forcing one would have been the false unification: the dev loop is
  _push_ with an open-ended lifetime and must know whether raw mode actually engaged (to log "No
  interactive TTY found"), while the selector is _pull_ and scoped. `withRawKeys` is a thin adapter
  over `startRawKeys`; nothing is hand-rolled in either package now.

  All five must-keep behaviors are preserved with tests: non-stdin `Readable`, Esc-cancel, Ctrl-C →
  130, single-keypress three-way result, and the `1-9` then `A-Z`-skipping-`Q` sequence. The tests
  were **mutation-tested** — breaking the escape collapse, the end→interrupt rule, and the `pause()`
  each produced real failures.

  **A live bug fell out:** the old `RawKeyInput` dispatched every character of a chunk, so `Alt-r`
  (`ESC r`) fired the dev loop's _recompile_ command. An escape-prefixed chunk now collapses to one
  Escape, which no command matches. `HCI.RawKey.escape` / `RawKey.interrupt` also mean no source or
  test spells a raw control-character escape any more.
- `cli-tests/test-cli-files.ts` `withTaoFixture` duplicates `@shared/test` `withTaoFiles` (all
  seven cli test files use the local copy). S.
- The commander bootstrap duplicates `dev-src/cli/run-with-commands.ts` — add an argv parameter
  there and share. S.
- `in-place-files.ts:87-104` re-implements package-root resolution owned by `ast-utils`
  `Packages.ts`. S.
- `project-command.ts:83-85` bypasses the shared discovery excludes, so `tao project id` walks
  `node_modules` unlike every other path — use the shared Tao-file discovery (with 3.6's
  `TaoFiles.findUnder`). S, real behavior wart.

### 3.6 Shared additions

- `TaoFiles.findUnder(root)` — the three-line discovery idiom repeats at six call sites across four
  packages; `TaoFiles.ts` already owns the exclude list. S.
- `isRecord`/record guards in `@shared/core` (11 definitions repo-wide with diverging array
  semantics; runtime keeps one TR-internal copy since it imports nothing from `@shared`). S.
- `Diagnostic.formatLocation` — five hand-rolled 1-based location renderings while `Diagnostics.ts`
  only formats 0-based machine keys. S.
- `Type.isAssignableOrUnresolved(actual, expected)` — collapses the triple unresolved-guard
  recurring ~6× in the validator. S.
- Shared env-key constants for the `TAO_TEST_*` cross-package contract (set in tao-cli, read in
  runtime-toolchain, raw strings in six files). S.
- Fold the small duplicate helpers: `escapeRegExp` (test-runner copy of `Text.escapeRegExp`),
  indent helpers (three variants; `Text.indentLines` exists), `chunk` (×2),
  `OutputText.formatElapsed` ≡ `GateRunner.formatMilliseconds`. S.
- Rename `Switch_TypeSafe.ts` → `Switch.ts` (the repo's only underscore filename, and its export is
  `Switch`); fix the two test-file naming stragglers (`typecheck_test.ts`, the lone `.jest.tsx`). S.
  `typecheck_test.ts` is not merely cosmetic: it is a compile-only fixture of `declare const`s, but
  Bun's default matcher treats `*_test.ts` as a suite and executes it, so a hand-run
  `bun test packages/shared/shared-tests` dies with `ReferenceError: maybeText is not defined`. The
  repository's own runner only collects `*.test.ts`, which is why no gate catches it. Rename it out
  of Bun's glob (e.g. `typecheck.fixture.ts`), or add a `bunfig.toml` narrowing the test glob.

## Part 4 — Developer environment and command surface

There is no CI — every gate is local; "used" means referenced by docs, skills, tests, or tooling.
The generated claude/codex config chain is single-sourced and drift-proof (parity tests fail verify
on drift) — no work needed there.

### 4.1 Command surface

- **Thin `./agent` to zsh + `exec just`** (M, biggest single win): the TypeScript layer
  (`agent-dev.ts`, `agent-help.ts`, the build-stamp/lock half of the wrapper — ~230 lines plus a
  106 KB build artifact) exists only to restrict to eight subcommands and print filtered help, but
  permissions already allow `just *`, so it enforces nothing. Replace with a zsh allowlist array and
  a grep-filtered `just --list` help. This removes a process hop from every agent command and makes
  `./agent help` work without a successful install/build (which currently fails in fresh sandboxed
  worktrees). Keep: the devenv-profile activation, install stamp/lock/retry, and scratch pruning in
  `agent-worktree-profile.zsh` — they solve real observed failures and are well-tested. Update the
  dev-automation skill and the bootstrap tests in the same change.
- **Revised by Ro — do NOT collapse the three command surfaces.** The original finding proposed one
  canonical spelling per outcome and deleting the Just recipes that duplicate `./dev` and `./tao`.
  Ro's ruling keeps all three, each with a distinct job:
  - **`./tao`** — a pass-through to the intended _published_ CLI. It must give developers who prefer
    their own editor over Studio an excellent dev experience; this is product surface, not internal
    tooling.
  - **`Justfile`** — the human-facing surface for common repeated tasks, discovered via
    `just --list`. Recipes should be composed and each part invocable stand-alone: one recipe that
    runs all fixing and gates, plus separate recipes for the smaller parts.
  - **`./dev`** — common repeated tasks and capabilities better expressed in TypeScript than in a
    Just recipe.

  So the remaining 4.1 work is to make the Just recipes _thin, well-named passthroughs_ to `./dev`
  and `./tao` with good `just --list` descriptions — not to delete them. `packages/studio/README.md`
  should document that layering rather than a single spelling. The `./agent`
  thinning below is unaffected: `./agent` is the agent-facing wrapper, not a human surface.
- **Done.** Moved `scripts/generate-agent-config.ts` into `./dev agent-config` (Just `_agent-config`
  / `setup` call it) and deleted `scripts/`.
- **`.cursor/permissions.json` is the one hand-maintained copy of the permission policy** with no
  parity test — the only place the permission story can silently drift. **This has now happened.**
  `main`'s `91bef867` ("Permissions update") added `git fetch *` / `git ls-remote *` allow rules and
  sandbox exclusions for `git fetch`/`push`/`ls-remote`/`worktree` to `.rulesync/permissions.jsonc`
  and its generated `.claude/settings.json`; `.cursor/permissions.json` was untouched and `verify`
  stayed green. Confirmed cause: `AgentConfigGenerator.ts` targets only `claudecode` and `codexcli`,
  so `.cursor/permissions.json` and `.vscode/settings.json` are neither generated nor parity-tested.
  Sharpened remedy: a straight CursorConfigGenerator is probably the **wrong** shape, because the
  Cursor file is not a rendering of the same model — it is a literal `terminalAllowlist` plus
  natural-language `allow_instructions`/`block_instructions`, and its git entries stop at
  `status`/`diff`/`log`/`show`, reflecting neither the new fetch rules nor the pre-existing
  `git merge *`. Prefer a **semantic** parity check that maps rulesync rules onto the Cursor
  vocabulary and fails when a rule has no counterpart, so a divergence must be declared deliberate
  rather than merely happening. Follow the agent-instructions skill for ownership.

### 4.2 Gates

- **Done — stamped, not recipe-dropped.** `ParserGenerate.ts` now hashes `langium-config.json`,
  every grammar file, and the `langium-cli` version, records the outputs it wrote, and skips Langium
  when both still hold. Recipe-dropping was rejected: `_ide-extension-build` is also reached
  standalone through `_ide-extension-package` / `install-ide-extension`, which would then build
  against a stale parser. Redundant runs went from ~0.74s to ~0.01s, and `_ide-extension-build` in
  `verify` from ~1.8s to ~0.2s. The stamp lives in `.artifacts`, **not** in the generated parser
  directory: Langium deletes and recreates that directory each run and stops to prompt on stdin
  about files it did not write, which would hang every gate silently.
- **Done.** Dropped `_dependency-check` from both lanes: `dependency-compatibility.test.ts` runs
  `readDependencyFacts()` against the real checkout inside the dev suite — the exact gate condition,
  and it asserts the facts are non-empty so a partially installed tree cannot short-circuit it. The
  module stays (the doctor consumes it); the now-unreferenced recipe was removed with it.
- `_runtime-pack-check` in every `check` and `verify` is release-readiness validation in the daily
  lane — **Ro decision** (Part 7): demote to verify-only or a release lane.
- **Done.** `verify`'s `_tao-check` skip reason now states what actually holds — `fix` ran
  `./tao fix` over the tree and the tao-apps suite compiles it — instead of "covered by check",
  which nothing guaranteed.
- Oversubscription (gate jobs × `_test`'s internal scheduler × `tsc --build`) is structural but
  unmeasured — act only with timing evidence; the cheap option is capping gate jobs. Consider
  having `verify` append a one-line per-gate timing history so future gate-cost questions have data.
- **Done.** The test-runner summary now says when a test-name pattern skipped the tao-apps suite.
  Threaded through `printResultSummary` so both run paths report it — the interleaved lines mode and
  the TUI.

### 4.3 Repository health checks

- **Done, in repo-lint rather than the doctor** — repo-lint runs in the `check` and `verify` gates,
  so a regression fails at commit time, which is the point; the doctor is a diagnostic nothing gates
  on. All four conventions are enforced with narrow, commented allowlists: 3 native switches (all
  studio `kind` dispatches), 3 `bun:test` importers (`Test-Bun.ts` plus the two closed by 2.6's
  `MockModule`), zero `langium` imports outside the parser (clean state asserted), and the two
  cross-package `-src/` escapes named in 5.6. An allowlisted file that no longer violates is itself
  reported, so exemptions get cleaned up when the underlying work lands. The scan now walks `.tsx`
  as well as `.ts`, since one real violation lives in a `.jest-test.tsx`; the duplicate-describe rule
  still sees only `.test.ts`.
- **Done** (Ro approved the dependency). `just dead-exports` runs `knip` through
  `DeadExports.ts`, which removes the findings this repo's own conventions explain. `ts-prune` was
  rejected: it is archived and its own README points at knip. Three structural blind spots were
  found, not one, and each is answered by restoring the missing import edge rather than muting a
  rule: **`.tao` foreign bindings** (five grammar forms, read from `parser-grammar/*.langium`, matched
  on _file and symbol_ — a name-only filter would have hidden Part 1's genuinely dead `CreateFile`,
  since a live `CreateFile` is bound one file away); **namespace facades** (`shared.ts` re-exports
  `import * as FS`, which knip cannot follow through, so 83 live `@shared` members looked dead); and
  **`import('./M').Name` type queries**, which is how `@ast-utils` republishes types.

  Funnel: 318 raw → 232 after the `.tao` filter → 163 after facades → **154** after type queries,
  with **zero ignore entries added** and a measured false-positive rate of 0 on the survivors. Of
  those, 9 are referenced nowhere at all and 145 are used only inside their own module — the
  "de-export, keep the code" category. Notably the 15+ `*ValidationMessages` objects were a _config_
  problem, not false positives: configuring validator test files as entries removes them all.

  It is deliberately **non-gating** — a report, exiting 0 on findings and 1 only when the scanner
  goes stale against a binding form it cannot read. Promote it into `check` once the survivors are
  triaged. It cannot answer Part 7 item 12, because it counts test-only usage as usage.
- Worktree bootstrap: pre-warm `.artifacts/build/agent-dev` (or make help not need it — falls out of
  the `./agent` thinning) so fresh sandboxed agent worktrees don't hit the known
  `bun install` `.idea`/`.gitmodules` copy denial; teach `just doctor` to detect a broken
  `.devenv/bootstrap` evaluation. S/M. **Now evidenced, and worth raising in priority:** every agent
  in this execution independently lost round-trips to the same failure — under the Bash sandbox,
  `direnv exec .` (the spelling `AGENTS.md` prescribes) re-evaluates the devenv lock through
  `.devenv/bootstrap/resolve-lock.nix` and needs the nix daemon socket, which the sandbox denies.
  It surfaces as `cannot connect to socket at '/nix/var/nix/daemon-socket/socket'` or, more
  confusingly, `Failed to get attribute 'config.cachix.enable'`. The working spelling is
  `export PATH="$PWD/.devenv/profile/bin:$PATH"`. Either make the bootstrap reuse an existing
  `.devenv/profile` instead of re-resolving, or document the sandboxed spelling in `AGENTS.md`.

## Part 5 — Conventions (ranked by cognitive-load payoff)

Behavioral conventions are in excellent shape (3 native switches repo-wide, 2 direct `bun:test`
imports, zero Langium leaks, zero barrel leakage). The debt is in the export/naming layer:

1. **Named-const export sweep + rename modules to match their main export** (L, one commit per
   package). Three generations coexist: anonymous `export default {}` (26 files — 17 formatter,
   9 compiler codegen — the worst for grep-ability), named const in a kebab file, and the target
   form (named const in a matching Pascal file, which all the newest code uses). 131 named-const
   namespace exports, 61 files whose basename ≠ main export. Target: `export const Foo = {...}` in
   `Foo.ts`; package entries keep the established `const X` + `namespace X { export type … }` +
   `export default X` merge — the code has already answered the roadmap's namespace question, so
   bless that merge for entries and plain named-const internally, and write both into
   `packages/AGENTS.md`. The anonymous-default rewrite (26 files) is the highest-value slice and can
   land alone (S). This sweep also settles the per-package file-casing splits and the
   `NavigationCompiler.ts`-vs-`navigation-validator.ts` cross-stage inconsistency; pick one slice
   vocabulary while there (`use-*` files vs `imports.langium`).
2. **Flip `ValidationContext.error(message, node)` → `(node, message)`** (M, mechanical): 455
   uniform call sites, all factory-produced messages — regex-able. Land before or with the sweep's
   validator slice. Codify the message-factory discipline (28 `*ValidationMessages` objects — the
   best diagnostics pattern in the repo) in `packages/AGENTS.md` while touching it.
3. **Studio route/protocol constants** — Part 3.1; the only magical-string cluster with real
   breakage potential.
4. **Shared guards** — Part 3.6 (`isRecord` copies disagree about arrays today).
5. **Platform-wrapper tail** (S): fix `Bun.sleep`→`Time.sleep` (×3), `Bun.randomUUIDv7`,
   `Bun.semver`, `Bun.TOML`, scattered `process.env` where `Platform.runtimeProcess` exists,
   `FS.existsSync` and `console.*`→`HCI` in studio; then add one line to `packages/AGENTS.md`
   naming Bun server/bundler APIs (`Bun.serve`/`build`/`resolveSync`) as a sanctioned exception in
   dev/studio so audits stop re-litigating them.
6. **Deep-import cleanup** (S, opportunistic): the enumerable list — `@validator/diagnostic-codes`
   and friends, `@runtime-toolchain/testing/runtime-testing`, ~10 `@runtime/TR-*` deep specifiers,
   and **two** relative escapes, not one: `StudioPackagedTestCommand.ts` →
   `../../../tao-cli/cli-src/test-command`, and `runtime-toolchain-tests/studio-scenario-e2e.jest-test.tsx:9`
   → `../../runtime/TaoRuntime-src/TR-studio-environment` (only two levels up, so a `../../../` grep
   misses it). Both are allowlisted in repo-lint's `crossPackageSourceImportIssues`, which reports a
   stale entry once the import is promoted. Adjacent, not yet gated because it is not a `-src/`
   escape: `runtime-toolchain-tests/data-e2e.jest-test.tsx:7-8` reaches into
   `packages/stdlib/@tao/data/providers/…`. Promote into public entries or document.
7. **Grouped-helpers pass**: the real "focused module surface" violations are the big Studio/TR
   surfaces (`TaoStudioProductHost.tsx` at 91 exported bindings, `TR-data-registry.ts` at 17) —
   fold into the Part 3 splits rather than a repo-wide sweep.
8. **Error-handling redesign** (L, Ro-commissioned — **supersedes** the earlier "convert raw throws
   opportunistically in studio/dev only; runtime's raw throws are its own sanctioned convention").
   Ro's ruling: _"Assertions should always use the shared Assert functions. If categories are needed
   for asserts, then implement that on top of the Assert API. The assert functions should definitely
   be throwing typed errors. We shouldn't ever have raw `throw Error` anywhere in the codebase,
   unless there's a specific good reason."_

   **Scope: 445 raw `throw new Error(` at the audit commit, ~383 in source** — runtime 184, studio 98, dev 32,
   runtime-toolchain 29, generation 10, stdlib 8, compiler 8, shared 7, parser 5, source-actions 2.

   **This is adoption and enforcement, not invention.** The taxonomy already exists and is good:
   `core/Errors.ts` has `BaseTaoError` (carrying `details`, `cause`, `messageForUser`) with
   `UserInputError`, `UnexpectedBehaviorError`, and `CommandExecutionError`, plus `isTaoError`,
   `fromUnknown`, `throwUserInput`, `throwUnexpected`, `formatForUser`, `formatForLog`; and
   `core/Assert.ts` already throws typed `UnexpectedBehaviorError` from `Assert`, `Assert.defined`,
   `Assert.is`, and `Assert.never`. The work is:
   1. Close the gaps — a category for host/environment failure, and category support on top of the
      Assert API where a precondition is the _user's_ fault rather than an invariant.
   2. Add a **ratchet** to repo-lint: `throw new Error(` is banned, with a per-file allowlist seeded
      with today's offenders. Because repo-lint reports a stale allowlist entry, each swept file must
      drop its entry — the ratchet tightens on its own and cannot silently loosen.
   3. Give `packages/runtime` a **runtime-owned `Assert`** in `TR-errors.ts`. It imports nothing from
      `@shared` by design and has no `Assert` today, so this is the same sanctioned duplication as
      `TR-switch.ts` duplicating the shared `Switch`.
   4. Sweep package by package, classifying each throw: invariant → `Assert(...)`; the user's
      mistake → `Errors.throwUserInput(...)`; host/environment → the new category. Each conversion is
      a judgment about what the user should see, which is the real work — the mechanical part is
      trivial.

   The payoff is Ro's stated goal: a Tao developer should never meet a bare JavaScript error string
   from the runtime, and should always be able to tell _whose_ mistake an error reports.

   **Progress and what the sweeps taught.** `shared`, `runtime`, `studio`, and the pipeline tail
   (compiler, parser, generation, stdlib, source-actions) are done; `dev` and `runtime-toolchain`
   were in flight when this was written.

   - **The classification skews to the author, not the invariant.** 162 of 184 runtime throws were
     the author's fault, the inverse of the expectation, because the runtime's throws already carried
     finished sentences naming a declaration, field, token, or row. Reclassifying them as invariants
     would have meant rewording nearly all of them, which the ruling forbids. The rule that fell out:
     classify by _where the checked value came from_.
   - **`Assert` could not narrow an expression** — its `asserts condition is NonNullable<T>` form
     narrows only the reference passed, which forced roughly 100 guards across two packages to stay
     hand-written. Fixed by moving the callable and `.input` to a plain `asserts condition`, proven
     both ways and pinned in the compile-only fixture.
   - **Compiler throws that read as the author's fault were stale wording**, not validator gaps: each
     was checked rule by rule and found already rejected by the validator, then reframed.
   - **Raw throws kept: 16 sites across 4 files**, all emitted text with the reason stated at the
     site. The `app-compiler.ts` case is **closed** — `TR` gained `failInvariant`/`failInput`/`failHost`,
     so generated app code can now reach the taxonomy.
   - **The rejection blind spot is closed.** A second ratchet, `rejectedRawErrorIssues`, now bans a raw
     `Error` handed to a promise rejection. 30 such sites remain across 12 files, allowlisted per
     file — so the set of files cannot grow, though a new rejection inside a listed file still
     passes.

## Part 6 — Documentation

Baseline: the Spec pages are far more accurate than feared — Studio, Presentation/Navigation,
Testing, Actions, and Data are verified accurate to mostly-accurate with named fixes; the failures
are concentrated in `Tao Layout and UI.md` examples, `Tao Design - WIP.md` (misplaced draft), and
the tutorial. All cross-references resolve except one (noted below).

### 6.1 Structural changes

- **`Docs/README.md` becomes the authoritative document map** (the deliverable Roadmap.md asks
  for): Spec = implemented contract (drift is a bug); `Tao Revolution/` = decided language +
  program + coverage; workstream folders = live multi-document workstreams only; top-level
  `Docs/Roadmap/*.md` = one exploration per future capability, each carrying a status header;
  `Archive/` = frozen; `Roadmap.md` = the only index of open work; app READMEs = product/process
  mechanics; `AGENTS.md` files = agent constraints. Record the document-name prefixes in use
  (Plan, Brief, Overview, Findings, Follow-ups, Design, Decision memo, Prompt, Proposed Decisions
  amendment) and the draft-naming convention (no agent-identity suffixes; name drafts plainly).
- **Folder rule**: a workstream folder exists only while it holds ≥2 live documents; a
  single-document workstream is a top-level exploration file. This dissolves `Tao Studio v1` and
  `Bridge React Native and Expo APIs into Tao` (below); `Add navigation and routing MVP` may
  collapse to a top-level follow-ups file under the same rule.
- **Contract routing rule** (state it in Docs/README.md): implemented behavior → a Spec page;
  decided-but-unbuilt → `Decisions.md` or its amendment flow; open questions → exactly one
  workstream ledger; completed work → Archive; Roadmap.md points and never duplicates.

### 6.2 Archive moves (move to `Docs/Roadmap/Archive/`, updating inbound pointers)

- `Tao Studio v1/Plan - Tao Studio v1.md` (self-declared historical; two inbound pointers). Move
  `Exploration - Native device as Studio canvas.md` out first — it is still live (two Roadmap items
  cite it); relocate it to the Roadmap top level or `Tao Studio v2/`; the v1 folder then dissolves.
- `Tao Studio v2/Prompt - Complete Tao Studio v2.md` (788-line spent requirement authority) and the
  two fully-adopted amendments (`Foreign views`, `Scenario groups` — both verified incorporated
  into Decisions.md §15/§16). Keep the Decision memo (governing record of the three deferrals —
  trim its "Implemented:" paragraphs that duplicate the Spec) and the Plan (living ledger with open
  gates). Keep the `Action failures and transactions` amendment — only partially adopted; archive
  when the deferrals are decided, or first move its live proposal sections into the memo.
- The entire `Declaration model spike/` folder, after extracting its four live open questions
  (Q7–Q10: derived-type behavior wrapping, `data` implement protocol, nav-out-of-TR timing,
  derived-slot declarability) into `Deferred Tao language decisions.md` as new LANG rows.
- `Bridge React Native and Expo APIs into Tao/Findings - Native device capabilities.md` — its three
  forward questions are already owned by `Device capabilities.md`; repoint the Roadmap.md bridge
  item there; the folder dissolves.
- `Add Tao design system MVP/Research - …` after moving its 2–3 unique open questions into
  `Design tooling and rollout.md` (their Open Questions sections are near-verbatim duplicates).
- Note: archiving removes five of the six live files carrying a ` - Claude` suffix (forbidden by
  AGENTS.md); the sixth goes with the descriptor-identity consolidation below.

### 6.3 Consolidations (one home per contract)

| Contract                                                                                               | Home                                                      | Action                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project-ID contract (four homes)                                                                       | `Docs/Spec/Tao Packages.md:107-121`                       | `Tao Presentation and Navigation.md:70-74` shrinks to a pointer (keep its declaration-identity paragraphs); `Tao Packages.md`'s two other restatements shrink to references. Re-verify the reserved `@workspace` root claim before carrying it over — it exists in Decisions.md and one validator fixture but not in `Packages.ts`. |
| Descriptor identity (implemented; verified in `declaration-identity.ts` + `TR-navigation-identity.ts`) | `Docs/Spec/Tao Presentation and Navigation.md`            | Fold the content of `Add navigation and routing MVP/Design - Canonical descriptor identity - Claude.md` into the Spec, then archive the design file. Settles the roadmap's "descriptor-identity draft" item.                                                                                                                        |
| Design-system open questions                                                                           | `Add Tao design system MVP/Design tooling and rollout.md` | Absorb Research's unique questions; delete the byte-identical Open Questions section from `Tao Design - WIP.md`.                                                                                                                                                                                                                    |
| Studio implemented behavior                                                                            | `Docs/Spec/Tao Studio.md`                                 | Decision memo keeps rulings/deferrals only.                                                                                                                                                                                                                                                                                         |
| Local InstantDB stack                                                                                  | `InstantDB datasource provider/Implementation - …`        | WordFlower README keeps only the run commands.                                                                                                                                                                                                                                                                                      |

### 6.4 Spec fixes (all verified against code; re-verify before editing)

- **`Tao Design - WIP.md`** — the one truly misplaced page: ~85% is unimplemented design direction
  that belongs in the design-MVP folder, and the implemented 14% _understates_ six shipped
  capabilities (structured `colors`/`sizes`/`text`/`screens`/`styles` blocks, nested color families
  with ramps, scheme-conditional colors and clause entries, dimensioned size tokens with units and
  addition, capitalized bundles as element defaults, `background`/`ink` lowering, symbolic font
  weights) because the grammar landed a day after the page was last touched. Move lines ~59-402 to
  the design-MVP folder, rewrite the implemented-slice section to the actual surface, drop the
  `- WIP` suffix.
- **`Tao Layout and UI.md`**: remove or future-mark the four ahead-of-code items (`shadow` head in
  two examples — it throws at runtime; `@title [pad 2]` — doesn't parse; the longhand
  declaration-property examples shown as working code; `TextMultiline(..., Lines:)`); fix the false
  `FormButton` icon claim; add the five shipped elements missing from the inventory (Switch,
  Slider, Picker, SegmentedControl, DatePicker); state that layout clauses are ignored by the
  default `@tao/ui` native controls (the `WarnUnhonoredLayout` behavior — the single biggest reader
  trap on the page); widen `on change` beyond text; add `as sheet` to the modal discussion; align
  the page's status line with Docs/README.md's Spec framing.
- **`Tao Presentation and Navigation.md`**: mark the `as window`/menu host-matrix rows unambiguously
  reserved; document the other two `replace` forms (ambient `replace X in app` ships in WordFlower)
  and bare `present @key`; give `as sheet` an example.
- **`Tao Type System.md`**: delete the self-contradicted value-position `inject Type` claim;
  document the compact `when` form and fix "`otherwise` is required for every supported `when`";
  align the query-case list with `Tao Data.md` (`refreshing`/`stale` advisory); note `.Count` on
  text; scope the `Config` emission claim to nav/datasource.
- **`Tao Data.md`**: "the shipped implementations pass that suite" → "Memory and Local pass that
  suite"; document the implemented `?` optional marker and `required "<sentence>"` trait. The four
  traits `touch on change`, `ordered`, `search`, and `device` **stay in the grammar** (Part 7 item
  14): they are decided Revolution surface in `Decisions.md`, not consumer-less cruft. Document them
  as decided-but-unbuilt rather than removing them.
- **`Tao Testing.md`**: delete the "datasource status changes" phrase that contradicts the page's
  own retirement note (pairs with the `setTestStatus` removal in Part 1); qualify the "all ID-based
  selectors are retired" claim (stdlib `TextInput` exposes a user-supplied `Id` that lands in the
  `testID` namespace tags query); fix the `check`-reads-as-keyword prose; mention bare
  `press "text"` and the test-declaration extras.
- **`Tao Actions.md`**: add the fifth capture domain (`scheme`); amend the `TR.Errors` passage per
  the Part 7 decision.
- **`Tao Studio.md`**: fix the "URLs carry only the instance ID" clause (parent origin and session
  id are also carried); document or explicitly scope out the shipped AI fixture generation
  (`/api/ai/fixture`, the per-cell generation button, `tao-generation` dependency).
- **`packages/studio/README.md`** (formerly `Docs/Spec/Tao Studio Development.md`; operational, not
  Spec): reword "the root is not a usable page" (Welcome serves at `/` in every real launch);
  reconcile the smoke-lane section and recipe list with the Part 4 command consolidation; note the
  `studio-canary` defaults; `ELECTROBUN_SKIP_NOTARIZATION` stays but is an upstream-contract claim
  no repo code confirms.
- **`Tao Revolution/Coverage.md`**: fix the legend's pointer to the archived Focused-writing-tranche
  path; name `TR-navigation-restoration.test.ts` in the restoration row (see 2.2).
- **`Multiplayer sync.md`**: fix the one broken reference in the doc set
  (`Docs/Spec - Revolution/Authority and Sharing.md` does not exist → point at Decisions.md §3–§4).
- **`Deferred Tao language decisions.md`**: LANG-001's visibility list is missing the shipped
  `folder` level; absorb the spike's Q7–Q10; the inventory now runs past 030.
- **`Tao ship.md`**: "Electron wrapper today" → Electrobun.
- **`Enforcement and diagnostics surface/Brief`**: refresh the repo-state facts (pinned to a
  much older commit; `merge-feature-preflight` is gone as it predicted; suite baselines and CLI
  command list stale) before any planning against it.
- **`packages/AGENTS.md`**: add one sentence each for `generation`, `workspace`, `stdlib`, `shared`;
  sharpen the parser/ast-utils ownership sentence to the actual criterion (parser owns what
  scoping/linking needs); note that `_gen_*` trees are generated and how they're cleaned; name the
  sanctioned Bun-API exception (Part 5).
- **`Docs/Tutorials/Your First Tao App.md`**: fix the two compile-breakers (`use Local from
  @tao/data` → `@tao/data/providers/local`; add the required `id` to both `project` blocks); rename
  one of the duplicated `#finished` tags; add a minimal CLI thread (create → dev → test) — the
  tutorial currently contains zero commands.

### 6.5 Roadmap.md fixes

- Check off or annotate "Complete Tao Studio v2" per the v2 Plan's remaining gates (the headline
  work landed; the open items are the external validation gates — reword rather than silently
  checking).
- "Rename UI to Scene" is checked done but no `scene` construct exists anywhere — the `ui` keyword
  was retired into `view` by the unified-view tranche. **Ro decision**: fix the item's wording to
  what actually happened, or reopen it if a Scene rename is still intended.
- "Add `tao create` project scaffold" — `tao create` exists; re-scope the item to the missing parts
  (docs, dev/test scripts, open-and-run path) or check it off.
- Update the Records row "LANG-001..030" (now higher); index Component kits' open items; point the
  RN/Expo bridge item at `Device capabilities.md`; drop the "replace Electron" phrasing (no
  Electron ever shipped in this repo); the two "Documentation cleanup" checkboxes are executed by
  this plan — replace them with a pointer here.
- When slices of this plan land, retire the Roadmap items it absorbs (test review, TR cleanup,
  markdown rework, export sweep, magical strings, utility grouping, `ValidationContext` argument
  order, imports/exports structure) by pointing them at this plan or checking them off.

## Part 7 — Decisions for Ro

Everything here gates work described above; nothing else in this plan needs a decision.

1. ~~**`TR.Errors`**~~ — **DECIDED and DONE: kept and consolidated.** Ro: _"As long as we have one coherent
   approach for interacting with errors at runtime, with structure that allows for logic and
   functionality about runtime errors to be mostly centralized and explorable and understood without
   looking in many different places of the codebase. Also, we should be able to easily grep the
   codebase for all places in which runtime error handling of some sort or another is being done,
   which becomes easier if there is consolidated wrapper/type/etc."_ `TR.Errors` is that
   consolidation point, so it stays. The work is to make runtime error handling live up to the
   principle: today it is split between `TR-errors.ts` (unowned-failure reporting and the error
   types, surfaced nowhere on `TR`) and `TR-action-transactions.ts` (surfaced as `TR.Errors`), with
   `TR.Errors` assembled ad-hoc in `TR.ts` from free imports. Folded in 3.2 step 4.

   **Delivered:** `TR-errors.ts` is the owning module and exports `ErrorControls`;
   `TR.Errors = ErrorControls` in full, so the facade is never a partial view. Deduplicated four
   byte-identical `errorMessage` copies, two credential-redaction regexes, and two contained-failure
   warnings. Containment, persisted state, native modules, navigation restoration, and data recovery
   now reach error policy through `TR-errors`, so
   `grep -rE "TR-errors|TR\.Errors" packages/` finds ten source modules where it previously found
   five. Two findings surfaced and deliberately **not** changed:
   - **184 bare `throw new Error(...)` across 28 runtime modules, against 2 typed
     `UnexpectedBehaviorError` throws.** This is the remaining incoherence in the error _vocabulary_
     — converting them changes every thrown `error.name`, which is a redesign, not consolidation.
     Worth its own decision.
   - ~~**`TR-navigation-native-hosts.ts:29` warns unconditionally**~~ — **fixed.** It is a genuine
     contained failure (the module is swallowed and the runtime degrades to basic host surfaces), so
     it now goes through `warnContainedFailure`: dev-only and consistently phrased. A test for that
     production guard, which had none, came with it. **Resolved:** `TR.WarnUnhonoredLayout` now routes through
     `warnDesignDivergence`, a second named policy for a notice where nothing failed, and holds no
     production guard of its own.
2. ~~**Legacy Studio client standalone dev fallback**~~ — **DECIDED and DONE.** Ro: _"Remove. We can
   reintroduce if this becomes a common issue."_ **This supersedes Guardrail 5's protection of the
   legacy `client/` tree**; the guardrail's other half stands — this was the fallback removal only,
   not broader strangler or document-authority work.

   **Delivered: −1,618 lines** (`studio-src/client/` 7,927 → 6,362), above the 1,100–1,400 estimate,
   with the studio suite unchanged at 188 passing tests. Reachability: `mountStudio` had two callers,
   and deleting the `StudioClient.ts` entrypoint made `embedded === true` universally true. Both
   modes now fail loudly, and the bundle cache still evicts a rejected promise so the next request
   retries.

   Four things expected to be dead were **not**, and were kept: `client/StudioShell.ts` is live —
   `TaoStudioProductHost.tsx` queries its markup for React portal targets; the command palette is not
   embedded-gated; the `StudioInspector` helpers are consumed by the ProductHost; and
   `StudioHighlight.ts` never had an `embedded` branch (its only hit is Shiki's `embeddedLangs`).

   Two follow-ups this surfaced:
   - ~~**`/api/design` now has no client.**~~ **Done** (Ro approved). The route, its `designRequest`
     helper, the handshake entry, and two stale assertions are gone — 13 lines, exactly the estimate.
     `session.inspectDesign` stays, since `StudioServerDatasource.ts:190` uses it for the Tao-owned
     `DesignTokens` panel. Correction to the reasoning first recorded here: the
     `not.toContain('/api/design')` assertion in `studio-client.test.ts` was written **by this
     branch**, two commits earlier, after deleting the only caller — citing it as standing proof was
     circular. On `main` that assertion was `toContain`. The sound argument is the direct one: the
     client method went with the legacy tree, leaving the route with no caller.
   - **No entry-file rename/delete guard.** `protectedPath` went with the detached legacy tree, where
     it only ever disabled buttons that were never displayed. The Tao file tree has no equivalent, so
     this is a latent gap rather than a regression. **Deferred**, and recorded in `Roadmap.md`.
3. ~~**`tao dev` and the dev-loop machinery**~~ — **DECIDED: keep and invest.** Retiring the
   subtree is off the table. Ro wants two distinct dev loops, and this machinery is the foundation
   of the second:
   - **Repo-developer loop** — run Tao apps from inside this repo while watching the toolchain, so
     the app reloads when either the `.tao` source _or_ the compiler changes; run the test suite
     with a TUI that shows parallel-test progress.
   - **Tao CLI loop** — for developers using Tao from their own editor or agent setup: watch-mode
     live reload, keyboard commands to launch to Android/iOS, switch which `app` declaration in a
     project runs, run the test suite. It should deliver much of what Studio does, for people who
     want the command line.

   Treat `packages/dev/dev-src/expo-dev-loop`, the TUI, the file watcher, and the keyboard input as
   product surface to be improved, not cleanup candidates. `tao create` / `tao completion` stay
   user-facing under the same reasoning. This supersedes any bullet elsewhere that proposes deleting
   them.
4. ~~**One type system or two**~~ — **DECIDED: B, retire Typir onto `Type`.** The deciding question
   was what investing in Typir (C) could give a Tao developer that retiring it could not. Answer:
   essentially nothing Tao has decided to build — `Decisions.md` commits to **no generics, no
   variance, no operator overloading**, and Typir's leverage is exactly that generalized machinery.
   Meanwhile the levers that do matter for developer experience sit in Tao's own code either way:
   message quality lives in the `*ValidationMessages` factories, and inference already lives in
   `Type.ts` (1,314 lines, doing the real work). Typir today contributes a collector round-trip —
   `ActionsValidator`/`StateValidator` register checks so `ExpressionsValidator` can drain them back
   into `ctx.error` — which makes "why did I get this message?" cross a framework boundary.
   **Stage 1 is DONE, and the staging paid off.** The three collector rules (`DoStatement`,
   `SetStatement`, `StateDeclaration`) are now plain node checks calling `ctx.error` directly, which
   also removed a real cycle (type-system → validators → TypeSystemHelpers). They run as their own
   `typeInferenceChecks` group at exactly the point the drain used to sit, because merging them into
   `nodeValidationChecks` would have **reordered diagnostics** — a test now pins that contract.

   **Parity was proven, not assumed:** temporary instrumentation dumped every diagnostic in emission
   order across 622 validation runs / 717 diagnostics plus the Tao corpus; `diff` before/after was
   **zero lines**. A determinism control ran first. One trap found and closed: the
   `doTypeMismatch` check had **zero test coverage anywhere**, so the parity evidence would have been
   vacuous for the one rule converted to pure `ctx.error` — a 12-case probe was run against
   `git show HEAD:` copies to confirm, and two cases became permanent tests.

   **Measured: Typir has collapsed to `safeInferType` plus one `ensureNodeIsAssignable`**, exactly as
   predicted. Product entry points are two (`reportStateDeclarationTypes` 141 calls,
   `reportSetStatementTypes` 119); the rest is internal recursion, and `inferExpressionType` is
   test-only. The surviving drain now returns **nothing** — 2,689 invocations, zero problems.

   **Stage 2 is DONE. Typir is gone** — `type-system.ts`, `TypeSystemHelpers.ts`,
   `expressions-validator.ts`, the service construction, the `Workspace.typir` getter, the
   `@validator/type-system` export, and both dependencies. Net `−584 / +78`, with `bun.lock` moving
   exactly seven lines and no collateral churn. Ro accepted `text` over `stateful text`.

   **"Delete the Typir branch and let the fallback handle everything" would have shipped a
   regression, and only a probe caught it.** `reportSemanticSetStatementTypes` errored on _every_
   compound operator — it was missing the Typir branch's `underlying !== 'number'` guard — and
   nothing noticed because the fallback was reachable only when the state type was not a plain
   primitive, so the ordinary `set Count += 1` path never executed it. A shadow probe running both
   implementations over the corpus measured **119 `set` statements, 114 on the Typir branch, 5 on the
   fallback, and 31 that would have become false-positive errors.**

   Two further gaps closed while there: the fallback read the _initial value's_ type and ignored a
   declared `is` type, so `state Value is Mixed = "start"` was checked against `text` rather than
   `text | number`; and a compound mismatch now emits one error rather than two, matching what
   nominal, enum, and union states already did.

   **More Typir names were leaking than the one we knew about.** Beyond `stateful text` → `text`, a
   probe corpus surfaced `got /__tao__/source.tao#Label.` → `got Label.` — a document-qualified
   internal key in user-facing text — plus `got action` → `got action()`, `expects list` →
   `expects list of text`, and `got stateful boolean` → `got boolean`.

   Corpus coverage was thin here (only three set-type diagnostics), so a clean corpus diff would have
   been nearly vacuous; a 45-case probe corpus carried the real evidence, and six of those cases
   became permanent tests, vacuity-checked by perturbing the expected strings.
5. ~~**Legacy root-view app form**~~ — **DECIDED and DONE: made sugar.** Ro: _"Could we remove most
   of it, by simply adding a root navigator that holds the view when the user does that? It almost
   becomes syntactic sugar."_ A root `view` statement now supplies the app's `Navigator` slot, seeded
   at the earliest point each side builds its app model, so neither the compiler nor the validator
   keeps a branch. `isLegacyViewApp`, `compileLegacyViewApp`, `validateLegacyApp`, and the
   `Compile.AppView` codegen member are gone.

   **Honest accounting: raw LOC is a wash (+4).** 45 lines of dedicated legacy code deleted, ~48
   added for the sugar. What collapsed is the _shape_ — one app compilation path and one validation
   path — and the form stopped being a dead end: it now gets `Name`, `Design`, `Datasource`,
   `Restore`, auxiliaries, app state, app actions, and `app Variant = Base with { … }`, none of which
   worked before. If the bar was "fewer lines" this did not clear it; if it was "one pathway" it did.

   Two design points, both evidence-backed: the synthesized navigator is a **slot, not a stack**
   (routing a parameterless root view through `StackNav` fails the statically-known-destination title
   rule), and it uses the **runtime** slot kind rather than the stdlib `SlotNav` (a file with no `use`
   statement loads only `Project.tao` and the Prelude, so the stdlib type would force `@tao/nav` into
   the workspace load set).

   **One deliberate relaxation to note:** `app X { view Y  Design D }` previously errored and now
   validates — a root view composes with ordinary app configuration. The exactly-one-root and
   no-parameters diagnostics are kept; "transitional root view" became "root view", since the form is
   decided sugar rather than a transitional accommodation.
6. **`@runtime/TR-studio` subpath split** — keeps Studio/dev-menu code out of production bundles;
   needs a compiler emit change; schedule with a tranche.
7. ~~**Preview compatibility copies**~~ — **DECIDED and DONE.** `_gen_tao-app/current` is now a
   symlink to the newest revision root, staged and renamed so it is never observed missing, with a
   one-line pointer file as the fallback where symlinks are unavailable (proven by forcing `EPERM`).
   **Correction to the finding:** the copies did _not_ double writes on every edit —
   `writeGeneratedApp` already skipped content-identical writes. They doubled the _cold_ publish and
   the on-disk footprint: cold-publish bytes fall **49.5%** (749,964 → 379,007) and steady-state
   files **33%** (193 → 130); a warm one-file edit barely moves. Also **false for tests**: two suites
   did read the top-level copies and were repointed. One real gotcha: TypeScript follows symlinked
   directories during `include` expansion, doubling the program from 134 to 261 entries, so the link
   is excluded in `runtime-toolchain/tsconfig.json` (`exclude` overrides rather than merges, so the
   base entry is restated).
8. ~~**`just bench` / `./agent bench`**~~ — **DECIDED: keep.** Ro's broader ruling on the Justfile:
   human-invoked recipes should be composed and each invocable stand-alone, and `just --list` should
   surface commonly useful dev options — one recipe for all fixing and gates, separate recipes for
   the smaller parts. A public recipe is therefore never dead merely for lacking callers.
9. ~~**`_runtime-pack-check` cadence**~~ — **DECIDED: keep it in both lanes, unchanged.** It packs
   the runtime with temporary release metadata and runs `bun pm pack --dry-run`, proving the package
   would publish with the right files. Measured at **45ms** per run, so the "release validation in a
   daily lane" concern does not pay for itself; the failure it catches is silent and only surfaces
   for users. Item closed, no work.
10. ~~**Jest-e2e migration rule**~~ (3.3) — **DECIDED: adopted**, and written into
    `packages/AGENTS.md` so review enforces it rather than memory. A jest e2e test earns its place
    only when it needs a native/module override, asserts generated-code shape, or exercises the
    harness itself; new behavior coverage lands in Tao and existing suites migrate opportunistically
    when touched. No wholesale rewrite is scheduled.
11. ~~**React-element-harness tests**~~ (2.2 step 8) — **DECIDED: yes, cut them.** The
    RN-test-renderer e2e tier owns element-tree lowering and RN vendor choice; the ~200 lines in
    `TR-views.test.ts` / `TR-navigation-identity.test.ts` that monkey-patch React to assert element
    trees go. Unblocks 2.2 step 8 in Phase 4.
12. ~~**Shared-facade symmetry**~~ — **DECIDED per facade**, after investigation showed the original
    framing was wrong on three of the four:
    - `CLI.runSync` — **de-exported.** Sync is load-bearing: `Repo.getRoot()` feeds `resolvePath` /
      `tryGetRoot` / `tryResolvePath` across **141 call sites in 50+ files**, six of them
      module-level `const` initializers, so making it async would ripple repo-wide. `mustRunSync`
      stays exported because `Repo.ts` is a different module.
    - `CLI.formatCommand` — **unified into `Errors.ts`**, which owns the only consumer (`CLI` imports
      from `Errors`, so the reverse would cycle). Command-failure messages gained the quoting only
      the dead export had.
    - `HCI.askText` — **kept.** The adoption clause turned out to have an empty set: `node:readline`
      is imported in exactly one file repo-wide (`HCI.ts`), and there is no hand-rolled text prompt
      anywhere. So `askText` stays exercised only by its own tests — the honest consequence of the
      ruling. The one candidate, `dev-app-selection.ts`, is a _choice_ prompt, not a text prompt
      (see Part 3.5).
    - `Log` — **deleted.** The question was too narrow: `Log.info/debug/warn/error/success` had zero
      consumers repo-wide outside the `shared.ts` barrel and Log's own test. (The `Log.enable` in
      `packages/studio/README.md` is the Chrome DevTools Protocol `Log` domain, not this module.)
13. ~~**"Rename UI to Scene"**~~ — **DECIDED: dropped. Do not introduce `scene`.** Once it was clear
    there is no `ui` keyword and no `scene` construct — the unified-view tranche retired `ui` into
    `view`, leaving only the stdlib package `@tao/ui` — Ro dropped the rename rather than churn a
    published import path. The Roadmap entry now records what actually happened instead of claiming
    a Scene rename.
14. ~~**Grammar-only data traits**~~ (`touch on change`, `ordered`, `search`, `device`) — **DECIDED:
    keep.** They are decided Revolution surface, not dead grammar: `Decisions.md` documents them in
    the data-traits table (`:356-358`), uses them in worked examples (`:367-368`), and restates them
    at `:2136`. Removing them would delete decided-but-unbuilt language surface. Item closed, no
    work. (The plan's pointer to "Decisions.md §9" was wrong — §9 is _UI_.)
15. ~~**`generation` package rename**~~ — **DECIDED: yes, rename to `ai-generation`.** It is an
    AI-service package (Apple Foundation Models) consumed by studio and dev, whose compiler
    dependency is type-only; "generation" reads as a pipeline stage, which is exactly what it is not.
    Churn is small — few internal consumers, no published surface. Land it with the Part 5.1
    export/rename sweep so it is one coordinated pass.

## Part 8 — Execution order

Each phase is independently valuable; later phases assume earlier ones only where noted.

1. ~~**Dead code** (Part 1)~~ — **done**, one commit per group. `TR.Errors` and the shared-facade
   symmetry question stayed blocked on Ro.
2. ~~**Environment quick wins**~~ — **done**: parser-gen stamping, `_dependency-check` drop, the
   generated-run lifecycle with `just clean` coverage, and the 4.3 convention checks (in repo-lint).
   The 4.3 dead-export check is deferred — it wants a new third-party dependency, which is Ro's call.
3. **Test-harness modules** (2.6) — **shared helpers done**; the three package-local `test-*.ts`
   modules and all adoption remain, and belong with the Phase 4 passes that consume them. — land the shared helpers and the three package-local `test-*.ts`
   modules before the test cuts, so consolidations write against the new fixtures.
4. **Test surface** (2.1–2.5) — Test Apps merges (atomic with README edits), then TR/studio/
   pipeline/dev-cli passes. Keep each cut's named surviving proof verified.
5. **Production structure** (Part 3) — protocol/route/guard consolidation before the Studio god-file
   splits; TR extraction steps in order; toolchain split.
6. **Command surface** (4.1) — `./agent` thinning, canonical spellings, spec edits together.
7. **Conventions** (Part 5) — `ValidationContext` flip, then the export/rename sweep one package per
   commit, with the doctor checks from 4.3 already in place.
8. **Documentation** (Part 6) — structural changes and archive moves first (they change where fixes
   land), then per-page fixes. Doc moves can proceed in parallel with any phase; spec fixes that
   pair with code removals (`setTestStatus`, `TR.Errors`) land with those commits.

Wherever this plan and the tree disagree by the time a phase runs, the tree wins — re-verify, fix
the plan line, and proceed.

## Appendix — notes for the executing agent

- Exclude `_gen_*` from every search; prefer `git ls-files`-driven sweeps (the ignored generated
  trees polluted naive greps throughout this audit until cleaned).
- zsh quirks that cost audit round-trips: quote `--include='*.ts'` (glob expansion), avoid backticks
  in double-quoted grep patterns (prefer `grep -F` or single quotes), never name a loop variable
  `status` (read-only in zsh), and process substitution (`<(...)`) is denied in the sandbox — use
  temp files or `git diff --no-index`.
- The dev suite asserts against the live checkout in several places (committed agent-config parity,
  watch facts, dependency facts) — a dirty or partially-installed tree fails those tests for
  reasons unrelated to your change.
- Line references in this plan are anchors from the audit commit, not gospel; every removal claim
  ("zero references") must be re-run before the delete.
