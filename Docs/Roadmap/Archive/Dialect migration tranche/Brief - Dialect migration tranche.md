# Brief - Dialect migration tranche

Implementation brief: findings and constraints, not a plan. Devise the plan yourself. Re-verify
every grammar and repository seam against the live checkout before beginning — the grammar facts
below were read from `packages/parser/parser-grammar/` on the day this brief was written.

This is **Process step 1** of `Docs/Roadmap/Tao Revolution/Process.md`: the first tranche of the Tao
Revolution program, whose job is to move every spelling the language already has onto the decided
dialect so that everything written afterward is written once. `Apps/WordFlower/README.md` owns the
tranche mechanics and is the first thing to read; `Docs/Roadmap/Tao Revolution/Decisions.md` is the
authority for every spelling named here — its _Migrations from what ships today_ section is this
tranche's checklist, and its §2, §8, §15, and §16 are the sections to cite in the Next contract.

## Scope

The tranche is mechanical on the app side and real work on the toolchain side. It carries no new
capability; it respells existing ones. Every item below is a Migrations-section entry or a direct
consequence of one:

1. `enum Name { Cases }` → `type Name is one of A, B, C` (cases may be text literals); the inline
   form `is one of …` wherever a type goes; `yes / [Alias] no` as a type expression, with the alias
   moved **before** `no` (Decisions §2), which also deletes a lexer hack — see the findings.
2. Leading `optional Field Type` → postfix `Field Type?`, with every other trait in one trailing
   parenthesized list, for entity fields, item fields, and parameters alike.
3. `Name is Type` in parameter lists → juxtaposition `Name Type`, with `is` reserved for
   `type … is …` and predicates.
4. `implement inject provider|nav "./X.ts"` and inline `ts` fences → the `<expression> from <path>`
   expression; named exports only.
5. Test steps select by visible text or `#tag` only: `press "New recipe"`, `enter "…" into #tag`,
   `expect text "…"`; journeys are `test "sentence"` (the `check "…"` journey spelling is retired
   and `check` becomes only the early-exit statement in actions).
6. Unit literals as accessors on numbers (`10.px`, `1.s`) and decimal numbers, because §2's unit
   rules and §13's design tokens are spelled that way and the parser cannot currently lex either.

Out of scope: any new capability (intents, `@tao/time`, design blocks, `publish`, …). Those are
later tranches; this one only makes the ground they land on speak the final dialect.

## Grammar findings from the spike

**The spike was implemented, not only read.** Every decided spelling below was added to the live
Langium grammar, the parser regenerated, and probes run; the working grammar diff is preserved as
`grammar-spike.patch` beside this brief, and the probe file as `dialect-spike.test.ts.txt`. The
grammar changes were then reverted, because a half-migrated grammar cannot be committed — the
tranche re-applies the patch and does the source migration in the same change.

**Headline: the grammar work is small and carries no ambiguity. The migration is the cost.** With
all seven spellings in the grammar, `langium generate` reported no ambiguity warnings and all seven
probes parsed. Applying the patch and running the full suite then produced **243 failing tests** —
every one of them existing source in the retired spelling, not a grammar defect.

Reproduce in about ten minutes: `git apply "Docs/Roadmap/Dialect migration tranche/grammar-spike.patch"`,
copy the probe file to `packages/parser/parser-tests/dialect-spike.test.ts`, `just _parser-gen`,
`bun test parser-tests/dialect-spike.test.ts`.

### Answered by the spike

- **Juxtaposed parameter types — confirmed, no lookahead problem.** `ParameterTypeDeclaration` with
  `'is'` dropped (`name=ID type=TypeExpression`) parses `(Link text)`, `(Message text, Tone Tone)`,
  `(Recipe)`, and mixed lists. Chevrotain distinguishes the bare-name and name-plus-type forms
  without help.
- **The `action (optional)` ambiguity — moot, and the spelling changed.** It parsed cleanly with a
  trailing `TraitList`, so there was never a parser problem; but Ro replaced the spelling anyway,
  because a parenthesis directly after an action type reads as that type's parameter list to a
  _human_. Optionality is now a postfix `?` (`Press action?`, `Meal?`, `Photo text?`), verified
  parsing on parameters and item fields. Every other trait keeps the parenthesized list.
- **`returns item { … } { body }` — confirmed deterministic.** Widening `returns` to `TypeExpression`
  is sufficient; the adjacent braces parse with no separator keyword, exactly as Decisions §2 argues.
  Note `ActionDeclaration` still has no `returns` clause and needs one for §15.
