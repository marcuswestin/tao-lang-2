# Report - Patch Conventions

## Source Reviewed

- Current working-tree patch against `HEAD`.
- The surrounding chat thread for review feedback and convention corrections.
- Root and package instructions that were read or updated during the patch.

Status note: this report describes the current uncommitted working-tree shape as evidence for conventions to preserve. Before encoding a convention as a durable instruction, re-check that the underlying code outcome is still present in the final patch.

## Conventions Applied Or Strengthened

### Exhaustive Dispatch

- Use shared `Switch` helpers instead of native `switch` for typed, enum-like, kinded, or property-based branches.
- Prefer `Switch.type` for AST-node dispatch and `Switch.kind` for discriminated unions.
- Keep `AST.is*` checks for filters, tests, and local assertions where union dispatch is not the real operation.
- Instances in this patch include layout merging/resolution, code-review planner/invocation, dev/test TUI status rendering, runtime test worker protocol handling, and test-manifest step execution.

### One Concept Per Module Surface

- Prefer one main concept export per module: a named const object, default export, focused function, or class.
- Avoid long import lists from one file. If callers repeatedly need several names, group the surface behind a concept object and keep private helpers private.
- Keep type exports separate only when TypeScript needs them as types.
- Instances in this patch:
  - `DashboardGrid` became a callable grouped concept with layout helpers attached.
  - `InPlaceFiles` groups Tao CLI in-place file helpers.
  - `Compiler.TestPlan` replaced broad re-export of Tao test IR types from `@compiler`.
  - `RuntimeTestCompilerWorker` exposes a smaller object API.
  - `TestRunner` imports `@shared` as a namespace instead of importing many shared names.

### Concept Folders

- When several files implement one concept or mode family, put them in a subfolder named for the concept.
- Instance in this patch: `TestRunner.ts` and `TestTUI.ts` moved under `packages/dev/dev-src/dev-loop/test-runner/`.
- This keeps `dev-loop/` from becoming a flat mix of app-loop, dashboard, keyboard, Expo, and test-runner files.

### Minimize Exports

- Export only real cross-file or package-boundary APIs.
- Remove pass-through re-exports, mirror types, aliases, and private helpers made public for convenience.
- Instances in this patch:
  - Runtime compile/render test helper exports were narrowed.
  - `compileAppForTest` became private.
  - unused Tao runtime test step aliases were removed.
  - worker-side `compileTaoTestPlans` public path collapsed to `compileTaoTestPlan`.

### Context And Options Naming

- Use `Context` for invocation state that defines what the invocation is.
- Use `Options` for toggles, defaults, and optional behavior.
- Keep contexts narrow and mostly required; avoid optional-heavy contexts that hide multiple APIs.
- Instance in this patch: runtime test compiler context remains in the CLI precompile path, while unused Jest worker context/cache plumbing was removed.

### Shared Wrappers And Human CLI IO

- Use shared wrappers (`CLI`, `FS`, `HCI`, `Platform`, `Repo`) instead of direct Node/Bun APIs in package code.
- Use `CLI.start` for long-running child processes and `CLI.run`/`CLI.mustRun` for completed commands.
- Use `HCI` for user-facing terminal output.
- Reserve `Platform.runtimeProcess` and `Platform.runtimeConsole` for low-level process plumbing and shared wrappers.
- Instance in this patch: test runner process execution uses shared `CLI.start`; line-mode output and summaries use `HCI`.

### File Discovery Ownership

- Shared `Repo.filesUnder` should be generic and Git-aware, not Tao-specific.
- Git ignore behavior should come from Git when inside a worktree.
- Non-Git fallback should not hardcode names like `_gen_`, `node_modules`, `ios`, or `android`.
- Caller-specific exclusions belong at the caller.
- Instance in this patch: `Repo.filesUnder` gained `excludeDirectoryNames`, and Tao CLI file discovery owns its own source exclusions.

### Tao CLI In-Place Processing

- `fmt`, `fix`, and `check` should share file read, transform, write/compare, and error-result mechanics.
- Instance in this patch: `processInPlaceFile`, `runOnTaoFiles`, and `workspaceRootForInPlacePath` are grouped as `InPlaceFiles`; `check` and `fix` route through `runCanonicalSource`.

### Runtime Test Boundary

- Keep Expo/Jest rendering focused on runtime rendering and interactions.
- Keep Tao parsing/validation/compilation out of the Jest process when that boundary is what keeps Jest config simple.
- Use an out-of-process compiler worker for Jest runtime tests.
- Keep CLI `tao test` compilation/prebuild in the CLI/runtime compiler side.
- Instance in this patch: worker protocol was simplified to a singular `taoTestPlan` request with no compiled-app cache serialized through Jest.

### Tao Test IR

- Test IR should model ordered `steps`; do not keep duplicate fields such as old `expectations` arrays when the runner executes sequential steps.
- Instance in this patch: the `expectations` field and helper are gone; compiler tests assert ordered steps.

### Test Placement

- Prefer Tao-authored behavior tests for user-facing app behavior.
- Keep parser, validator, formatter, formatting, and internal code-shape coverage in TypeScript where that is the direct thing being tested.
- Put intended examples into `Apps/Test Apps/README.md` or roadmap task docs, not into Kitchen Sink until implemented.
- Instance in this patch: Test Apps gained Tao test files for implemented behavior, while package tests continue to cover parser/compiler/validator/CLI mechanics.

### Validation And Git Safety

- Use `./agent` for repo commands.
- Do not touch the Git index unless Ro explicitly asks in the current request.
- Use `./agent just verify` as final validation after code/instruction/workflow changes.
- Instance in this patch: validation was repeatedly run through `./agent`; index state was left Ro-owned even when file moves made staged status look awkward.

## Conventions That Should Become Stronger Instructions Or Automation

- One-concept imports should be linted or audited eventually; today it relies on review.
- Native `switch` should be audited automatically, with local exceptions only if documented.
- Concept-folder drift can be hard to automate, but review prompts should ask for it.
- Export minimization should be part of review and stale-repo checks after refactors.
- Tao CLI file-discovery exclusions should stay caller-owned; shared `Repo` should not regain hardcoded domain names.
