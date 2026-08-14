# Tao Type System

Status: authoritative contract for the implemented WordFlower tranche. Intended syntax that is not
yet implemented lives in the app tiers — `Apps/WordFlower/2 - Next` for the tranche being built,
`3 - MVP` and `4 - Revolution` beyond it — and open questions live in
`Roadmap/Deferred Tao language decisions.md`. This file describes only what runs today.

## Implemented value and control-flow contract

The current value core supports `text`, `number`, `boolean`, `none`, homogeneous lists, nominal
custom values and items, configured `ui`/`nav`/`datasource` values, and schema-specific live entity
types. `time` is a distinct data-field type whose current producing form is data-only `(default now)`;
the runtime applies `now` separately for every created row. Text, lists, and queries support
`Value is empty`; lists and queries retain `.Count`. `Value is <Case>` is the general boolean case
test for enum values, boolean data fields, and built-in subject cases. Public `.Empty`, `.Loading`,
and `.Error` members are retired. Every entity handle exposes stable text `.Id`, including after its
row becomes missing; application code may retain that identity without gaining access to raw rows.

The executable language includes precedence-aware arithmetic, comparison, equality, and boolean
expressions; pure functions; immutable `let`; reactive `state`; named and inline actions; `set`,
compound `set`, `toggle`, and `do`; subject `when`; block-scoped `guard`; homogeneous list literals;
`loop`; first-class `view`, `layout`, `ui`, `dialogue`, and configured `nav` values; closed role unions
such as `Presentable is ui | nav`; top-level data/query/write forms; declaration-owned configuration;
dialogue `ask`/`respond`; and typed injection.

Optional item fields, `match`, heterogeneous lists, richer collection transforms, and async remain
future work.

### Owner-bound arguments

Rendering, actions, functions, presentation, constructors, configured values, and data writes share
one non-positional binder. Calls and presentation always delimit arguments with parentheses and use
commas between multiple arguments:

```tao
render Card(Title: "Inbox", Tone: "quiet") [fill, gap 8] {
   Text("Open")
}

do Save(Draft: Draft)
let Label = CountLabel(Count)
present Detail(Task)
```

`Name: Value` refers strictly to a parameter or field owned by the value being invoked or
constructed. It never resolves `Name` as an unrelated visible type. An unlabeled value binds when
its exact or nominal type identifies exactly one remaining slot; declaration or source order never
breaks a tie. The validator reports unknown and duplicate labels, label/type-name collisions,
same-type ambiguity, unmatched values, and missing required slots.

Defaults may be omitted. A defaulted slot does not compete for an unlabeled value, so override it
with its owner label. A required parameter cannot follow a defaulted one; a default must match its
parameter type and may refer only to earlier parameters in the same declaration.

Empty calls use `()`. A render layout clause and child block follow the closing parenthesis and are
never part of the argument list. The `render` keyword may be omitted only for child invocations
inside a render block; parentheses remain mandatory.

### Interpolated strings and expressions

A quoted string may contain scalar expressions:

```tao
let Greeting = "Hello { Person.Name }; next is { Count + 1 }."
```

Interpolation accepts the full expression grammar, including member paths, calls, binary
expressions, and subject `when`. Results must be text, number, boolean, or `none`; `none` contributes
empty text. `\{`, `\"`, and `\\` escape a literal brace, quote, and backslash. Multiple interpolations
and nested expression braces are supported. Explicit `interpolate` is retired.

Operator precedence is unary, multiplication/division, addition/subtraction, comparison, equality,
`and`, then `or`. Arithmetic operands are numbers except for `text + text`; ordered comparisons
require numbers; boolean operators require booleans.

### Product functions

A product function is a top-level, expression-bodied, pure declaration:

```tao
function DocumentLabel Title is text returns text = "Document: { Title }"
```

Calls use the same non-positional owner binder as other invocations. Parameters are immutable, the
declared return type must accept the expression result, and the body cannot read reactive state or
perform actions, data writes, presentation, dialogue, or injection.

### Action callback contracts and control events

`action()` accepts no values; `action(text)` accepts one text value; further inputs are
comma-separated. Contracts are structural. Named actions infer their callback signature, and an
action with incompatible value types or required arity is rejected.

```tao
view Editor {
   state Draft = ""
   action ChangeDraft Value is text { set Draft = Value }
   action Save { }
   render TextInput(Value: Draft, Label: "Draft") {
      on change ChangeDraft
      on submit Save
   }
}
```

`on press|change|submit` configures the matching action-valued control slot. It accepts a named action
or an inline handler; `on change -> Entered { ... }` introduces the supplied text payload in the
handler scope. A direct writable-state `Value:` reference receives synthesized two-way change
behavior only when no explicit change handler exists. Computed values, aliases, parameters, and
entity fields require an explicit handler.

### Subject `when`

`when` evaluates one subject once and selects one case lazily:

```tao
let Label = when Draft {
   empty -> "Required"
   otherwise -> Draft
}

when Ready {
   true -> { Text("Ready") }
   otherwise -> { Text("Waiting") }
}
```

`otherwise` is required for every supported `when`; it is always exhaustive. Value branches must
have compatible results. Exact boolean cases preserve ordinary boolean conditionals. Query subjects
add mutually exclusive `loading`, `error -> Message`, and ready `empty` cases. Render branches use
blocks. This tranche did not introduce an action-statement `when`; actions use guards and one-sided
`if`.

