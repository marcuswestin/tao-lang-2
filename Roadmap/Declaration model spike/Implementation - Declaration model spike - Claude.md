# Implementation - Declaration Model Spike

Draft for review. Records the decisions Ro settled in design dialogue on 2026-08-14 that are ready to
build, and the collisions they create with scheduled work. Grammar claims below were verified against
`main` at `6cfd88be`; re-verify before planning, since substantial work is landing concurrently.

Everything still unresolved lives in `Open questions - Declaration model spike - Claude.md`. Do not
guess at those; several of them would change the shape of what you build. Ask Ro if one blocks you.

## The model

One rule replaces the values/types/kinds distinction:

> A declaration is a named record of **slots**. `is` narrows a type; `=` binds a value. A declaration
> is **complete** when every supplied slot is filled, and only complete declarations may be used where
> a value is expected.

Types and values stop being separate categories and become two ends of one gradient — a value is a
type narrowed to a single inhabitant.

```tao
type Age      is number                        // value slot open  → a type
type Person   is { Name text, Age Age }        // `is { }` → base defaults to item
type Employee is Person with { Team text }     // narrow by adding a slot

let Years  = Age 37                            // type + fill
let Title  = "WordFlower"                      // fill alone, type inferred
let Marcus = Person { Name "Marcus", Age 37 }
let Ro     = Employee Marcus with { Team "Language" }
```

Three sub-rules carry most of the weight:

- **`{ }` after a type constructs; `with { }` after a value derives.** This preserves the
  construction/derivation distinction rather than collapsing it, and is what lets the type be omitted.
  `LANG-006` already records this as partly settled.
- **The head decides the block.** Under `type`, entries declare slots. Under `let` or a primitive
  head, entries fill them. Inside a type block, `is` marks a default or a fill.
- **Slots are supplied or derived.** `Initial`, `Name`, `implement` are supplied — someone hands you a
  value. `render`, a function's result, and action bodies are derived — expressions over the other
  slots. Completeness counts only supplied slots.

```tao
type StackNav is nav with {
   Initial ui                       // declare
   Header  ui is none               // declare with default
   implement is "./StackNav.ts"     // fill
}
let HomeStack = StackNav { Initial WorkspaceList }
```

### Primitives

Primitives are opaque: named, ordinary-looking, resolvable, but not definable in Tao because nothing
above them exists to define them with. Users create new *types* over primitives, never new primitives.
They are written down in a pinned prelude:

```tao
primitive item
primitive number
primitive text
primitive boolean

primitive nav        with { implement }
primitive datasource with { implement }
primitive app with {
   Name       text
   Navigator  nav
   Datasource datasource
}
```

Operators stay compiler magic — `+` on `number` is not a slot, and making it one would require adding
operator declarations to the language. The prelude documents the shape of every primitive and leaves
arithmetic as the one honest gap.

### Also settled, recorded so it is not relitigated

- **`ui` gets an open `implement` slot.** `Text`, `Col`, `Slider`, `ScrollView` and the rest become
  ordinary `@tao/ui` declarations rather than compiler-known names, and a user can write an equivalent
  with the same mechanism and no privilege. This resolves `LANG-016` toward its third option. The
  *direction* is settled; the mechanics are not, which is why it is absent from the build list below.
- **`function` and `action` keep their own heads.** The unified form is strictly worse to read —
  `function DocumentLabel Title is text returns text = "…"` beats spelling the result as a derived
  slot. This is the one place ergonomics is allowed to beat uniformity.
- **`data` is not `item`.** Data types are persisted and stay a distinct primitive, with an
  `implement` slot reserved for stores other than the built-in one.
- **`ui Name <params> <layouts> { … }` keeps its current surface shape** as sugar over the slot form.
  Ro's position is that the reading and writing ergonomics matter more than surface uniformity here.

### Sidecar implementations

The protocol an `implement` slot expects is determined by the primitive you derived from and is never
written in Tao. `NavKind` traffics in mutable mount handles and React elements; naming it in Tao would
import React's ontology into a type system built around frozen, structurally-comparable descriptors.

```tao
type StackNav is nav with {
   Initial ui
   implement is "./StackNav.ts"
}
```

```ts
import type { NavKind } from '@tao/runtime'
import type { StackNavConfig } from './StackNav.tao'   // compiler-emitted

export default function StackKind(): NavKind<StackNavConfig> { ... }
```

The `.tao` declaration emits a `.d.ts` for its own config shape; the sidecar imports it and implements
against it. Tao owns the data contract, TypeScript owns the behavior, `tsc` checks the join
statically, and `TR.testNavKind` still checks it dynamically. That is strictly more guarantee than the
current inline `implement inject nav ```ts …``` ` form can offer, and it is what makes third-party
declarations practical rather than merely permitted.

## What already exists

Verified in `packages/parser/parser-grammar/`. More of this is built than the dialogue assumed.

- `types.langium:20` — `visibility? 'type' name=ID 'is' type=TypeExpression`. **`type Age is number`
  and `type Person is { … }` already parse.**
- `types.langium:28` — `ItemTypeExpression: '{' properties+=TypeProperty* '}'`, so `is { }` with an
  implied `item` base is already the shape.
- `types.langium:32` — `TypeProperty: name=ID ('is' type=TypeReference)?`. The type is **already
  optional**, which is the grammar slot slot-name elision needs.
