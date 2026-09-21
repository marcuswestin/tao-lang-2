# Open Questions - Declaration Model Spike

Live decision record. Q1–Q6 and Q11 are resolved by the absorbed WordFlower contracts; later entries
remain open unless explicitly marked otherwise. The settled base is also recorded in
`Implementation - Declaration model spike.md`. The former `Follow-ups - Declaration model spike.md`
is folded in below, both its entries resolved.

Each entry states the question, the options, what it blocks, and a recommendation where there is one.
A recommendation is a starting position for the dialogue, not a decision. Do not implement against
these.

---

## Q1 — Do children and layout become slots? — Resolved

**Resolved by `Apps/WordFlower/2 - Next`: no.** Content acceptance belongs to the declaration, not
to a property or named slot: a view accepts opaque caller content iff its body places `@@content`.
A layout clause is ambient on every view occurrence and is exposed to an injected implementation
through `@@layout`; neither content nor layout is a user-declared property or named slot.
(Originally content acceptance belonged to the declaration _kind_ — `view` a leaf, `layout` and
`frame` content-accepting. The unified view tranche kept this resolution's substance and moved the
distinction from the keyword to body inference.)

The exploration below is retained as the superseded alternative that motivated the decision.

This is the largest one, and it gates everything else in the `ui` direction.

Today `render Card(Title: "Inbox") [fill, gap 8] { Text("Open") }` treats the layout clause and the
child block as syntax — `Docs/Spec/Tao Type System.md` states they are "never part of the argument list."
That works while the compiler knows every component. It stops working the moment a user writes a
TypeScript-backed `ui`, because the component must _declare_ whether it accepts children and layout.

```tao
primitive ui with {
   Children list of ui is none
   Layout   layout     is none
}
```

Under which `Col() [fill, gap 8] { Text("x") }` is sugar for
`Col { Layout [fill, gap 8], Children { Text("x") } }`.

**Blocks:** the `ui` `implement` slot, and therefore the entire stdlib-as-packages direction.
**Interacts with:** `LANG-013` (merge precedence, named-spec composition, which modifiers may be
inline-only) and `LANG-015` (named render slots with defaults).
**Recommendation:** yes, and treat it as MVP scope rather than current-tranche scope. It is a genuine
increase in surface area, but after it nothing inside a render call is special syntax, which is the
whole point of the unification.

## Q2 — What exactly does the `ui` surface desugar to? — Resolved for Next

**Resolved by `Apps/WordFlower/2 - Next`:** declaration header parameters remain typed public
properties and standard control events remain action-valued properties configured through
`on press|change|submit`. Caller content is the intrinsic channel settled in Q1, not a property.
TypeScript-backed visual declarations use `render inject`, which explicitly names every Tao binding
in addition to ambient `@@content`, `@@layout`, and `@@tag`; `TR`, `RN`, and `process` always exist in
the injected TypeScript scope. Richer event vocabularies remain future work.

The exploration below is retained as background.

Ro wants `ui Greeting <params> <layouts> { <event handlers> … }` kept for readability. The open part is
the mapping. Parameters are clearly slots. Layout is Q1. Event handlers are the unclear ones: is
`on press` a slot the caller may fill, a derived slot, or neither?

The answer matters because a TS-backed component needs to declare the events it emits, the way
`Slider` needs to declare `OnChange action(number)`. If handlers are slots, the declaration and the
call site agree by construction. If they are not, TS-backed components need a second mechanism.

**Blocks:** Q1's desugaring, and any `implement`-backed component that emits events.
**Recommendation:** handlers are supplied slots of `action(…)` type. `action(text)` is already a
structural type in the language, so the vocabulary exists.

## Q3 — Is the rule `render` xor `implement`? — Resolved for visuals

**Resolved by `Apps/WordFlower/2 - Next`:** no visual declaration uses an `implement` alternative.
Tao-authored visuals use `render`; TypeScript-backed visuals use `render inject`, whose returned
element is the declaration's root and receives no compiler wrapper. `implement` remains the protocol
binding concept for non-render-bearing `nav` and `datasource` families. Q11 now retains the explicit
`implement inject nav|provider` protocol-binding clause inside their reusable type blocks.

The exploration below is retained as background.