### One-sided `if`

`if` accepts one boolean condition and one block:

```tao
if Result is Confirmed {
   dismiss
}
```

It never takes `else`. A conditional with two or more outcomes is modeled by exhaustive `when` in
the contexts where `when` is supported. `Value is <Case>` can appear anywhere a boolean expression
is accepted; the declaration-linked case must belong to that value.

### Block-scoped guards

A guard has exactly one subject and either one case or a case block:

```tao
guard Draft empty

guard Documents {
   loading -> { Text("Loading…") }
   error -> Message { Text(Message) }
}
```

On a match, the optional handler runs and the remainder of that guard's enclosing block is skipped.
Statements or render siblings before it remain. A guard inside a called action stops only that
called action's current block; execution after `do Callee()` in the caller continues. A guard inside
a nested event handler stops only that handler block. A render guard renders its matched handler and
skips only later siblings in the same render block.

An entity subject additionally supports `loading`, `missing`, `unauthorized`, and `error -> Message`.
If the runtime reports none of those exceptional cases, execution falls through with the live
entity handle:

```tao
guard Document {
   loading -> { Spinner() }
   missing -> { Text("Missing { Document.Id }") }
   unauthorized -> { Text("No access") }
   error -> Message { Text(Message) }
}
DocumentEditor(Document)
```

The handle keeps `.Id` through every availability state. The guard implements runtime dispatch and
fall-through in this tranche; static flow narrowing and rejection of unguarded field access remain
deferred.

### Dialogue

`dialogue Name <Parameters> responds <Enum>` is response-demanding presentable content. `ask`
creates a fresh stacked occurrence and suspends its action until that occurrence answers.
`respond Case` supplies the declared enum case; bare `respond`, Back, or dismissal supplies `none`.
Each occurrence owns its resolver, so nested or repeated asks cannot answer one another.

### Collections and entities

List literals are homogeneous and comma-separated. Rendering iteration uses
`loop Collection / Binder`; the binder type is inferred from the collection element and is scoped to
the loop body. Queries are reactive lists of live entities. Relationship fields accept and return
the declared related entity type, never arbitrary text. Strict `update` and `delete` require such a
live handle. Runtime entity identity supplies row keys, while the handle's stable `.Id` is public Tao
surface; raw provider rows and ID-based test selectors remain private.

## Declaration-owned configuration

Apps, `nav`, and `datasource` declarations already use a declaration-owned configured-value model.
The linked declaration is the source of truth for property names and types; validation, formatting,
and compilation do not dispatch on shipped names. A bare block constructs a descriptor, `with`
patches an existing descriptor, and the descriptor retains its declaration identity across imports,
aliases, and generated modules.

````tao
public nav CopiedStack {
   Initial ui

   implement inject nav ```ts
      return TR.NavKind.Stack()
   ```
}

let HomeNav = CopiedStack {
   Initial Home
}
````

`implement inject nav|provider` is a top-level, visible declaration binding rather than app or
configuration content. It supplies the published `TR.NavKind` or `TR.DataProvider` protocol value.
Third-party declarations and the shipped `StackNav` and `Memory` declarations use the same path and
must pass the published conformance suites. An app variant retains its originating app declaration
identity while replacing or patching public app properties.

## Future directions

These are intended, not implemented. Each is expressed as working product code in the later app
tiers or catalogued as an open decision; this section only names them so the contract above stays
complete about its own boundaries.

- **Items and named types.** Optional fields, item type extension, structural `like` types, and
  owner-qualified property types. Sketched in `Apps/WordFlower/4 - Revolution`; catalogued as
  LANG-004 through LANG-006.
- **`match` and overloaded declarations.** Closed unions matched exhaustively, and declarations
  overloaded by argument shape. Sketched in `4 - Revolution`; LANG-006 and LANG-021.
- **Declaration properties in longhand.** A property block with `optional` and `default` entries
  alongside the header parameter form. Sketched in `4 - Revolution`; LANG-019.
- **Collection and text operators.** `has`, list subtraction, text repetition, heterogeneous list
  element unions, and richer transforms. LANG-006 and LANG-026.
- **Units and semantic types.** Duration and measure literals beyond the tranche's `N.seconds`, and
  member conversions such as a duration read in minutes. LANG-026.
- **Automation and lifecycle events.** Declared events and time, app, and network hooks, which
  would extend the `on` vocabulary beyond control events. LANG-020.
- **Async and concurrency.** A fork form plus the concurrency policy that must accompany it —
  queue, single-flight, cancel-previous, or exclusive. LANG-019 and DEF-NAV-011.
- **Errors and boundaries.** Result values, structured failure handling, and exhaustive case
  matching over them. LANG-021.

Retired forms worth knowing about, because older material may still show them: `alias` (now `let`),
`.Empty`/`.Loading`/`.Error` members (now `is empty` and subject cases), explicit `interpolate` (now
interpolated strings), condition-list `when` (now subject `when`), `for … in` (now `loop`), `.Name`
dot-arguments (now `Name:` labels), and the `project`/`publish` visibility words (now `workspace`
and `public`).