- **`from` as a lowest-precedence expression — parses, but linking is the real work.** A postfix
  `('from' path=USE_IMPORT_PATH)?` on the expression root coexists with `use X from @pkg` and
  `query … from` with no conflict, and `USE_IMPORT_PATH` already lexes bare `./File.ts` and
  `@tao/time`. **The unresolved question is scoping, not syntax:** names arriving through `from`
  (`DefaultConfig from ./Config.ts`) are not local declarations, so the linker reports them
  unresolved. The tranche must teach the scope provider that a `from` expression binds its free
  names to that module's exports — plan for scope-provider work (`langium-scoping` skill), not just
  grammar.
- **`1.ms` beside `1.5` — confirmed with two coordinated changes.** `NUMBER` widened to
  `/[0-9]+(\.[0-9]+)?/` lexes `1.5` whole while leaving `1.ms` as `NUMBER '.' ID` (the optional
  decimal group cannot match `.m`), and a postfix member access inserted between `UnaryExpression`
  and `PrimaryExpression` carries `1.ms`, `1.5.s`, and `Wait.s` through one rule. No conflict with
  the existing reference-only `MemberAccessExpression`.
- **`type X is one of …` — confirmed**, including text-literal cases (`one of "g", "kg"`).
- **`yes / no Alias` — a trap found by running it, then designed away.** With the alias trailing,
  it cannot be `ID`: `packages/parser/parser-src/tao-token-builder.ts` unshifts a contextual
  `BOOLEAN_NO_ALIAS` token _ahead of every keyword and `ID`_, matching any word that follows
  `yes / no` on the same line, so `negativeName=ID?` fails with "Expecting end of file". Rather than
  propagate that hack to every new yes/no site, Ro moved the alias before `no`
  (`Shared yes / Private no`, Decisions §2). Verified: with `'yes' '/' negativeName=ID? 'no'` the
  keyword terminates the alias, the contextual token is **deleted** — grammar terminal and token
  builder both — and `Favorite yes / no`, `Shared yes / Private no`, and multi-field blocks all
  parse.
  **One residual, characterized by test:** a keyword-valued alias no longer works. `Private`,
  `Draft`, `Stopped`, `Name`, `Title`, and `Value` all parse; `text`, `number`, `time`, `item`,
  `view`, `app`, and `data` do not. That is the ordinary "identifiers may not be reserved words"
  constraint, and it removes the old comment's worry about `Name` specifically. Removing the token
  leaves `matchBooleanNoAlias` and its helpers unused in the token builder — delete them with it.

- **`item` in type position — decided against, on evidence.** Decisions originally wrote
  `type RecipeDraft is item { Foo, Bar }`. Verified that `item { Foo: 1 }` already _constructs an
  item value_ (`TypedConstructor` over `ConstructablePrimitiveType`), so requiring the keyword in
  type position would make the same characters denote a type or a value depending on position —
  the collision that ruled out `Name: Type` in parameter lists. Verified that the bare form parses
  in both type positions that matter (`type Job is { Title text }` and
  `function F() returns { Foo text } { … }`). Decisions §2 is amended: **no `item` keyword in type
  position**, and the shipped bare-brace spelling stands, which removes this item from the
  migration entirely.

### Still to be sized by the tranche

- **Retiring `EnumDeclaration` and `EnumCase`.** `EnumCase` is referenced as a `ValueDeclaration`,
  a `CaseDeclaration`, and the `respond` target in `actions.langium`; cases of a `type … is one of`
  must take over all three roles. The spike added the type form without removing the enum, so this
  is unmeasured.
- **Test selectors.** `tests.langium` has `TestDeclaration` and a `CheckDeclaration` twin, and
  `PressTextStep: 'press' selector=TestSelector text=STRING`. Make the selector word optional and
  retire `CheckDeclaration` (journeys are `test "…"`, Decisions §16). Not probed.
- **Formatter, validators, source actions, and compiler** follow every rule change above; the spike
  touched only the grammar.

## Outcome — tranche closed

Branch `feat/dialect-migration-tranche`. The absorption gate is met: `2 - Next` and `1 - Current`
hold the same file set with byte-identical content after status normalization, both are `absorbed`,
and `./agent verify` is green at 999 tests. **Landed:**

