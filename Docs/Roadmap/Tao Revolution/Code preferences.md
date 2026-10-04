# Tao code preferences

Started 2026-10-02. Authoring guidance for the prospective language, not a claim that these forms
compile today. Language semantics belong to [Decisions.md](Decisions.md). A preference never permits
a rewrite that changes binding, nominal identity, effects, ownership, localization, or render layout.
This document does not yet change skills or implement a formatter.

## 1. Names, arguments, and construction

1.1. Prefer existing named types: `view Card(Title)` rather than an inline scalar role when a suitable
named type exists. Referencing or renaming an existing type does not create another nominal identity.

1.2. Prefer an unmarked argument when its destination is unique: `Button("Seen")`,
`UpperCase(Title)`, and `Card(Title "Example")`. Calls never bind by argument position.

1.3. Use `.Name Value` to make an otherwise ambiguous destination explicit. The proposed extension
to repeated-type parameters selects a binding; it does not manufacture a fresh nominal type.
For a concrete destination, `.Name "Example"` can also contextually construct that type. A capability
destination cannot be instantiated merely by selecting its binding.
Prefer the selected bare alternative `Add(Right 2, Left 5)` when it resolves uniquely: ordinary visible
type lookup wins, with an immediate-signature binding fallback only when the name is absent.
Its selected binding must be retained at the argument site; converting both expressions to anonymous
numbers would lose the distinction. `.Right` remains an escape hatch. Concrete parsing and binding
implementation still need a prototype; this is design direction, not implemented behavior.

1.4. Prefer `state Mode = ViewMode "list"` over `state Mode is ViewMode = "list"` when both produce
the same static type and value. Preserve an explicit annotation when it intentionally widens or restricts.
Prefer named-state shorthand `state GroupMode no` when the binding name is the type name;
it means `state GroupMode = GroupMode no`. A following `GroupMode yes` in constructor position
selects the type, while bare expression `GroupMode` selects the value. This is a requested grammar
target, not implemented parsing proof. It does not supersede lexical value selection for ambiguous
dotted expressions; retain a type alias for those cases.

1.5. Prefer inferred function/action results; use `-> Type` when intentionally constraining the result.
Bodyless contracts still require a result contract. Recursive or foreign contracts may need one.

1.5a. Put generic constraints before the value parameters:
`func Earlier where type T is Ordered (Left T, Right T) { ... }`. Separate multiple constraints
with commas. These declare inferred compile-time type variables, not runtime arguments or new
nominal types. Repeated value-parameter identities still require unambiguous argument binding.

1.5b. As binds tighter than comparison operators; prefer
`Width as Length < Height as Length` when those conversions and the shared comparator are valid.
Keep explicit parentheses around an arithmetic result to convert that entire result. Inherited
comparison Self specializes to each derived nominal type; widening must select a genuinely
comparable domain rather than merely common storage.
Within a directed argument, the selector owns the complete following expression through its comma
or closing parenthesis. Prefer `.Right Imperial as Celsius` over `.Right (Imperial as Celsius)`
when the parentheses only surround that payload conversion. Keep parentheses when needed to change
expression grouping, such as `.Right (A + B) as Target`. This is a canonical grammar target awaiting
parser proof; a conversion must preserve the argument's selected destination.

1.6. Use postfix units: `150 Milliseconds`, `-2 Seconds`, or `(Count + 1) Seconds`. Initially permit
numeric literals with their sign and explicitly parenthesized number expressions; unrestricted bare
expression suffixes are not selected. Keep `-(2 Celsius)` distinct from `-2 Celsius`: only the former
requires temperature-point negation. Implementation remains outstanding. The requested binding form
`let AnimationDuration 150 Milliseconds` explicitly constructs a declared duration role through its
authorized constructor/conversion; it does not permit implicit downward matching elsewhere.
Use plain Duration when a distinct role/constraint is unnecessary. A checked constructor may carry
modeled failures; do not silently equate it with a promised total as conversion. Do not rewrite a unit
constructor to `as` unless conversion semantics, unit scaling, and validation are identical.

1.7. Separate item/configuration value entries with commas: `Settings { Count 2, Timeout 3 Seconds }`.
Newlines do not replace these separators. This does not add commas between render children or
declaration statements. For same-domain quantity arithmetic, preserve the leftmost operand's unit;
scaling with one quantity preserves its unit even when the unitless scaling factor comes first.

