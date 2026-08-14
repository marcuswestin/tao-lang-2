# Open Questions - Declaration Model Spike

Draft for review. Ro and Claude are resolving these in dialogue; nothing here is decided. The settled
half is in `Implementation - Declaration model spike - Claude.md`, which is safe to build against.

Each entry states the question, the options, what it blocks, and a recommendation where there is one.
A recommendation is a starting position for the dialogue, not a decision. Do not implement against
these.

---

## Q1 — Do children and layout become slots?

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

## Q2 — What exactly does the `ui` surface desugar to?

Ro wants `ui Greeting <params> <layouts> { <event handlers> … }` kept for readability. The open part is
the mapping. Parameters are clearly slots. Layout is Q1. Event handlers are the unclear ones: is
`on press` a slot the caller may fill, a derived slot, or neither?

The answer matters because a TS-backed component needs to declare the events it emits, the way
`Slider` needs to declare `OnChange action(number)`. If handlers are slots, the declaration and the
call site agree by construction. If they are not, TS-backed components need a second mechanism.

**Blocks:** Q1's desugaring, and any `implement`-backed component that emits events.
**Recommendation:** handlers are supplied slots of `action(…)` type. `action(text)` is already a
structural type in the language, so the vocabulary exists.

## Q3 — Is the rule `render` xor `implement`?

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

Ro flagged genuine uncertainty here. Two readings:

- **A `ui` type** with an items slot, an item-template slot, and `on select` — a real native list,
  implemented over a virtualizing React Native component, which is where the performance argument
  points for long collections.
- **Already covered** by `loop` inside a render block, in which case `List` is a layout convenience
  and `on select` belongs to the rows rather than to a list component.

`Brief - Implement WordFlower tranche 4.md` has "`List` with `on select`" in scope, so this needs an
answer before that tranche reaches it. `archive/wip-1493` contains a `TR-native-list` worth reading as
evidence of what the runtime side wants.

**Blocks:** tranche 4 stdlib surfaces.
**Recommendation:** a `ui` type. `loop` produces elements eagerly, which is the wrong shape for a long
collection, and an item-template slot is expressible under Q1's `Children` work.

## Q5 — Do primitive heads survive for complete declarations?

This is the question the whole dialogue started from and it is not closed. Given `let` survives, is

```tao
app WordFlower { Name "WordFlower" … }
let WordFlower = app { Name "WordFlower" … }
```

both legal? Ro's stated preference in turn one was that losing `app Foo { … }` and
`datasource Bar { … }` would be a real loss. Against that, two legal spellings for one declaration is
exactly the kind of surface redundancy this dialogue set out to remove, and it puts every primitive
name back into statement-head position.

A middle reading: primitive heads are legal only for _top-level product declarations_ — `app`, `data`,
`ui` — where the head carries real information about what the file contains, and `let` is the only
form for everything else. `Apps/WordFlower/2 - Next` currently has 16 kind-headed declarations to 2
`let`s, so this decision has the largest migration cost of anything here.

**Blocks:** the `Next` tier rewrite, and the grammar shape of `AliasDeclaration`'s `BindingKeyword`.
**Recommendation:** the middle reading. Ro should confirm the exact list of privileged heads.

## Q6 — Does `enum` fold into the type model?

`enum X { … }` exists at `types.langium:10`, and `UnionTypeExpression` at `types.langium:25` would
already parse `type Status is Draft | Sent`. Two forms for one concept. `LANG-004` owns this and lists
string-valued enums and identifier cases as preserved options.

**Blocks:** nothing immediately; worth settling before `LANG-004` becomes active work.
**Recommendation:** fold it, once the case-value question in `LANG-004` is answered — a union of bare
identifiers and an enum of cases are the same thing spelled twice.

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