- **The grammar is fully migrated** and regenerates cleanly with no ambiguity warnings. All seven
  spellings plus the case-set replacement for `enum` are in; `BOOLEAN_NO_ALIAS` and its token-builder
  block are deleted; `CheckDeclaration`, `DataStatusStep`, `DataIndex`, and `EntityDataFieldModifier`
  are retired.
- **Every source package compiles** — `ast-utils`, `parser`, `validator`, `formatter`, `compiler`
  followed through: case sets fill the value / case-test / `respond` roles, traits replace modifiers,
  a case-set type compiles to its runtime cases, postfix member access and `now` are handled, and the
  sidecar validator now requires the **named** export the implementation cites.
- **Every `.tao` source is migrated, parses, and is canonical**: WordFlower Current, all Test Apps,
  and the stdlib — whose two inline `ts` fences became named-export sidecars
  (`packages/stdlib/tao/data/Providers.ts`, `packages/stdlib/tao/nav/NavKinds.ts`).
- **The whole suite is green**: 338 failures → **0**. `./agent verify` passes at 991 tests, with
  typecheck and lint clean.

Two behaviours were narrowed deliberately rather than weakened: the validator's sidecar
**existence** and **export** checks, and the compiler's sidecar **copy**, all skip when a document is
synthetic and in-memory (no directory to read). Path-shape rules still apply everywhere, and real
filesystem compiles still assert — `just _compile-word-flower-app` exercises that path and passes.

Three things the fixture migration turned up were real defects, not fixture rot, and are fixed:

- Sidecar paths resolved against the _importing_ file, so a derived declaration reusing an imported
  base's implementation looked for the sidecar in the wrong directory.
- The compiler emitted a **default** import for sidecars while the validator required a **named**
  export — the two halves of the boundary disagreed.
- Folding `enum` into `type X is one of` made case sets `TypeDeclaration`s, which
  `declarationEmitsRuntimeBinding` erases, so an imported case (`ConfirmResult.Confirmed`) resolved
  against `undefined` at runtime.

One capability was lost rather than migrated: `data <status>` is retired by §16 and the world
controls that replace it have not landed, so the Data MVP check that drove a provider through
`loading`, `error`, and `ready` is gone. This is recorded against the fault-injection row in
`Coverage.md`.

**Closed since:**

1. **`2 - Next` regenerated from Current** and marked `absorbed`, which is the gate.
2. **`Docs/Spec/` reconciled**: the sidecar contract now reads `nav|provider <Export> from <path>` with a
   named export, and the settled spellings and the case set that replaced `enum` are throughout.
3. **`3 - MVP` and `4 - Revolution` reconciled** in one pass, per the synchronization rule. Those
   tiers use their own extensions, so nothing parses them: the edits were made by inspection against
   `Decisions.md`, not verified by the toolchain.
4. **Behavior tests**: the four WordFlower journeys are written in the decided dialect and pass, and
   `packages/parser/parser-tests/dialect.test.ts` guards fifteen spellings directly.

Work that grew out of the tranche rather than belonging to it — folder and package organization,
ambient navigation targets, the modal dialogue and toast surfaces — landed on the same branch and is
described in its commits.

Migration scripts used are disposable and were not committed; the substitutions they performed are
described in _Scope_ above and visible in the commits.

## Resolved since the spike

The six questions this brief opened are closed; each answer is now in `Decisions.md`, and the
consequences for this tranche are:

1. **The trait vocabulary is enumerated** (§2): a closed nine-trait table with argument shapes —
   `default <expr>`, `relation <Entity>`, `required "<sentence>"`, `touch on change`, `owned`,
   `ordered`, `unique`, `index`, `search`, `device`. The grammar takes the closed list; **which
   trait is legal where is a validator rule**, not a grammar one (`owned` on relations, `device` on
   preferences). The spike's permissive `name=ID value=Expression?` placeholder must be replaced by
   the closed list.

   `relation` was briefly dropped during implementation, on the reading that §2's juxtaposition
   (`Person Account`) covered differently-named relation fields. It does not: inside a `data` block
   fields are separated by layout alone, so `Workspace` / `Paragraphs (owned)` on two lines reads
   equally as one field or two and the grammar has no newline sensitivity. Ro ruled the trait stays,
   required only when the field name differs from the entity, and §2 now records why.
2. **The parenthesized trait list belongs to `data` declarations only.** Parameters take no trait
   list — a default keeps its existing bare spelling, `view Status(Message text, Tone default
   Neutral)`, which means **`ParameterDeclaration`'s shipped `'default' defaultValue=Expression`
   clause survives unchanged**; only `is` leaves it. Item fields take `?` and nothing else. A slot
   is optional _or_ defaulted, never both — a validator diagnostic.