1.8. Declare owner units in a block with an explicit reference scale:
`units { Seconds 1 (default), Milliseconds 0.001, Minutes 60, Hours 3600 }`.
Keep the explicit 1 on the default/reference unit; do not format it away. This unit defines canonical
normalization and the initial default view for the selected minimal design. Do not introduce a
separate canonical marker yet or change backing meaning through presentation-only configuration.
Exact unit parsing/validation and core scalar-domain admission still need the remaining prototypes.

1.9. For an inferred shared generic T, permit ordinary upward admission when a typed input already
supplies an ancestor of all other typed inputs; select the most specific eligible supplied ancestor,
independently of argument order. Require the chosen T's bound/comparison contract to fit. Do not
invent an absent ancestor to unify sibling types, and do not run semantic converters implicitly.
Contextual raw literals can construct an established T; they are not deliberate parent anchors.
Comparison uses the chosen static T's contract rather than a narrower dynamic receiver contract.

1.10. Units are owner-scoped and can be qualified in a suffix, e.g. `2 Duration.Seconds`.
Prefer shorthand names when explicitly visible and unambiguous. Never resolve an ambiguous unit name
by guessing from the expected parameter type; qualify or rename the import.

## 2. Capabilities and associated operations

2.1. Declare named capabilities with `can`; admit them using ordinary parameter type syntax:
`can ui { Render() -> rendered }` and `view Preview(Value ui) { render Value }`.

2.2. Conformance is structural. A compatible method signature satisfies the requirement; do not add
`can ui` to every implementing type. Inherited methods count. Concrete-Self substitution, overloads,
failure contracts and signature compatibility must be checked; matching method names alone is
insufficient. Associated methods have no independent visibility markers: a visible type exposes
its methods. Ordinary top-level helpers retain declaration visibility.

2.3. Keep associated implementations in `type T is Parent with { ... }`. When the enclosing owner
uniquely determines the receiver, prefer `func Method()`, `view Render()` and `static func Default()`
over redundant `T.` prefixes. Explicit owner-qualified input remains useful when selecting item
versus collection receivers in a data declaration; never erase a qualifier that changes binding.
Keep source/target qualification on converters such as `T as Other { ... }`. Associated view methods satisfy ui
when their full signature fits. No separate method visibility marker or conformance clause is needed.
Importing types also supplies associated exported converters and operators; ambiguity errors rather
than selecting by import order. This does not authorize implicit downward or sibling conversion.

2.4. Avoid wrappers whose only operation is an already permitted ancestor conversion. Prefer
`Value as text` or direct compatible argument passing when permitted. The active fixture omits
an uninhabited `never` type and conversion-ban declarations pending pre-MVP A28/R19; the selected
`fails never` annotation is separate from those deferred features. `data of` is unnecessary where
public representation conversion exists. Opaque/secret access policy remains to decide.

2.5. Reuse inherited comparison behavior where its operand/result contract fits. Numeric storage
must not silently authorize mixed semantic units or additional public conversions.
Scalar is an abstract operation family rather than a concrete unitless value; use a concrete domain
or bounded generic T to perform domain-preserving arithmetic.

2.6. Standard-library LazyList consumes the ordinary Keyed capability, Key() fails never -> RenderKey.
Its library implementation requires stable unique keys and rejects duplicates without positional
repair. A field named RowKey is never compiler magic. Other components can choose another protocol;
ordinary loops do not acquire this requirement. Conformance remains structural without a marker.

## 3. Rendering and slots

3.1. Prefer bare zero-argument views: `Spacer`, retaining explicit `Spacer()` as valid input.
Arguments and styling precede the render body.

3.2. Prefer `"Example"` over `Text("Example")`, including `"Example" [caption]`, when equivalent.
Prefer direct placement of a value satisfying `ui` over an adapter view whose only work is `Render()`.

3.3. Bare `guard Subject` continues for an available/present value, including valid empty text/lists,
and uses shared unavailable-read handling otherwise. Use a custom handler for different behavior.
An explicit `none -> empty` suppresses expected absence and stops the remainder of that render block.
An explicit `empty` case can enforce a nonempty-content precondition. The compact
`guard Subject { empty -> "Fallback" }` is an accepted atomic-string branch extension;
today the equivalent branch uses `{ Text("Fallback") }`. Any matched branch stops the render remainder.
The public missing state is removed from the intended design. Prefer none for expected absence;
preserve typed failures for failed existence/schema promises. Detailed state migration belongs to
pre-MVP A29/R20. Today's runtime vocabulary remains documented in the implemented Spec.

