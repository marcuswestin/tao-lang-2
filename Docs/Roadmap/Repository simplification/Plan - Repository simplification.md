# Plan - Repository simplification

Status: audit complete, execution not started. Audited at commit `37c32830` (Complete Tao Studio v2),
2026-08-31. Every finding below was produced read-only and verified against code at that commit —
file:line references drift, so re-verify each claim against the current tree before acting on it.

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
5. **The Studio strangler boundary stands.** The legacy `client/` tree is the deliberate hidden
   workbench controller under `TaoStudioProductHost`. Promoting the Tao editor to document authority
   is strangler-plan work sequenced after the external browser/native validation gates in
   `Docs/Roadmap/Tao Studio v2/Plan - Tao Studio v2.md` — it is not cleanup and is not in this plan's
   scope. (The narrower fallback question is a Ro decision, Part 7.)
6. **The smoke lane is deliberately outside `verify`.** "The smoke lane already proves this" is never
   a reason to delete a gate-lane test — it would move coverage from every-commit to on-demand.
7. **Pattern-filtered runs skip the Tao app suite entirely** (`TestRunner.ts` returns no tao-apps
   suite under a pattern). Keep package tests for anything developers iterate on with
   `./dev test <pattern>`; delete a package test only where the Tao-level behavior test is genuinely
   the contract.
8. **The runtime navigation module split is spike-settled** — the dense-looking cross-imports are
   type-only and acyclic. Do not re-merge the navigation family.
9. **Do-not-touch test files:** `TR-navigation-restoration.test.ts` (sole proof of the Coverage.md
   restoration row — no `relaunch` step exists in the Tao test language),
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

- `TaoRuntime-src/TR-navigation-web-history.ts` (135 lines) — zero importers; superseded by
  `TR-navigation-browser-history.ts`.
- `TR.Alert` (`TR.ts:529-535`) — zero references anywhere, including tests.
- `TR.IsEmpty` (`TR.ts:192-194`) — never emitted by the compiler; its one test caller can use
  `TR.IsCase(x, 'empty')`.
- Deprecated `TR.Enum(caseNames)` array overload (`TR.ts:164-180`) plus the
  `ephemeralEnumDeclaration` counter — the compiler always emits the identity form; only tests use
  the deprecated form. Update those tests in the same change.
- `TR.VisualNativeRoot` (`TR.ts:604-609`) — test-only; stdlib native injections use
  `TR.VisualNativeProps`/`TR.Element`.
- `setTestStatus` (`TR-data-registry.ts:150`, re-exported from `TR-data.ts`) — orphaned hook for the
  retired datasource-status test step (Decisions §16); zero callers. Fix the contradictory sentence
  in `Docs/Spec/Tao Testing.md` (6.4) in the same change.
- `TR.Errors` (`TR.ts:633-637`) — **Ro decision** (Part 7): remove and amend
  `Docs/Spec/Tao Actions.md:165-166`, or declare it deliberate public surface.

### studio

- `startStudioServer` single-session compatibility entrypoint (`StudioServer.ts:56-64`) and its
  trail: `defaultSessionId` threading, the legacy-root fallback of `studioSessionRoute`,
  `sessionId?` on `StartedStudioServer`, the now-constant `welcomeAtRoot` parameter, the client root
  fallback in `StudioApiRoutes.sessionPath('/')`, and the compat tests
  (`studio-server.test.ts:218`, `studio-client.test.ts:812`).
- Dead direct-HTTP file-CRUD action exports `CreateFile`/`RenameFile`/`DeleteFile`
  (`TaoStudioServerActions.ts:163-171`) — pre-ProductHost strangler leftovers. `SyncDraft`,
  `ApplySourceAction`, `UndoSourceAction` in the same file are live; keep them.
- `renderInspectorPanel` (`client/StudioVisualEditing.ts:167`, ~35 lines) — zero references.
- `StudioProductCapabilities` (`client/StudioProductPanels.ts:28-41`) — always-true gate whose only
  production reader is embedded-dead; remove with its test assertions.
- Dead `package.json` subpath exports `./compile-coordinator`, `./lsp`, `./protocol` — zero subpath
  imports; all consumers use the barrel.
- Local `stripAnsi` in `studio-src/StudioTestRunner.ts:123` — duplicate of shared `Text.stripAnsi`;
  import instead.
- Dead DOM markers: `dataset['taoStudioClient']` (`TaoStudioBrowser.tsx:8`, never read),
  `.studio-shell--embedded` (`client/StudioShell.ts:74`, no CSS rule),
  `.studio-product-host-error` (`TaoStudioProductHost.tsx:155`, never styled). Prefer making the
  first one useful: the smoke fix in 2.3 should assert it instead of the nonexistent
  `[data-studio-tao-drawer]`.

