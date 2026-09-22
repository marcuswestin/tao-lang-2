# Implementation - Declaration Model Spike

Historical design record. It records decisions the Developer settled in dialogue on 2026-08-14 and the
collisions they created with scheduled work. WordFlower Tranche 4 subsequently resolved Q11:
reusable navigation and datasource types bind protocols with `implement inject nav|provider`, inline
or by sidecar path. The superseded `implement is "./X.ts"` proposal is not current Tao syntax.

Everything still unresolved lives in `Open questions - Declaration model spike.md`. Do not
guess at those; several of them would change the shape of what you build. Ask the Developer if one blocks you.

## The model

One model relates values, types, and declaration kinds:

> A declaration is a named record of **slots**. `is` narrows a type; `=` binds a value. A declaration
> is **complete** when every supplied slot is filled, and only complete declarations may be used where
> a value is expected.

Types and values retain distinct namespaces and roles but share one refinement model: a type may
leave supplied slots open, while a value is a complete instantiation with every required supplied
slot filled.

```tao
type Age      is number                        // value slot open  → a type
type Person   is { Name text, Age Age }        // `is { }` → base defaults to item
type Employee is Person with { Team text }     // narrow by adding a slot

let Years  = Age 37                            // type + fill
let Title  = "WordFlower"                      // fill alone, type inferred
let Marcus = Person { Name "Marcus", Age 37 }
let the Developer     = Employee Marcus with { Team "Language" }
```

Three sub-rules carry most of the weight:

- **`with` is the core refinement operation.** It derives types, constructs values from types, and
  derives values. `Type { ... }` may omit it as construction sugar; `Value with { ... }` must retain
  it so value derivation stays visible. `LANG-005` and `LANG-006` record the exact Next resolution.
- **The head decides the block.** Under `type`, entries declare slots. Under `let` or a primitive
  head, entries fill them. Inside a type block, `is` marks a default or a fill.
- **Slots are supplied or derived.** `Initial`, `Name`, `implement` are supplied — someone hands you a
  value. `render`, a function's result, and action bodies are derived — expressions over the other
  slots. Completeness counts only supplied slots.

```tao
type StackNav is nav with {
   Initial ui                       // declare
   Header  ui is none               // declare with default
   implement inject nav "./StackNav.ts" // fill the primitive protocol slot
}
let HomeStack = StackNav { Initial WorkspaceList }
```

### Primitives

Primitives are opaque: named, ordinary-looking, resolvable, but not definable in Tao because nothing
above them exists to define them with. Users create new _types_ over primitives, never new primitives.
They are written down in a pinned prelude:

```tao
primitive item
primitive number
primitive text
primitive boolean
primitive list
primitive time
primitive action
primitive design

primitive visual
primitive presentable is visual
primitive view is visual
primitive layout is visual
primitive frame is visual
primitive ui is presentable

primitive nav        with { implement }
primitive datasource with { implement }
primitive app with {
   Name       text
   Navigator  nav
   Datasource datasource is none
   Design     design is none
}
```

Operators stay compiler magic — `+` on `number` is not a slot, and making it one would require adding
operator declarations to the language. The prelude documents the shape of every primitive and leaves
arithmetic as the one honest gap.

The prelude above is the spike's original sketch. It is now a real, parsed, validated file at
`packages/apps/stdlib/tao/Prelude.tao`, carrying the fuller hierarchy WordFlower Tranche 4 settled
(`visual`, `presentable`, `view`, `layout`, `frame`, `ui`, `nav`, `datasource`, `app`, `design`
alongside the scalar roots) and later collapsed further (the unified view tranche folded `visual`,
`presentable`, `ui`, `layout`, and `frame` into one `view` primitive, with `nav` refining `view`).
`Open questions - Declaration model spike.md`'s Follow-ups section records how far validators read
their contracts from that file rather than a hardcoded mirror.

### Also settled, recorded so it is not relitigated

- **Visual declarations use `render`, not an `implement` slot.** A TypeScript-backed visual uses
  `render inject`; its returned element is the root. `TR`, `RN`, and `process` are always available,
  and every additional Tao binding is explicit. This lets stdlib and user-authored native-backed
  visuals share one mechanism without turning content or layout into declared slots.