Proposed: a `ui` has exactly one, and one is required — `render` means behavior in Tao, `implement`
means behavior in TypeScript, and a `ui` with neither is incomplete for the same reason a `nav`
without `implement` is.

The case that may break it is a native container: a `ScrollView` whose behavior is native but whose
content is Tao. That is `implement` plus `Children`, which the rule permits — but confirm that reading
is right before building it, because if a native shell ever needs a Tao-authored default body, the
exclusivity has to soften.

**Blocks:** validator work on `ui` completeness.
**Recommendation:** keep the exclusivity, treat `Children` as orthogonal to it.

## Q4 — What is `List`?

**Resolved by `Apps/WordFlower/2 - Next`:** there is no stdlib `List` in this tranche. Collection
rendering remains language-owned through `loop Plural / Singular { ... }`; an optional `on select`
handler makes each rendered row selectable in the singular binding's scope. A virtualized collection
can return through a later executable Next contract if a forcing app requires it.

## Q5 — Do primitive heads survive for complete declarations?

**Resolved by `Apps/WordFlower/2 - Next`:** primitive value heads survive for complete `app`, `nav`,
and `datasource` product values, while `let` remains the universal auto-typed immutable binding. Both
of these are legal and infer the same precise app type:

```tao
app WordFlower { Name "WordFlower" … }
let WordFlower = app { Name "WordFlower" … }
```

The primitive head constrains the value family without erasing its more precise inferred type. It is
a declaration spelling for a value, never a type declaration; reusable types still use `type`.

## Q6 — Does `enum` fold into the type model?

**Resolved by `Apps/WordFlower/2 - Next`:** yes. `enum X { ... }` remains dedicated declaration syntax
but declares a nominal type in the ordinary type system. Every case is a value of `X`; a one-case enum
is valid. This does not make an enum declaration textual sugar for an anonymous union: nominal enum
identity and exhaustiveness are preserved.

## Q7 — Can a derived type wrap the parent's implementation?

`type AdvStackNav is StackNav with { … }` inherits `implement`. If it supplies its own, does it
replace the parent's behavior or decorate it? Decoration needs either a TS-side wrapping convention on
`TR.NavKind` or a Tao-level way to say "decorate, don't replace."

The conservative answer is that behavior is fixed at the first type that supplies it and derivation
below that is data-only. That is simpler and probably right for MVP, but it forecloses a real use case
— a stack that adds analytics or a transition without reimplementing navigation.

**Blocks:** nothing yet; blocks third-party ergonomics later.
**Recommendation:** data-only derivation for now, recorded as a deferred decision rather than a
permanent rule.

## Q8 — What protocol backs `data`'s `implement` slot?

Reserved but unspecified. `TR.DataProvider` already exists for `datasource`, and the relationship
between a datasource provider and a per-data-type store is not obvious — they may be the same
protocol at two granularities, or two protocols.

**Blocks:** nothing through MVP. Reserve the slot, leave the protocol unnamed.

## Q9 — When do nav implementations move out of `TR`?

Settled in direction: `TR` owns protocols, conformance suites, and the host; stdlib owns
implementations. Unsettled in timing, because `Docs/Spec/Tao Packages.md` lists `requires`, lockfiles, and
external workspace installation as future work, and sidecar `.ts` resolution into Metro rides on that
foundation.

Splitting implementations from the protocol also creates a version matrix — `@tao/nav@2` against
`TR@1` — that does not exist while both ship in one unit. That needs an explicit, checked protocol
version.

**Blocks:** the packaging half of the sidecar work, not the language half.
**Recommendation:** build the sidecar capability first against stdlib-local paths, and move nav out of
`TR` only once package resolution is real.

## Q10 — Are derived slots declarable or a fixed list?

Completeness counts only supplied slots, so the compiler must distinguish them. It can do so
structurally today — `render`, function results, and action bodies are derived, everything else is
supplied — but that is a hardcoded list, and hardcoded lists are what this whole direction is trying
to remove.

**Blocks:** nothing. Revisit only if a user ever needs to declare a derived slot.
**Recommendation:** leave it hardcoded and see whether the need appears.

## Q11 — Two spellings of `implement` — Resolved