3.4. Bare empty text values use core text's ui implementation to produce `empty`, with no node and
no sibling gap contribution. Prefer `Feedback` over a conditional whose only work is suppressing
an empty text value. Explicit `Text("")` preserves a text node; quoted render sugar still follows
its explicit Text equivalence. Optional none, unavailable reads and arbitrary custom ui implementations
are separate contracts. Do not erase an intentional styled/container/accessibility node or assume
every custom renderer suppresses empty input. A custom text descendant should delegate to bare text
placement when it wants the same suppression behavior.

3.5. Prefer `@item Item -> Row(Item)` for a received renderer argument. Accept both
`@item Book, Occurrence -> Row(Book, Occurrence)` and its parenthesized binder-list form; format
simple comma-separated binders without parentheses when the boundary is unambiguous. Preserve
parentheses wherever removing them would introduce ambiguity. Parser prototypes must verify this
before implementation acceptance. Prefer `@item: @item` for exact renderer forwarding: the left
identifies the receiving slot, the right resolves lexically to the outer renderer. Require compatible
signatures; this forwards a renderer rather than invoking it or recursively binding to the filled slot.

3.6. Put `#tag accessible ...` on one line; use `accessible ...` alone when there is no tag. Normalize
reversed prefix order only when both prefixes attach to the same render occurrence. Dynamic labels
remain part of the accessibility contract. `a11y` may be accepted as input shorthand.

## 4. Actions and control flow

4.1. Require the event arrow. Prefer `on press -> do Commit()` over an unnecessary action block.

4.2. Prefer `on press -> do Commit() then { ... }` and `on press -> when Mode { ... }` when each is
one complete statement. A statement sequence needs a block. Recursive keyword-led statements must
have their own boundaries; accepting one atomic statement does not permit unrestricted bare sequences.

4.3. Extract a helper view/function/action when a case body exceeds two additional indentation levels
or five statements. Preserve closure capture, reactive state ownership, control-flow exit scope,
occurrence identity, and lifecycle; extraction is not always an automatic semantics-preserving rewrite.

4.4. Infer modeled native function/action failure contracts from their body and callees; preserve
them in callable types, including callback/capability calls. Foreign operations expose their contract.
Every modeled failure reaches a local handler, a typed caller, or an installed default root policy.
Use local branches for special recovery rather than repeating generic error UI at every call.
The required coverage is selected design, not current comprehensive checking. Optional native
`fails X, Y, Z` annotations are closed upper bounds on inferred propagated failures. `fails never`
requires no modeled failures to propagate; locally handled failures may still occur internally.
This does not claim arbitrary foreign code cannot fault or that installed root defaults erase a
callable's propagated effects. The compiler infers a precise contract when it can; without a declared
or provable inferred contract, failures are unknown/open, never silently empty. In particular a
bodyless can signature with no fails declaration may fail with anything. Reject bare fails as
incomplete. Put failure clauses before a written result arrow, without brackets:
`ToText() fails never -> text`, `ToText() fails Foo, Bar -> text`, or `ToText() -> text`.
An implementation's
propagated failures must fit the capability bound; unknown is not empty or automatically compatible
with a closed bound. Automatic capability-instance/call-site/whole-app refinement where proven is
[post-MVP](<../Capability failure refinement.md>); ordinary body/callee inference remains selected.
Never assume unknown foreign targets are closed. One installed app-level generic error guard covers
propagated known and unknown modeled failures; local handlers provide special recovery.

4.4a. Explicit authored `as` conversions may fail through ordinary modeled effects. Prefer the shared
ConversionFailure family, retaining specific format, encoding, range, precision and constraint
failures and safe metadata. Use `static func` for associated functions without an instance receiver.
Write converters as `Source as Target fails X, Y { ... }`, omitting the failure clause to infer it;
the target supplies the result type. Converters are functions. All functions, including injected,
static and associated implementations, cannot invoke actions, perform I/O or suspend transitively.
Modeled validation/computation failures remain allowed. Structural dispatch preserves this rule.

4.4b. Do not automatically chain converters. Use explicit intermediate conversions; resolve one
applicable declared converter by nearest source ancestor, rejecting equally applicable candidates.
Inherited static factories keep their result type. Use an import rename when a local value hides
the owning type. Combine generic capability requirements with `and`. Prefer named Round/Truncate/
Clamp operations over conversion-policy syntax; the subsequent conversion still checks its target.

