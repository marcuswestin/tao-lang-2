# Now 1 - Unified Declaration Slots

Historical build slice, now landed. Every item below was settled in dialogue with no branch left
open. Companion to
`Implementation - Declaration model spike - Claude.md`, which this narrows to a priority-ordered build
list. Grammar facts verified against `main` at `6cfd88be` on 2026-08-14; re-verify line numbers before
starting, since concurrent work may have moved them.

## The rule being built

`is` narrows a type. `=` binds a value. `with { }` is the core type/value refinement operation. Bare
`{ }` may omit `with` only when constructing from a type; derivation from a value keeps it visible. A
declaration is complete when every **supplied** slot is filled — not derived ones (`render`, function
results, action bodies) — and only complete declarations can be used as values.

## Slices, in build order

Vertical slices per `packages/AGENTS.md`: parser, validator, formatter, source-actions, compiler
together, same feature name across all five.

### 1. Space-separate `TypeProperty`

`packages/parser/parser-grammar/types.langium:31-32`:

```
TypeProperty:
    name=ID ('is' type=TypeReference)?;
```

The type is already optional — repurpose that slot in item 2 below rather than dropping it. What
changes is the connector: move `Name is text` to `Name text`, matching
`ConfigurationPropertyDeclaration` (`configuration.langium:19`, already space-separated) and data
fields. This is two of three property syntaxes converging on one, not a new form. **Before touching
it, confirm what a bare `Name` (no type) currently means or resolves to** — nothing in this pass
should silently change existing behavior for that case.

This frees `is` inside a type block for item 3.

### 2. Slot-name elision

`{ Name text, Age }` means `{ Name text, Age Age }`. A one-token property entry resolves its name from
its type reference. Grammar: `TypeProperty` gets a form where only a type is present; binder infers
`name = type`'s simple identifier.

### 3. `is` as default-and-fill marker inside a type block

`Header ui is none` declares with a default; `implement is <expr>` fills. Build the grammar generically
for any RHS expression — do not couple this to what `implement`'s RHS resolves to. Sidecar file paths
for `implement` are `Now 2`'s concern, not this slice's; the inline `TS_CODE_BLOCK` form
(`configuration.langium:31-35`) keeps working unchanged here.

### 4. Type/value namespace separation

Required by item 5. The declaration binder keys by `(namespace, name)` where namespace is `type` or
`value`, so `let Person = { … }` can bind a value named `Person` without shadowing the type `Person`.
If the scope provider needs real restructuring rather than a key change, invoke the
`langium-scoping` skill rather than improvising around it.

### 5. Base inference for a bare `{ }`

Two rules, in priority order: (a) the target slot's declared type — `Datasource { StorageKey "…" }`
inside an app block; (b) the binding name matches a visible type name — `let Person = { … }`. Rule (b)
depends on item 4 landing first.

### 6. `with` derivation and monotonic narrowing

`Value with { … }` derives from a value. Reject any narrowing that reopens an already-filled slot back
to a type — narrowing runs one direction only, type toward value, never back.

### 7. Completeness checking

Every supplied slot filled → usable as a value. This subsumes the hand-written rule at
`Spec/Tao Presentation and Navigation.md:127` ("must be mountable without runtime arguments" for a
configured `Initial`) — once this lands, delete that sentence and point it at the general rule instead
of keeping two statements of the same constraint.

### 9. The prelude

`primitive` declarations as real, parsed, validated `.tao` — not prose. This slice introduced the
initial roots. The subsequent Next contract replaces the Prelude with the complete hierarchy in
`Apps/WordFlower/2 - Next/@tao-next/Prelude.tao-next`: `visual`, `presentable`, `view`, `layout`,
`frame`, `ui`, `nav`, `datasource`, `app`, and `design`, alongside the scalar roots. `layout` and
`frame` accept content intrinsically; they do not declare `Children` or `Layout` slots. During that
implementation slice the Next Prelude moves into `packages/stdlib/tao/Prelude.tao`, then the scratch
copy is deleted. The validator should ultimately read primitive contracts from the Prelude rather
than a hardcoded list.

## Deliberately excluded

These were deliberately excluded from this landed slice, but are no longer all open. Next settles
the visual/presentable hierarchy, `render inject`, intrinsic caller content, and primitive value
heads for `app`, `nav`, and `datasource` alongside universal `let`. It deliberately introduces no
stdlib `List`; collection rendering stays language-owned through `loop`. Sidecar `.ts` imports were
`Now 2`.

## Validation

`./agent verify` before every commit; re-measure the suite baseline first, concurrent work may have
moved the 14-suites/782-tests figure. Branch `feat/<name>`; never commit from detached HEAD. Preserve
work from other concurrent worktrees.