**Resolved by WordFlower Tranche 4:** keep `implement inject nav|provider` as the explicit
protocol-binding clause inside `type T is nav|datasource with { ... }`. It fills primitive
`nav`/`datasource`'s `implement` requirement, but the fence or sidecar path is not an ordinary Tao
data value. Visual declarations use `render inject`, so the contextual split stays narrow and
unambiguous. This preserves the established inline and sidecar forms without inventing a string-like
Tao value for executable protocol behavior.

Surfaced by combining the two build slices, not by either alone. Both landed as briefed, and together
they leave `implement` meaning two things in two places:

```tao
primitive nav with { implement }                                    // a required protocol slot
type StackNav is nav with { implement inject nav "./StackNav.ts" }  // its explicit binding clause
```

`Now 1` made `implement` a `TypeProperty` slot name (via `TypeSlotName: ID | 'implement'`, itself a
keyword workaround). `Now 2` deliberately kept the existing `implement inject nav|provider`
vocabulary rather than inventing new syntax. Neither decision was wrong in isolation; the pair is
exactly the surface redundancy this whole direction set out to remove, and merging the branch makes
it the status quo.

The considered options were to fold the clause into a data-slot form (`implement is
"./StackNav.ts"`), keep and document the contextual split, or rename the primitive slot. The
implemented choice is the contextual split described above.

**Blocks:** nothing. Revisit only if a future non-render-bearing protocol family cannot use the same
explicit binding clause cleanly.

---

## Follow-ups (both resolved)

The two build slices (`Now 1 Unified declaration slots`, `Now 2 Sidecar TypeScript implementations`)
landed together on `feat/declaration-model`. These are what they left unfinished, since resolved.

### FOLLOW-DECL-001: Make the prelude the authority, not a mirror — resolved

`packages/apps/stdlib/tao/Prelude.tao` existed as real parsed, validated Tao, and drift between it and the
compiler was caught. But the direction of authority ran backwards from the intent:
`prelude-validator.ts` checked the prelude _against_ a hardcoded `expectedPrimitives` list, with
hardcoded slot expectations for `nav`, `datasource`, and `app`. Nothing read slot contracts _from_
the prelude to drive validation elsewhere — so the prelude was a pinned mirror of the compiler's
beliefs rather than the source of them, and adding a slot to a primitive still meant editing
TypeScript.

**Resolved by the host-read view slots and native nav kit tranche.** Validators now resolve
primitive slot contracts and refinement inheritance from the parsed prelude. Adding defaulted
`Title` and `Toolbar` to primitive `scene` required no parallel hardcoded expected-slot edit, and
`nav is scene is view` sees them through the same effective-slot traversal. `prelude-validator.ts`
retains only the closed primitive-name/family integrity checks needed to bootstrap the language.

The unified view tranche shrank the pinned set — `visual`, `presentable`, `ui`, `layout`, and
`frame` collapsed into the one `view` primitive, and `nav` now refines `view` — by editing the same
hardcoded lists this follow-up wanted derived from the prelude (`prelude-validator.ts`,
`TypeSystemHelpers.primitiveTypes`, `Type.ts`'s parent map). The hardcoding was not deepened, and
the collapse makes the eventual inversion smaller.

### FOLLOW-DECL-002: Filter defaulted slots in configurable completeness — resolved

`completeness-validator.ts` filtered defaulted slots for visual declarations
(`parameter.defaultValue === undefined`) and for type declarations (`Type.propertyRequiresValue`),
but the configurable-declaration branch returned every configuration property unfiltered.

**Resolved by the host-read view slots and native nav kit tranche.** Completeness now asks the
declaration model whether an effective supplied slot requires a value instead of treating every
configuration member as required. Primitive defaults therefore remain optional through refinement
and transparent configurable-type aliases. `Title` and `Toolbar` prove the path: a scene may omit
them generally, while a StackNav scene placement independently requires `Title` and reports that
usage error at the placement. A plain view has neither slot and receives Back-only chrome.

### Not follow-ups

Recorded so they are not rediscovered as defects:

- **`Datasource datasource is none` in the prelude.** Eight of the ten apps in the repository declare
  no datasource, so an app's `Datasource` slot is optional by necessity, not by preference.
- **`TypeSlotName: ID | 'implement'`.** A keyword workaround, but a working one. Tranche 4 resolved
  Q11 by retaining `implement inject nav|provider` as the explicit protocol-binding clause that fills
  this primitive requirement; it is not an independent cleanup item.