4.5. Use `create Book with Input` for one new item. Keep item and collection receiver actions explicit:
`Book.Return()` and `Books.Return()`. Use `do` for invocation, not `update Book.Return`.
Inverse Boolean writes name the same stored field with opposite polarity. Fill only one alias per
update; reject a fill of both names even if their values agree.

4.6. Use `async { ... }` only for intentional detachment. `then` joins its selected handler; it does
not detach. Under the current scheduler detached work begins after its enclosing root completes.
Handling a submission does not imply later provider acceptance; observe that separately.

4.7. Prefer `defer DeleteTemporaryFile(File)` over `defer { do DeleteTemporaryFile(File) }` when
there is one invocation. They register equivalent deferred actions with the same capture semantics;
neither invokes immediately. Lexical scope, LIFO ordering, and preserved cleanup failures are selected.
Use ordinary closure capture; snapshot mutable inputs into immutable locals when needed. Cleanup
may suspend, exit waits for it, and ordinary cancellation does not interrupt already-started cleanup.

4.8. Use `done` for invocation success, `error` for modeled failures, and `cancelled` for cancellation.
Do not use `otherwise` to imply success; it catches remaining outcomes. Success follows the invoked
operation's own contract, which may describe local submission rather than remote acknowledgement.

4.9. Allow `use all from Package` when importing all public exports is desired. Reject conflicting
wildcard bindings immediately, including unused conflicts; never silently choose one import.

4.10. Match app failures by typed case/family, retaining origin metadata. Exact cases take precedence
over families and families over generic error; reject equally specific overlaps.

4.11. Use pick for a single selected value and when for all matching statement/render outcomes.
Historical value-producing when sketches migrate to pick; do not return an unexplained collection
from a scalar selection. Action when executes all preselected matches sequentially in declaration
order; unhandled failure stops remaining bodies with normal propagation. Capture matching once
before effects, without treating snapshot metadata as continued authorization for live reads.
Use `otherwise -> ...` for fallback in both when and pick; none remains an ordinary absent value.
When fallback is optional and runs only if no ordinary case matched. Pick may omit fallback only
when total coverage is statically proven. No special absent-case spelling is needed.

4.12. Wait uses signed Duration; nonpositive values add no intentional wait. Cancellation unwinds the
cancelled action context and runs cleanup. Long waits use bounded host timers; positive fractional
waits round upward to supported scheduling granularity, with no exact-resumption promise.

4.13. Use `let Timer = Time.StartTimer()` and `let Duration = Timer.Duration()` for monotonic elapsed
measurement. Each call samples a fixed Duration; previous samples do not update and measurement
continues. Use `Time.Now()` for a DateTime
absolute wall-clock instant; timezone affects presentation. These are synchronous function calls;
`do Wait(...)` is the suspending action. Timer elapsed measurement includes device sleep under the
selected contract. Timer handles are runtime-only and cannot be persisted. In a view, use
`state Timer = Time.StartTimer()` to create one per mounted instance and retain it across rerenders.
Persist DateTime timestamps/deadlines or fixed Duration amounts rather than a timer origin.
Remaining time API design, including [Time.Live](../Time.Live%20API.md), belongs to pre-MVP
[A30/R21](<../../MVP Roadmap/Review - Dates and time APIs.md>).

## 5. Data, metadata, and localized presentation

5.1. Prefer `status of Subject` over reserved domain properties. Resource state, optional absence,
content emptiness, occurrence position, and mutation receipts remain separate contracts.

5.2. Keep acquisition bounds in the query and viewport virtualization in its list/tree view. A loop
does not imply a scrolling container or automatic lazy fetching.

5.3. Prefer datasource/I/O-owned serialization. Adapters must validate the declared schema and any
semantic constraints; a matching primitive shape alone does not prove units, identifier domains, or
authorization. Do not require app-defined codecs solely to exercise capabilities.
Adapter ownership is selected; automatic runtime decoding of every foreign result is not implemented.

5.4. Locale-aware semantic `text` versus raw `string` is under exploration. Prefer deferred localized
formatting of percentages/units to concatenation such as `"{Value * 100}%"`. User content must remain
verbatim, and machine serialization must not depend on the display locale. Changing `text` storage
or admitting this distinction is not decided by these preferences.
Further discussion is deferred to the pre-MVP [A26 investigation](<../../MVP Roadmap/Agent MVP Roadmap.md#a26--investigate-locale-aware-core-text>).
The complete static read/failure proof design likewise moves to [A27](<../../MVP Roadmap/Agent MVP Roadmap.md#a27--investigate-static-read-and-failure-handling-proofs>).
