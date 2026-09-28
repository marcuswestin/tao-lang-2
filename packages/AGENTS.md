# Working Across Packages

Implement language features as vertical slices. Use the same focused feature name in each participating parser, validator, formatter, source-actions, compiler, and runtime file; do not add empty stages or catch-all modules.

## Ownership

- Put expected Tao semantic and source-shape diagnostics in the validator. Compiler codegen assumes validated input and uses assertions only for local type contraction.
- Every diagnostic sentence lives in a `*ValidationMessages` object beside the validator that emits it, so validators never inline one at the `ctx.error(node, message)` call and tests assert through those same factories rather than retyping the text.
- Use `AST.*` from `@parser` for parser-owned structure and traversal. Put shared semantic helpers in `@ast-utils`; package consumers must not call Langium AST utilities directly. `packages/language/parser/AGENTS.md` owns scoping and grammar-keyword rules.
- Use shared `Switch` helpers for union dispatch instead of native `switch`; prefer generated `AST.is<Type>` guards for grammar-declared unions. `repo-lint` rejects an if/else-if chain over one discriminant outside its shrinking allowlist. A wire union dispatches with `Switch.on(message, 'type', handlers)` and ignores a branch with `Switch.nothing`; every `Switch` form reads own keys only.

## TypeScript and tests

- Put a disposable TypeScript diagnostic under `packages/<package>/.scratch/` and run it from the repository root with `bun run packages/<package>/.scratch/<script>.ts`. The directory is ignored, and its package location preserves that package's TypeScript aliases and workspace dependency resolution. Do not use it for tests or source that should land.
- Use shared wrappers such as `CLI`, `FS`, `HCI`, `Platform`, `Time`, and `@shared/test` instead of direct platform or test-runner APIs. Loader-constrained config files are the narrow exception.
- Search `@shared` for an existing helper before adding one, and put a helper two packages need in `@shared` rather than in both. Where a copy must exist because `packages/apps/runtime` imports nothing from `@shared`, name the shared original it mirrors and keep the two in step.
- Keep each module's public surface focused on one main concept. Export helpers only for real cross-file or package boundaries.
- Prefer behavior tests.
- A wall-clock budget in a test is for a busy host, not for a slow condition: `until` defaults to 30s for exactly that reason (`pollUntil` has no default; its `timeoutMs` is required), and `repo-lint`'s `TestBudgetConventions` rejects a shorter explicit `timeoutMs`, a `toBeLessThan`/`toBeLessThanOrEqual` speed assertion on elapsed time, or a `Promise.race` against a bare sleep, unless the line, or a comment-only line above it, carries `// budget-ok: <reason>`.
- A jest end-to-end test in `expo-host` earns its place only when it needs a native or module override, asserts generated-code shape, or exercises the harness itself. New behavior coverage lands in Tao as a `.test.tao` journey; existing jest suites migrate opportunistically when touched. Do not schedule a wholesale rewrite.
- `./agent dead-exports` fails on exports nothing imports and runs in `verify` and `verify-full`; `removing-code` owns the fix pattern.

## Errors

- Never write `throw new Error(` or `new Error(` — `repo-lint` bans both outside a shrinking per-file allowlist (emitted script text and tests that feed a raw error in).
- Classify by where the checked value came from: an invariant something upstream should have guaranteed is `Assert(...)` / `Assert.defined(...)` / `Errors.throwUnexpected(...)`; the Tao author's own data or contract being wrong is `Assert.input(...)` / `Errors.throwUserInput(...)`; a failed device, native module, subprocess, or host capability is `Errors.throwHostEnvironment(...)`. Where an error object must exist unthrown (a rejection, an emitter, a callback), build `new Errors.<Category>Error(...)`, wrap an unknown with `Errors.asError`, and cancel with `Errors.abortError`; `packages/apps/runtime` uses `TR-errors` the same way.
- The category decides what the reader sees, so it is a product judgment, not a mechanical rewrite: a Tao developer must be able to tell whose mistake an error reports, and should never meet a bare JavaScript error string or a leaked internal or framework type name. Let an existing finished author-facing sentence stay that sentence; only a genuine invariant is reworded into `Expected: …`.
- `Assert` and `Assert.input` take a plain `asserts condition` and narrow accordingly; `Assert.defined` keeps `asserts value is NonNullable<T>`. A `never`-returning call (`Errors.throwUnexpected` and its siblings) narrows what follows it, including through a property chain, but only when every link in the chain carries an explicit type annotation — reach for that before rewording a message to fit `Assert.defined`. Introducing an assertion call into a function can force explicit type annotations on inference-dependent `const`s — the compiler error says which; annotate locally rather than abandoning the assertion. On a render-hot path whose message is not constant-time, keep a guarded typed throw and say why at the site, since `Assert` builds its message eagerly.
- Only the three leaf modules in `packages/shared/shared-src/core` construct the error classes; throw through `Errors.throwUserInput(...)` / `throwUnexpected(...)` / `throwHostEnvironment(...)` elsewhere, never `throw new Errors.<Category>Error(...)` or a bare `throw new <Category>Error(...)`.
- Warn through a shared policy rather than an inline production guard: something failed and was swallowed is `warnContainedFailure` (takes the error); nothing failed but the platform cannot honor a declaration is `warnDesignDivergence` (takes only a sentence).
- Preserve user-facing wording when converting an existing throw; prove parity by capturing ordered diagnostics before and after, not by observing that tests pass.

## Vocabulary

- provider: configurable contract implementation. bridge: binds Tao code to a TypeScript value. adapter: fits an external system to a Tao contract. test driver: operates Appium/Playwright for `host-control`. service: long-running process answering requests. TypeScript implementation: a stdlib `.tao` declaration's TypeScript file.
- A top-level `packages/` folder is a package or a group; found by its `package.json`, at depth one, two, or three. The root workspace globs are `packages/*`, `packages/*/*`, and `packages/apps/providers/*`. A new third-level group needs its own glob: `packages/*/*/*` also matches installed dependencies under `node_modules`.