- **`function` and `action` keep their own heads.** Next requires parenthesized parameter lists,
  including `()`. Functions are block-bodied, use `return`, and may omit an inferable `returns`
  annotation rather than spelling their result as a declaration slot.
- **`data` is not `item`.** Data types are persisted and stay a distinct primitive, with an
  `implement` slot reserved for stores other than the built-in one.
- **`ui Name(<params>) { … }` keeps its dedicated surface shape.** Its layout remains ambient at
  occurrences rather than becoming a property. The same mandatory parenthesized declaration list
  applies to `view`, `layout`, `frame`, `dialogue`, `action`, and `function`.

### Sidecar implementations

The binding clause explicitly selects the narrow `nav` or `provider` protocol; its TypeScript
implementation types remain outside Tao's value system. `NavKind` traffics in mutable mount handles
and React elements, so importing its ontology into ordinary Tao types would break the frozen,
structurally-comparable descriptor model.

```tao
type StackNav is nav with {
   Initial ui
   implement inject nav "./StackNav.ts"
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
current inline ` implement inject nav ```ts …``` ` form can offer, and it is what makes third-party
declarations practical rather than merely permitted.

As landed, the sidecar path resolves relative to the `.tao` file, imports its default export, and
wires it into the generated module the same way the inline TS block is spliced in. The validator
checks the sidecar file exists and, cheaply, that it has a default export; deeper conformance —
whether it actually implements `NavKind`/`DataProvider` — stays `TR.testNavKind`/`TR.testProvider`'s
job at runtime. Deliberately not built: any protocol-version negotiation between a sidecar and `TR`;
it stays single-version and implicit, as it is today. Moving `StackNav`/`Memory` out of `TR` into
`@tao/nav`/`@tao/data` waits on package resolution (`requires`, lockfiles, external workspace
installation, `Docs/Spec/Tao Packages.md`) — this work only added the capability to point at a
sidecar file, it did not move anything that ships today; see Q9 in the open questions.

## What already exists

Verified in `packages/language/parser/parser-grammar/` at the spike's start (2026-08-14). More of this was
built than the dialogue assumed, which shaped the plan below into a narrowing rather than a
from-scratch grammar.

- `types.langium:20` — `visibility? 'type' name=ID 'is' type=TypeExpression`. **`type Age is number`
  and `type Person is { … }` already parsed.**
- `types.langium:28` — `ItemTypeExpression: '{' properties+=TypeProperty* '}'`, so `is { }` with an
  implied `item` base was already the shape.
- `types.langium:32` — `TypeProperty: name=ID ('is' type=TypeReference)?`. The type was **already
  optional**, which is the grammar slot slot-name elision needed.
- `types.langium:25` — `UnionTypeExpression` already parsed `type Presentable is ui | nav`.
- `aliases.langium:11` — `keyword=BindingKeyword name=ID '=' value=Expression` with `BindingKeyword`
  returning `'let'`. **`let X = <expr>` already parsed**, and the rule was already shaped for more
  binding keywords.
- `configuration.langium:19` — `ConfigurationPropertyDeclaration: name=ID type=…`, **space-separated**,
  matching both the settled syntax and existing `data` fields.

And, importantly, what did _not_ exist: `configuration.langium` had **no `= <base>` derivation and no
`with`** for `nav` or `datasource`. Neither did `app.langium`. The derivation forms written across
`Apps/WordFlower/2 - Next` were unbuilt proposals, so the collision below was a plan change rather
than a code undo.

## What to build

Sliced so each lands independently. `packages/AGENTS.md` owns the boundaries — same feature name in
each participating parser, validator, formatter, source-actions, compiler, and runtime file. All nine
items landed, on `feat/declaration-model`, as vertical slices (parser, validator, formatter,
source-actions, compiler together, same feature name across all five).

**1. Unify property syntax on space separation.** `TypeProperty` used `Name is Type`; configuration
properties and data fields already used `Name Type`. Moved type properties to the space-separated
form so all three agree, which also freed `is` inside a block for its new job marking defaults and
fills. Two of the three syntaxes already agreed, so this reduced forms rather than adding one.

**2. Slot-name elision.** A one-token entry in a type block elides a slot name equal to its type:
`{ Name text, Age }` means `{ Name text, Age Age }`. The grammar's optional type in `TypeProperty`
became an optional _name_ instead.

**3. `is` as default-and-fill marker inside a type block.** `Header ui is none` declares with a
default; `implement inject nav "./StackNav.ts"` fills the protocol slot. This slice's original
proposal, `implement is <expr>`, was superseded by WordFlower Tranche 4's `implement inject
nav|provider` spelling (Q11, below); the grammar work itself stayed generic about ordinary default
and fill expressions.

**4. Base inference for a bare `{ }`.** Infer from the target slot's type first, the binding name
second. Context covers `Datasource { StorageKey "ChatData" }` inside an app block; the name-matched
case covers `let Person = { … }`.

**5. Separate type and value namespaces.** Required by 4 — `let Person = { … }` binds a value named
`Person` while the type `Person` stays reachable, otherwise you shadow the type at the moment you use
it. The declaration binder keys by `(namespace, name)` where namespace is `type` or `value`.
`Design - Canonical descriptor identity.md` already assumed per-kind namespaces, so this was
consistent rather than new.

**6. `with` derivation on values, and monotonic narrowing.** `Value with { … }` derives; `Type { … }`
constructs. Narrowing runs one direction only — a slot that holds a value cannot be re-opened to a
type. This keeps completeness monotonic and descriptor identity straightforward.

**7. Completeness checking.** Every supplied slot filled. This subsumed an existing hand-written
rule: `Docs/Spec/Tao Presentation and Navigation.md:127` said a configured `Initial` "must be
mountable without runtime arguments," which is exactly completeness and stopped being stated
separately once this landed.

**8. `.tao` → `.ts` sidecar imports.** `implement inject nav|provider "./X.ts"` complements the
inline `TS_CODE_BLOCK` form (which stayed working throughout — the shipped `StackNav` and `Memory`
declarations used it), with a compiler-emitted `.d.ts` for the config shape — the type of `config` in
`TR.NavKind<Profile, ConfigurationT>` or `TR.DataProvider`. Both forms use the same explicit protocol
binding; see _Sidecar implementations_ above for the landed mechanics.

**9. The prelude.** As a real `.tao` file the validator reads primitive slots from, not a prose
appendix — otherwise it drifts. Landed at `packages/apps/stdlib/tao/Prelude.tao`; see _Primitives_ above
for where the hierarchy stands now.

Deliberately not in this historical build list: the later Next work for the visual/presentable
hierarchy, intrinsic `@@content`, ambient `@@layout`, `render inject`, and the new stdlib surfaces;
those are now settled in the Next directory and its tranche brief. `data` gaining `implement` and
moving nav implementations out of `TR` remain future questions. See `Open questions -
Declaration model spike.md`.

## Collisions

**1. Declaration heads are resolved.** `Apps/WordFlower/2 - Next` is authoritative: primitive heads
survive for complete `app`, `nav`, and `datasource` values, and `let` survives as the universal
auto-typed immutable binding. The equivalent forms in the Foundation acceptance harness must all
compile and mount the same behavior.

**2. The tranche implementation brief points directly to Next.** Its copied, superseded declaration
scope has been removed; do not reconstruct it from this spike.

**3. `LANG-016 UI primitive boundary` is resolved for Next.** Native-backed visuals use
`render inject`; Next names the exact first surfaces. Broader bridge and recipe design remains later
work in `Deferred Tao language decisions.md`.

**4. `LANG-005` and `LANG-006`** are advanced by items 4 and 6 above. `LANG-006`'s "a type instantiates
with a bare block and `with` patches an existing value" is now the general rule rather than an
item-specific one.

## Constraints

- `packages/AGENTS.md` before editing `packages/`. Expected semantic and source-shape diagnostics
  belong in the validator; codegen assumes validated input.
- `Docs/Archive/Reports/Code cleanup spike/Report.md` holds the R1–R13 rulebook; it is the live quality bar.
- `./agent verify` before every commit. Branch `feat/<name>`; never commit from detached HEAD.
- Many worktrees share this repo and other agents work concurrently — preserve changes you did not
  make, and do not touch the Git index unless the Developer asks.
- `Docs/Archive/` is frozen.
- Ask the Developer on language semantics and ambiguous product behavior. Resolve routine implementation choices
  from repository evidence.