### tao-cli

- `validateTaoTestFiles` + `forEachDirectoryGroup` (`cli-src/test-command.ts:189-231`) — a
  production-dead third copy of validation already implemented earlier in the same file; only its
  own test calls it.
- Unused `CompileResult` type export (`cli-src/compile-command.ts:6-9`) that shadows the compiler's
  type of the same name.

### parser / validator / formatter / shared

- Dead functions in `parser-src/ast-structure.ts`: `appDeclarationOf` (superseded by the live
  `ASTUtils.rootAppValue`), `isAppVariantDeclaration` + its type, `configurableTypeAliasTarget`.
- Unused `./validation` subpath export in `packages/validator/package.json`.
- De-export internal-only symbols (keep the code): `primitiveDeclaration`, `slotFillRootTag`,
  `configuredPrimitiveOfValueDeclaration` (ast-structure), `unitFamilyOfPrimitive` (`Type.ts`),
  `hasInteriorComments` (`formatting.ts`), `isStackNavDeclaration` (navigation-validator),
  `WeightedRigidClaim` (layout-validator), the three request types in `package-resolver.ts`.
- `formatsUnchanged` in `formatter-tests/test-format.ts` — referenced nowhere.
- Shared-facade functions exercised only by their own tests — `CLI.runSync`, `CLI.formatCommand`,
  `HCI.askText`, `Log.setTransport`: **Ro decision** (Part 7) — delete, or keep deliberately as API
  symmetry; decide once per facade rather than re-litigating per audit.

### Justfile / devenv (commands with zero references)

- `just lint` (check already runs `_repo-lint`), `just studio-smoke-native` (survives as
  `./dev studio-smoke --native`), `just studio-test` (duplicates `bun test packages/studio/studio-tests`,
  already inside `just test`), `just fmt` + the `./agent fmt` passthrough (`fix` is a strict
  superset). If `studio-test`/`studio-smoke-native` are kept instead, document them in
  `Docs/Spec/Tao Studio Development.md` (they are currently undocumented either way).
- Unused devenv pins in `devenv.nix`: `oxlint`, `watchexec`, `jq`, `fd` (zero repository references;
  lint is `repo-lint.ts`). Confirm `npm.enable` similarly. Trivially re-addable if Ro uses any
  interactively — ask before removing only these.
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

Also: Resizable Split's persisted-width claim is a paper contract (the journey never resizes nor
relaunches) — on merge, either add a resize step or trim the claim from the README entry.

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

- Add to `@shared/test`: `Deferred<T>()` (5 copies today), `settle()` + `until(predicate)` built on
  `Time.sleep` (10 sites, 5 names, 3 timeout budgets), `fakeTerminal()`/`withCapturedOutput()`
  (5 sites; deletes `shared-tests/TestRuntime.ts` and three direct `node:stream` imports),
  `MockModule(name, factory)` backed by `mock.module` in Test-Bun and `jest.mock` in Test-Jest
  (closes the last two direct `bun:test` imports) plus a shared RN component stub table,
  `setClockForTest(now)` (two hand-rolled `Date.now` patchers), and the parse-clean primitive
  (`parseClean` in ast-utils duplicates `testParseCode`, which it cannot import today).
- Create `TR-tests/test-tr.ts` (action/value doubles), `dev-tests/test-dev.ts`
  (`fakeStartedCommand` unifying the near-identical process fakes in `studio-dev`/
  `studio-smoke-launch`/`worker-session`; generic `findCheck`), and `studio-tests/test-studio.ts`
  (2.3 item 1).
- Runtime-owned (runtime imports nothing from `@shared`): export `memoryKeyValueStorage()` and
  `memoryDataProvider()` next to the existing `testDataConnection` in `TR-data-provider.ts`
  (8 hand-rolled copies today, some with diverging semantics).
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
4. Normalize grouped helpers: eleven modules own `XxxControls` objects, but `TR.Errors`,
   `TR.Capture`, and `TR.Persisted` are assembled ad-hoc inside `TR.ts` from free imports — have
   `TR-runtime-capture.ts` and `TR-persisted-state.ts` export their own Controls objects. S.
5. Rename the `'legacy-style'` design-spec kind to `'bundle'` across compiler/runtime/tests —
   bundles are decided current language; the name misleads. S.
6. `@runtime/TR-studio` subpath split — **Ro decision** (Part 7): today every production app bundles
   ~2,400 lines of Studio/dev-menu runtime because `TR.ts` statically imports them. An emit-gated
   subpath keeps production bundles lean, but it needs a compiler emit change — schedule with a
   language tranche, not this cleanup.
7. Have `TR-studio-preview.test.ts` import `TaoStudioProtocolVersions` instead of repeating
   `'tao-studio'` nine times. S.

