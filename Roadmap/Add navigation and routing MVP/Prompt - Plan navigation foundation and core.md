# Prompt - Plan Navigation Foundation And Core

Status: historical planning prompt. The WordFlower Next tranche absorbed its executable foundation
subset; the active implemented contract is `Spec/Tao Presentation and Navigation.md`.

Use the `project-lifecycle` skill's Plan phase to write an implementation-ready plan for the active `Add navigation and routing MVP` task.

Read, in authority order:

1. `Spec/Tao Presentation and Navigation.md`
2. `Spec/Tao Type System.md`
3. `Roadmap/Add navigation and routing MVP/Research - Add navigation and routing MVP.md`
4. `Apps/WordFlower/2 - Next/WordFlower.tao-next` for settled upcoming product syntax
5. `Apps/WordFlower/3 - MVP/WordFlower.tao-mvp` as the full target MVP. Its `Design` and `Datasource` capabilities remain target requirements but are not dependencies of this navigation foundation plan.
6. `Roadmap/Add navigation and routing MVP/.tao-future/tao-navs.tao` for the proposed navigation standard-library surface
7. Current parser, formatter, scoping, validator, compiler, runtime, source-action, testing, and discovery seams relevant to the first scope

Plan only this implementation scope:

- Immutable `let` bindings; `alias` is retired, and only cases proven semantically equivalent migrate directly.
- Owner-qualified declaration properties, optional/default normalization, zero-required contextual application, invocation binding, configured-value `with`, and the minimal closed-union grammar/assignability needed by `Presentable`.
- UI/nav descriptors, semantic/occurrence/mount identities, and extensible target IR.
- Process-local semantic and occurrence identities sufficient for deterministic navigation during one app run. Stable project-derived declaration IDs, persistence, restoration, and routes remain follow-ups.
- The required app `Name`/`Navigator` schema, `run` of configured app values, app root hosting and operation compatibility, SlotNav, and StackNav.
- `present`, `replace`, and `dismiss` with contextual delivery, unique configured-descriptor targets, and the active app root target.
- A pure semantic reducer; source-operation and native-user-intent envelopes; separate revisioned/idempotent provider acknowledgements; the generated provider payload/callback boundary and unrealized-mount rejection behavior; partial-effect semantics for source-ordered failures; and native back reconciliation through shared TR APIs.
- The `file`/`package`/`workspace`/`public` vocabulary for declaration kinds required by this slice. Retire the former visibility words rather than carrying compatibility syntax.
- Focused diagnostics, formatter/source-action behavior, Test App coverage, and WordFlower/1 - Current updates required by those features.

Do not include keyed collection syntax/scoping, compiler-created keyed wrappers, Selection, Split, Window, Toast, persisted restoration/routes, stable project IDs, Dialogue, scenes, durable continuations, datasource implementation beyond configured app mounting, or design-system implementation except as explicit follow-ups. The WordFlower Next tranche separately adds app-keyed OverlayNav auxiliaries and strict keyed targets. Do not implement code. Use `WordFlowerFoundationTest` as the deterministic in-between Slot/Stack app; do not require the full WordFlower target app to compile during this slice. Write intended behavior tests before implementation steps, including zero-required contextual application, UI/nav branch-to-`Presentable` assignability, omitted/default equality, equivalent independent bindings, metadata versus semantic identity, configured app variants, root-operation incompatibilities, an origin removed before later contextual and explicit operations, stale native intents, provider rejection, and duplicate provider acknowledgements. Identify package ownership, migration order, executable root-view migration or temporary-bridge removal criteria, likely commit units, validation per step, and final `./agent verify`. Stop after producing the reviewed plan and Roadmap update.
