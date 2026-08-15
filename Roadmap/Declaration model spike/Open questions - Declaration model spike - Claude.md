# Open Questions - Declaration Model Spike

Live decision record. Q1–Q6 are now resolved by `Apps/WordFlower/2 - Next`; later entries remain open
unless explicitly marked otherwise. The settled base is also recorded in
`Implementation - Declaration model spike - Claude.md`.

Each entry states the question, the options, what it blocks, and a recommendation where there is one.
A recommendation is a starting position for the dialogue, not a decision. Do not implement against
these.

---

## Q1 — Do children and layout become slots? — Resolved

**Resolved by `Apps/WordFlower/2 - Next`: no.** Content acceptance belongs intrinsically to the
declaration kind: `view` is a leaf, while `layout` and `frame` accept opaque caller content and place
it through `@@content`. A layout clause is ambient on every visual occurrence and is exposed to an
injected implementation through `@@layout`; neither content nor layout is a user-declared property
or named slot.

The exploration below is retained as the superseded alternative that motivated the decision.

This is the largest one, and it gates everything else in the `ui` direction.

Today `render Card(Title: "Inbox") [fill, gap 8] { Text("Open") }` treats the layout clause and the
child block as syntax — `Spec/Tao Type System.md` states they are "never part of the argument list."
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
binding concept for non-render-bearing `nav` and `datasource` families. Whether those declarations
eventually spell that binding as a filled slot or retain `implement inject nav|provider` is Q11.

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
implementations. Unsettled in timing, because `Spec/Tao Packages.md` lists `requires`, lockfiles, and
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

## Q11 — Two spellings of `implement`

Surfaced by combining the two build slices, not by either alone. Both landed as briefed, and together
they leave `implement` meaning two things in two places:

```tao
primitive nav with { implement }                       // a declared slot, in a type block
nav StackNav { implement inject nav "./StackNav.ts" }  // a keyword clause, in a configuration block
```

`Now 1` made `implement` a `TypeProperty` slot name (via `TypeSlotName: ID | 'implement'`, itself a
keyword workaround). `Now 2` deliberately kept the existing `implement inject nav|provider`
vocabulary rather than inventing new syntax. Neither decision was wrong in isolation; the pair is
exactly the surface redundancy this whole direction set out to remove, and merging the branch makes
it the status quo.

Options: fold the configuration clause into the slot form (`implement is "./StackNav.ts"`), keep both
and document the split by context, or move the slot form to a different word.

**Blocks:** nothing today; both forms work and are tested. Blocks coherence once `ui` gains an
`implement` slot, since that will need one of the two spellings and will make the split permanent.
**Recommendation:** fold into the slot form. Q1–Q3 have now settled that visual declarations use
`render inject`, so this remaining choice affects the non-render-bearing `nav` and `datasource`
families rather than needing to generalize across `ui`.