3. **A case fills three roles and the tranche must prove all three** (§2 shows the code): a case is
   a _value_ (`let Fallback = Dinner`, `create Meal { Course: Dinner }`), a _case-test target_
   (`when Recipe.Course is Dinner`), and a _dialogue answer_ (`respond Confirmed`). In the grammar
   those are `ValueDeclaration`, `CaseDeclaration`, and `RespondStatement`'s `[EnumCase:ID]`; the
   new case node must be admitted to all three unions. Cases share the value namespace, so a
   duplicate case name across two case types in one module is a new diagnostic.
4. **Tests nest, `select` stays, `data <status>` is retired.** Nesting needs **no grammar change** —
   verified that `test "outer" { test "inner" { … } }` already parses, because `TestDeclaration` is
   reachable from `Block`. The work is semantic: an inner test inherits its parent's fixture and
   device, and its sentence reads as a continuation. `CheckDeclaration` is deleted. `DataStatusStep`
   is deleted, and with it the only way a test drove a provider into `loading`/`error` — the world
   controls and fault injection cover what remains.
5. **`from` lands only where it replaces `implement inject`.** The settled spelling is a property
   name plus the expression (§15): `implement inject provider "./Local.ts"` becomes `provider
   LocalProvider from ./Local.ts`, and `implement inject nav "./StackNav.ts"` becomes `nav
   StackNavImpl from ./StackNav.ts`. Both `implement` and `inject` leave the language. **General
   expression-position `from` is deferred** — it serves the TypeScript-boundary capability, and its
   scope-provider work belongs to that later tranche. This tranche therefore does not touch the
   scope provider, and the spike's `FromExpression` rule is trimmed to the binding sites.
6. **The contract replaces `2 - Next`'s contents.** The tranche aligns Next with the decided
   dialect, carrying forward whatever of the current open tranche still applies.

## Collisions and constraints

- **Current and Next must both be respelled, and `Docs/Spec/` with them.** The absorption check compares
  Current and Next byte-for-byte after the status line; the contract is the Next diff, and Current
  is moved to match slice by slice. Every `Docs/Spec/` page that shows a retired spelling is reconciled
  in the same tranche (Process step 1 names them) — `Docs/Spec/Tao Type System.md` (enums, `optional
  Field Type`, `type Name is Base with`), `Docs/Spec/Tao Data.md` and `Docs/Spec/Tao Packages.md`
  (`implement inject provider`), `Docs/Spec/Tao Presentation and Navigation.md` (`implement inject
  nav`), and `Docs/Spec/Tao Testing.md` (selectors).
- **The migration is the tranche, and it is measured: 243 failing tests** with the grammar patch
  applied, across parser, compiler, validator, formatter, and app suites. By error frequency the
  cost is dominated by one item — parameter lists: `Name is Type` accounts for **1,056 of the parse
  errors** (`Expecting ')' but found 'is'` and `Expecting '(' but found 'is'`), with leading
  `optional` a distant second. Most remaining error classes are cascades after the first failure in
  a file, not independent causes. Consider a scripted respelling with a review diff rather than
  hand edits; `Apps/Test Apps/` and WordFlower's tests are the bulk.
- **`Apps/Tao Future/` is not in scope.** Those sources are pre-consolidation by declaration
  (`Apps/Tao Future/README.md`); they are aligned at Process step 3, not here.
- **Decisions win.** Where a `Docs/Spec/` page, `2 - Next`'s current header, or an older roadmap note
  disagrees with `Decisions.md`, do not reopen the decision; respell to it and reconcile the page.

## Definition of done

Process.md's tranche definition of done applies in full: the Next contract cites Decisions §2, §8,
§15, §16 for the slices above; Current is respelled slice by slice with parser, validator,
formatter, compiler, and runtime following; **the spike's probes are promoted to permanent parser
tests** (the `action (optional)` line, the `from` sites, `1.ms` beside `1.5`, `returns item { … } {`,
and the `yes / no Alias` token trap); behavior tests written in Tao are green in Current for every
respelled construct; the `Docs/Spec/` pages above are reconciled; `Coverage.md`'s _pending dialect
tranche_ rows flip to their test status; Current ≡ Next byte-identical with both statuses
`absorbed`; `./agent verify` green.