### 3.3 Runtime-toolchain

- **Generated-run lifecycle** (M — also the biggest environment win): `_gen_tao-app-test/` had
  16,518 generated files (81 MB, 375+ run roots) with three creators and zero deleters; `just clean`
  removes `_gen_tao-app` but not `_gen_tao-app-test`. Delete a run root on suite success, keep the
  newest failed root, prune old roots at harness startup, and add the directory to `just clean`.
  Touch points: `testing/compile-app.tsx`, `testing/test-compiler/Worker.ts`,
  `tao-cli/cli-src/test-command.ts`, the Justfile. This removes 16k files from every grep and index.
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
  consumer); merge `type-system.ts` + `TypeSystemHelpers.ts` (two halves of the Typir bridge —
  or fold into the Part 7 Typir decision). S each.
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
  import to go through a `Platform` wrapper. S.

### 3.5 tao-cli

- Fold the seven copies of the catch/format/exit block into one `runCliCommand(fn)` wrapper (one
  copy inconsistently uses `setExitCode`). S.
- `dev-app-discovery.ts` re-implements `Runtime.appNames` — call it. `dev-app-selection.ts`
  hand-rolls raw-mode key input duplicating `RawKeyInput` and bypassing `HCI.askChoice`. S/M.
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
- **One canonical spelling per outcome**: make `./dev` the documented spelling for Studio
  launch/smoke/release (`just studio`, `just studio-native` delete outright; move the default
  arguments of `studio-canary`/`studio-proof-real-app`/`studio-package` into `./dev` option
  defaults and delete those recipes); canonicalize on `./tao dev` and delete `just dev` (one
  WordFlower README edit); with the `./agent` thinning, `./agent doctor` becomes `just doctor`
  directly. Most of the work is edits to `Docs/Spec/Tao Studio Development.md`, whose launch table
  already annotates the just rows "Same as `./dev studio`". M.
- Move `scripts/generate-agent-config.ts` (10-line bootstrapper) into `AgentConfigGenerator.ts` as
  an `import.meta.main` block (the pattern the other repository-tests use) and delete `scripts/`. S.
- **`.cursor/permissions.json` is the one hand-maintained copy of the permission policy** with no
  parity test — the only place the permission story can silently drift. Add a CursorConfigGenerator
  beside the Codex one (M) or at minimum a committed-file parity test (S). Follow the
  agent-instructions skill for ownership.

### 4.2 Gates

- **Stamp or de-duplicate parser generation** (S–M, pays off on every `test`/`check`/`verify`/`fix`):
  `ParserGenerate.ts` has no staleness check and runs 2–3× per gate run because each gate is a
  separate process; concurrent runs race writes to the generated parser while other gates read it.
  Stamp generation on grammar+config content, or drop `_parser-gen` from the gate recipes since the
  serial `_compile-word-flower-app` prefix already guarantees freshness.
- **Drop `_dependency-check` from both lanes** (S): `dependency-compatibility.test.ts` runs
  `readDependencyFacts()` against the real checkout inside the dev suite — the exact gate condition.
  The module stays (the doctor consumes it).
- `_runtime-pack-check` in every `check` and `verify` is release-readiness validation in the daily
  lane — **Ro decision** (Part 7): demote to verify-only or a release lane.
- Fix the `verify` skip-reason string for `_tao-check` ("covered by check" — nothing guarantees a
  check ran; the actual argument is that `fix` runs `./tao fix` and the tao-apps suite). S.
