# Prompt - Plan Navigation Foundation And Core

Use the `project-3-write-project-plan` skill to write an implementation-ready plan for the active `Add navigation and routing MVP` task.

Read, in authority order:

1. `Spec/Tao Presentation and Navigation.md`
2. `Spec/Tao Type System.md`
3. `Roadmap/Add navigation and routing MVP/Research - Add navigation and routing MVP.md`
4. `Roadmap/Add navigation and routing MVP/.tao-future/Writer.tao`
5. `Roadmap/Add navigation and routing MVP/.tao-future/tao-navs.tao`
6. `Apps/MVP/.tao-future/Still.tao` and `Apps/MVP/.tao-future/@ui/ui.tao` only as the full target MVP. Its `Design` and `Datasource` capabilities remain target requirements but are not dependencies of this navigation foundation plan.
7. Current parser, formatter, scoping, validator, compiler, runtime, source-action, testing, and discovery seams relevant to the first scope

Plan only this implementation scope:

- Immutable `let` bindings with temporary deprecated `alias` compatibility; migrate only cases proven semantically equivalent.
- Owner-qualified declaration properties, optional/default normalization, zero-required contextual application, invocation binding, configured-value `with`, and the minimal closed-union grammar/assignability needed by `Presentable`.
- UI/nav descriptors, semantic/occurrence/mount identities, and extensible target IR.
- Stable declaration IDs based on the checked-in immutable logical project ID, package, module, declaration kind, and name; version the identity algorithm and retain dependency project identity across resolved revisions. Include canonical normalized non-keyed properties with deterministic recursive ordering, structural descriptor equality/hashing, and restorability validation. Do not implement keyed collection canonicalization or persistence I/O yet.
- The required app `Name`/`Navigator` schema, `run` of configured app values, app root hosting and operation compatibility, SlotNav, and StackNav.
- `present`, `replace`, and `dismiss` with contextual delivery, unique configured-descriptor targets, and the active app root target.
- A pure semantic reducer; source-operation and native-user-intent envelopes; separate revisioned/idempotent provider acknowledgements; the generated provider payload/callback boundary and unrealized-mount rejection behavior; partial-effect semantics for source-ordered failures; and native back reconciliation through shared TR APIs.
- The `file`/`package`/`workspace`/`public` vocabulary for declaration kinds required by this slice, with deprecated `project`/`publish` compatibility and a removal criterion. Leave the rest of the repository migration to FOLLOW-NAV-005.
- Focused diagnostics, formatter/source-action behavior, Test App coverage, and Kitchen Sink updates required by those features.

Do not include keyed collection syntax/scoping, app `Auxiliaries`, compiler-created keyed wrappers, Selection, Split, keyed/relative path segments, target-only activation, `Occurrence`, Overlay, Window, Toast, persisted restoration/routes, Dialogue, scenes, durable continuations, datasource implementation, or design-system implementation except as explicit follow-ups. Do not implement code. Use `WriterFoundationTest` as the deterministic in-between Slot/Stack app; do not require the full Still target app to compile during this slice. Write intended behavior tests before implementation steps, including zero-required contextual application, UI/nav branch-to-`Presentable` assignability, omitted/default equality, equivalent independent bindings, metadata versus semantic identity, configured app variants, root-operation incompatibilities, an origin removed before later contextual and explicit operations, stale native intents, provider rejection, and duplicate provider acknowledgements. Identify package ownership, migration order, executable root-view migration or temporary-bridge removal criteria, likely commit units, validation per step, and final `./agent just verify`. Stop after producing the reviewed plan and Roadmap update.