- `types.langium:25` — `UnionTypeExpression` already parses `type Presentable is ui | nav`.
- `aliases.langium:11` — `keyword=BindingKeyword name=ID '=' value=Expression` with `BindingKeyword`
  returning `'let'`. **`let X = <expr>` already parses**, and the rule is already shaped for more
  binding keywords.
- `configuration.langium:19` — `ConfigurationPropertyDeclaration: name=ID type=…`, **space-separated**,
  matching both the settled syntax and existing `data` fields.

And, importantly, what does *not* exist: `configuration.langium` has **no `= <base>` derivation and no
`with`** for `nav` or `datasource`. Neither does `app.langium`. The derivation forms written across
`Apps/WordFlower/2 - Next` are unbuilt proposals, so the collision below is a plan change rather than
a code undo.

## What to build

Sliced so each lands independently. `packages/AGENTS.md` owns the boundaries — same feature name in
each participating parser, validator, formatter, source-actions, compiler, and runtime file.

**1. Unify property syntax on space separation.** `TypeProperty` currently uses `Name is Type`;
configuration properties and data fields already use `Name Type`. Move type properties to the
space-separated form so all three agree, which also frees `is` inside a block for its new job marking
defaults and fills. Two of the three syntaxes already agree, so this reduces forms rather than adding
one.

**2. Slot-name elision.** A one-token entry in a type block elides a slot name equal to its type:
`{ Name text, Age }` means `{ Name text, Age Age }`. The grammar's optional type in `TypeProperty`
becomes an optional *name* instead. Note this changes the meaning of an existing optional — confirm
nothing depends on the current type-less reading before repurposing it.

**3. `is` as default-and-fill marker inside a type block.** `Header ui is none` declares with a
default; `implement is "./StackNav.ts"` fills.

**4. Base inference for a bare `{ }`.** Infer from the target slot's type first, the binding name
second. Context covers `Datasource { StorageKey "ChatData" }` inside an app block; the name-matched
case covers `let Person = { … }`.

**5. Separate type and value namespaces.** Required by 4 — `let Person = { … }` binds a value named
`Person` while the type `Person` stays reachable, otherwise you shadow the type at the moment you use
it. `Design - Canonical descriptor identity - Claude.md` already assumes per-kind namespaces, so this
is consistent rather than new.

**6. `with` derivation on values, and monotonic narrowing.** `Value with { … }` derives; `Type { … }`
constructs. Narrowing runs one direction only — a slot that holds a value cannot be re-opened to a
type. This keeps completeness monotonic and descriptor identity straightforward.

**7. Completeness checking.** Every supplied slot filled. This subsumes an existing hand-written rule:
`Spec/Tao Presentation and Navigation.md:127` says a configured `Initial` "must be mountable without
runtime arguments," which is exactly completeness and should stop being stated separately.

**8. `.tao` → `.ts` sidecar imports.** `implement is "./X.ts"` replacing
`ConfigurationImplementation`'s inline `TS_CODE_BLOCK`, plus compiler-emitted `.d.ts` for the config
shape. Self-contained, needed regardless of how the open questions resolve, and the largest single
win in the set. Keep the inline form working until the sidecar form is proven.

**9. The prelude.** As a real `.tao` file the validator reads primitive slots from, not a prose
appendix — otherwise it drifts.

Deliberately not in this list: `ui` gaining an `implement` slot, `Children`/`Layout` becoming slots,
`data` gaining `implement`, and moving nav implementations out of `TR`. Each depends on an open
question. See the companion file.

## Collisions

**1. `Brief - Implement WordFlower tranche 4.md` has a superseded scope item.** It reads:

> **Declaration kinds** name configured values, replacing `let` for them: `Kind Name { … }` declares,
> `Kind Name = <value>` names or derives. The `AppValueDeclaration` union collapses to
> `AppDeclaration`.

`let` is **not** replaced — it survives as the value-binding head. `=` no longer connects a kind to a
base. Strike the item and replace it with a pointer here. Whether `nav X = …` remains legal alongside
`let X = …` is an open question, so do not assume either way.

**2. `Apps/WordFlower/2 - Next/WordFlower.tao-next:44-49` states the same superseded rule** in its
header comment and must be rewritten with it. The tier's own declarations follow the superseded form:
16 kind-headed declarations across the tier, 13 of them using `= <base>`, against 2 uses of `let`. The
rewrite is small but touches `WordFlower.tao-next` and `Foundation.tao-next`.

**3. `LANG-016 UI primitive boundary`** in `Deferred Tao language decisions.md` lists exactly the three
options this dialogue chose between, and Ro chose the third — "first-class native bridge components."
Update the row when the `ui` question closes, not before.

**4. `LANG-005` and `LANG-006`** are advanced by items 4 and 6 above. `LANG-006`'s "a type instantiates
with a bare block and `with` patches an existing value" is now the general rule rather than an
item-specific one.

## Constraints

- `packages/AGENTS.md` before editing `packages/`. Expected semantic and source-shape diagnostics
  belong in the validator; codegen assumes validated input.
- `Roadmap/Code cleanup spike/Report.md` holds the R1–R13 rulebook; it is the live quality bar.
- `./agent verify` before every commit. Branch `feat/<name>`; never commit from detached HEAD.
- Many worktrees share this repo and other agents work concurrently — preserve changes you did not
  make, and do not touch the Git index unless Ro asks.
- `Roadmap/Archive/` is frozen.
- Ask Ro on language semantics and ambiguous product behavior. Resolve routine implementation choices
  from repository evidence.