- Oversubscription (gate jobs × `_test`'s internal scheduler × `tsc --build`) is structural but
  unmeasured — act only with timing evidence; the cheap option is capping gate jobs. Consider
  having `verify` append a one-line per-gate timing history so future gate-cost questions have data.
- Add a "tao-apps skipped under pattern" notice to the test-runner summary — pattern-filtered runs
  silently exclude the whole Tao behavior suite today. S.

### 4.3 Repository health checks

- Add one-line grep checks to `RepositoryDoctor` (or repo-lint) for the conventions the audit found
  near-perfectly held, so the sweeps in Part 5 can't regress them: no native `switch` outside
  approved files, no `bun:test` outside `Test-Bun.ts`, no `langium` imports outside parser, no
  cross-package `-src/` relative imports. S.
- Add a dead-export check (`knip`/`ts-prune` or a small recipe) — the cleanup-spike R5 rule depends
  on exactly the evidence this audit had to hand-roll, and it would have caught Part 1's findings at
  commit time. M.
- Worktree bootstrap: pre-warm `.artifacts/build/agent-dev` (or make help not need it — falls out of
  the `./agent` thinning) so fresh sandboxed agent worktrees don't hit the known
  `bun install` `.idea`/`.gitmodules` copy denial; teach `just doctor` to detect a broken
  `.devenv/bootstrap` evaluation (see the environment ledger in the handoff for symptoms). S/M.

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
   and the one relative escape `StudioPackagedTestCommand.ts` → `../../../tao-cli/cli-src/test-command`.
   Promote into public entries or document.
7. **Grouped-helpers pass**: the real "focused module surface" violations are the big Studio/TR
   surfaces (`TaoStudioProductHost.tsx` at 91 exported bindings, `TR-data-registry.ts` at 17) —
   fold into the Part 3 splits rather than a repo-wide sweep. Error-style: convert raw
   `throw new Error` to `Errors.*` opportunistically in studio/dev only; runtime's raw throws are
   its own sanctioned convention.

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
  suite"; document the implemented `?` optional marker and `required "<sentence>"` trait. Consider
  removing the four consumer-less grammar traits (`touch on change`, `ordered`, `search`, `device`)
  from the grammar instead of documenting them — **Ro decision** (they may be staged Revolution
  surface; check Decisions.md §9 before touching).
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
- **`Tao Studio Development.md`**: reword "the root is not a usable page" (Welcome serves at `/` in
  every real launch); reconcile the smoke-lane section and recipe list with the Part 4 command
  consolidation; note the `studio-canary` defaults; `ELECTROBUN_SKIP_NOTARIZATION` stays but is an
  upstream-contract claim no repo code confirms.
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

1. **`TR.Errors`** — remove (and amend `Tao Actions.md`) or declare deliberate public surface.
2. **Legacy Studio client standalone dev fallback** — retiring `buildDirectClientBundle` +
   `StudioClient.ts` + every `embedded !== true` branch unlocks ~1,100–1,400 lines of
   embedded-dead DOM renderers plus their tests, and makes development fail loudly the way release
   already does. Product-behavior call.
3. **`tao dev` and the dev-loop machinery** (`expo-dev-loop`, TUI, file watcher, keyboard input) —
   Studio v2 bypasses it; it is reachable only through `tao dev`, which only `just dev` and README
   prose invoke. Keep as a supported phone-preview surface, or retire the subtree together. Also:
   the fate of `tao create`/`tao completion` as user-facing surface (both spec-promised; neither
   automated).
4. **One type system or two** — the hand-rolled structural `Type` does the work; the Typir bridge
   adds ~400 lines, two dependencies, and the collector indirection. Evidence favors retiring Typir
   onto `Type` eventually, but diagnostic wording is product surface. (A: keep both; B: retire
   Typir — L, behavior-affecting; C: invest in Typir.)
5. **Legacy root-view app form** — `isLegacyViewApp`/`compileLegacyViewApp`/`validateLegacyApp`
   carry a second app model labeled legacy that Decisions.md never mentions. Confirm no tranche app
   still needs `app X { view Y }` roots, then remove the dual pathway (or bless and rename it).
6. **`@runtime/TR-studio` subpath split** — keeps Studio/dev-menu code out of production bundles;
   needs a compiler emit change; schedule with a tranche.
7. **Preview compatibility copies** — the top-level generated copies exist only to be inspectable;
   dropping them halves preview write volume. Do you browse them?
8. **`just bench` / `./agent bench`** — the regression policy already runs in every test pass; is
   ad-hoc benchmarking still part of the workflow?
9. **`_runtime-pack-check` cadence** — daily lanes, verify-only, or release lane.
10. **Jest-e2e migration rule** (3.3) — adopt "jest e2e only for native overrides, generated-code
    shape, or harness self-tests; new behavior coverage lands in Tao"?
11. **React-element-harness tests** (2.2 step 8) — accept that the RN-test-renderer tier owns
    element-tree lowering and cut the ~200 monkey-patching lines?
12. **Shared-facade symmetry** — delete or bless `CLI.runSync`, `CLI.formatCommand`, `HCI.askText`,
    `Log.setTransport`; decide once per facade.
13. **"Rename UI to Scene"** roadmap entry — reword to what happened, or reopen?
14. **Grammar-only data traits** (`touch on change`, `ordered`, `search`, `device`) — remove from
    the grammar or keep as staged Revolution surface? (Check Decisions.md §9 first.)
15. **`generation` package rename** (e.g. `ai-generation`) — worth the churn to stop it reading as
    a pipeline stage?

## Part 8 — Execution order

Each phase is independently valuable; later phases assume earlier ones only where noted.

1. **Dead code** (Part 1) — one commit per group; no decisions needed except where marked.
2. **Environment quick wins** (4.2 parser-gen stamping, `_dependency-check` drop, 3.3 generated-run
   lifecycle + `just clean` coverage, 4.3 doctor checks) — these speed up every subsequent phase.
3. **Test-harness modules** (2.6) — land the shared helpers and the three package-local `test-*.ts`
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
