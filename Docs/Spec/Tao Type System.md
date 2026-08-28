# Tao Type System

Status: authoritative contract for the implemented WordFlower tranche. Tranche 4 absorbed the
declaration/value contract formerly staged in `Apps/WordFlower/2 - Next`; compatible later work
remains in `3 - MVP` and `4 - Revolution`, and unresolved questions live in
`Docs/Roadmap/Deferred Tao language decisions.md`.

## Implemented value and control-flow contract

The current value core supports `text`, `number`, `boolean`, `none`, `duration`, homogeneous lists,
nominal custom values and items, configured `ui`/`nav`/`datasource` values, and schema-specific live
entity types. `time` is a distinct type; `now` is an ordinary expression that reads the runtime
clock, and `(default now)` on a data field applies it separately for every created row. Text, lists, and queries support
`Value is empty`; lists and queries retain `.Count`. `Value is <Case>` is the general boolean case
test for case-set values, boolean data fields, and built-in subject cases. Public `.Empty`, `.Loading`,
and `.Error` members are retired. Every entity handle exposes stable text `.Id`, including after its
row becomes missing; application code may retain that identity without gaining access to raw rows.

The executable language includes precedence-aware arithmetic, comparison, equality, and boolean
expressions; unit values and dimensional arithmetic; pure functions; immutable `let`; reactive `state`; named and inline actions; `set`,
compound `set`, `toggle`, and `do`; subject `when`; block-scoped `guard`; homogeneous list literals;
`loop`; first-class `view`, `layout`, `frame`, `ui`, `dialogue`, and configured `nav` values; the
primitive `visual`/`presentable` role hierarchy; top-level data/query/write forms; declaration-owned
configuration; dialogue `ask`/`respond`; and the expression-position TypeScript boundary.

`match`, heterogeneous lists, richer collection transforms, and general concurrency policy remain
future work. Optional item fields and non-blocking `async { ... }` are implemented as described
below.

## Implemented declaration and value contract

Tao retains auto-typed `let` for every value and adds an equivalent primitive-headed spelling for
frequently declared app, navigation, and datasource values:

```tao
let HomeStack = StackNav { Initial Home }
nav HomeStack = StackNav { Initial Home }

let Store = Memory { }
datasource Store = Memory { }
```

The primitive head supplies the declared value type; it is not a reusable type declaration. New
types always use `type Name is Base with { ... }`. `Base { ... }` constructs a value and is sugar
for `Base with { ... }` in value-construction position. Extending an existing value uses
`ExistingValue with { ... }`. A value may only specify properties declared by its type, and the
implemented contract does not allow per-instance property-function overrides.

Type and value namespaces are distinct. If both contain the same name, bare `Name { ... }` resolves
the type and constructs a value. In a value expression, `Name with { ... }` resolves the value first
and falls back to the type only when no value exists. After `type Derived is`, the base resolves only
the type namespace. A delta may fill or override declared data/configuration properties but may not
introduce a member or reopen a filled member back into an unfilled requirement.

A direct `nav Name { ... }` instantiates the primitive `nav`; it is valid only when the supplied
fills plus primitive defaults make the value complete. It never declares a reusable nav type or
adds a member. The corresponding direct forms exist for `app` and `datasource` values.

An explicit annotation remains available as `let Name is Type = Value`. `Age Name = 10`-style
arbitrary type-headed value declarations are not part of this contract; only the named primitive
value heads are privileged.

Every `view`, `layout`, `frame`, `ui`, `dialogue`, `action`, and `function` declaration has a
parenthesized parameter list, including `()` when empty. Product functions use statement blocks,
explicit `return`, and an optional inferred return type:

```tao
function DocumentLabel(Title text) returns text {
   return "Document: { Title }"
}

function Double(Value number) {
   return Value * 2
}
```

Lists declare their element type as `list of T`. Enums are nominal types whose cases are nominal
values; a one-case set is valid. Optional item fields use `Field Type?`. `async { ... }`
runs its block without delaying later statements and surfaces failures as provider error state;
async functions, `await`, scheduling, and fork/concurrency policy remain future work.

Injection bindings are explicit. `inject Type` produces a typed value outside render
position. A TypeScript-backed visual uses
`render inject Name expression, Content @@content, Layout @@layout, Tag @@tag`; a bare name binds the
same-named Tao value. `TR`, `RN`, and `process` are always available in injected TypeScript, while no
other Tao value or compiler-prefixed props bag is implicit. The returned element is the visual root;
Tao adds no wrapper, and applying layout/tag plus rendering content exactly once is the injected
implementation's responsibility.

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

A product function is a top-level pure declaration. Its parameter list is parenthesized and its
body is a statement block that returns explicitly, as specified above. The return annotation is
optional when it can be inferred from all returned expressions.

Calls use the same non-positional owner binder as other invocations. Parameters are immutable, the
declared return type must accept the expression result, and the body cannot read reactive state or
perform actions, data writes, presentation, dialogue, or injection.

### Action callback contracts and control events

`action()` accepts no values; `action(text)` accepts one text value; further inputs are
comma-separated. Contracts are structural. Named actions infer their callback signature, and an
action with incompatible value types or required arity is rejected.

```tao
view Editor() {
   state Draft = ""
   action ChangeDraft(Value text) { set Draft = Value }
   action Save() { }
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

The implemented dialogue form is `dialogue Name(<Parameters>) responds <Enum>`, including
`dialogue Name() responds <Enum>` when it has no parameters. A dialogue is
response-demanding presentable content. `ask`
creates a fresh stacked occurrence and suspends its action until that occurrence answers.
`respond Case` supplies the declared case; bare `respond`, Back, or dismissal supplies `none`.
Each occurrence owns its resolver, so nested or repeated asks cannot answer one another.

### Collections and entities

List literals are homogeneous and comma-separated. Every declared list type spells its element type
as `list of T`; bare `list` is not valid user source. Rendering iteration uses
`loop Collection / Binder`; the binder type is inferred from the collection element and is scoped to
the loop body. Queries are reactive lists of live entities. Relationship fields accept and return
the declared related entity type, never arbitrary text. Strict `update` and `delete` require such a
live handle. Runtime entity identity supplies row keys, while the handle's stable `.Id` is public Tao
surface; raw provider rows and ID-based test selectors remain private.

## Unit values

A unit family has a canonical base and fixed ratios, so one accessor mechanism builds, converts, and
reads its values. `.unit` on a number constructs a value of that unit's family, and `.unit` on a
value of the family reads it back as a number in that unit; the two round-trip.

```tao
let Wait = 220.ms                 // number → duration
Wait.s                            // duration → number: 0.22
```

`duration` is the one family the language registers today, because it is the only one a real feature
forces. Its base is the nanosecond, and its units are `ms`, `s`, `min`, `h`, `d`, and `wk`, each with
long singular and plural aliases (`1.second`, `30.seconds`). There is no bare `m` duration unit:
minutes are `min`. Months and years are not durations, since neither has a fixed length.

Equality normalizes, so `60.s == 1.min`. Arithmetic is dimensional analysis:

| Operands           | Operator | Result   |
| ------------------ | -------- | -------- |
| duration, duration | `+` `-`  | duration |
| duration, number   | `*`      | duration |
| duration, duration | `/`      | number   |
| time, time         | `-`      | duration |
| time, duration     | `+` `-`  | time     |

Every other pairing is a diagnostic, including a unit value with a bare number, which is what makes
`Wait + 1` an error rather than a silent nanosecond. Comparison against the bare literal `0` is the
one exception, because zero carries no unit: `Left > 0` is how a countdown asks whether time remains.

A family may expose named readings alongside its units. `duration` has one: `.Clock` renders whole
seconds as `m:ss` under an hour and `h:mm:ss` from an hour up, and `0:00` for zero or less. Reading a
unit or a reading the family does not have is a diagnostic, so `Wait.meters` does not compile.

A duration lowers to a plain number of its base unit, which is why same-family arithmetic needs no
runtime support and only the accessors and the calendar pairs convert.

## The TypeScript boundary

`<expression> from <path>` is how a value reaches TypeScript. It binds loosest, taking the whole
expression to its left, so a bridged call reads the way a local one would:

```tao
public
function CountWords(Value text) returns number {
   return CountWords(Value) from ./Text.ts
}

let BuildStamp is text = BuildStamp() from ./Shell.ts
```

The expression is a name or a call to one, and that head name resolves to a **named export** of the
path rather than to a Tao declaration — there are no default exports, in either direction, which is
what lets one sidecar back several bindings. Arguments are ordinary Tao expressions, evaluated on the
Tao side and passed as plain JavaScript values; the result is wrapped as a Tao value.

Tao owns the type. A bridged value therefore needs a declared one — a `returns` clause, or a
`let Name is Type =` ascription — and that declaration is the contract the sidecar must satisfy. The
compiler copies the named sidecar beside its generated module and imports the export from there.

`render inject` remains the separate authoring mode for a visual whose implementation Tao does not
own. Value-position `inject <type>` and its inline `ts` fence are retired.

## Declaration-owned configuration

Apps, `nav`, and `datasource` values use a declaration-owned configured-value model.
The linked declaration is the source of truth for property names and types; validation, formatting,
and compilation do not dispatch on shipped names. A bare block constructs a descriptor, `with`
patches its named entries and may add direct keyed entries when the declaration owns a keyed item
contract. The descriptor retains its declaration identity across imports, aliases, and generated
modules.

```tao
public
type CopiedStack is nav with {
   Initial ui

   nav CopiedStackKind from ./CopiedStack.ts
}

let HomeNav = CopiedStack {
   Initial Home
}
```

`nav|provider <Export> from <path>` is a top-level, visible declaration binding rather than app or
configuration content. Its source is always a sibling `.ts` path such as `./CopiedStack.ts`, whose
named zero-argument factory generated output copies, imports, and evaluates once. It supplies the published `TR.NavKind` or `TR.DataProvider`
protocol value. Third-party declarations and the shipped `StackNav` and `Memory` declarations use
the same path and must pass the published conformance suites.

For a source module `X.tao`, the compiler emits each configurable declaration's readonly contract as
`<DeclarationName>Config`. TypeScript sidecars import it from that Tao module, for example
`import type { CopiedStackConfig } from "./X.tao"`. Recognized navigation profiles expose their
normalized `TR.NavKind` configuration; other configurable declarations expose readonly
declaration-facing properties. Unknown future navigation profiles receive a conservative readonly
string-keyed contract until their normalization is part of the compiler. This is generated
TypeScript surface, while runtime protocol behavior remains the responsibility of the published
conformance suites. An app variant retains its originating app declaration identity while replacing
or patching public app properties.

## Future directions

These are intended, not implemented. Each is expressed as working product code in the later app
tiers or catalogued as an open decision; this section only names them so the contract above stays
complete about its own boundaries.

- **Items and named types.** Item type extension, structural `like` types, and owner-qualified
  property types. Optional fields are implemented. The remaining work is sketched in
  `Apps/WordFlower/4 - Revolution` and catalogued as LANG-004 through LANG-006.
- **`match` and overloaded declarations.** Closed unions matched exhaustively, and declarations
  overloaded by argument shape. Sketched in `4 - Revolution`; LANG-006 and LANG-021.
- **Declaration properties in longhand.** A property block with `optional` and `default` entries
  alongside the header parameter form. Sketched in `4 - Revolution`; LANG-019.
- **Collection and text operators.** `has`, list subtraction, text repetition, heterogeneous list
  element unions, and richer transforms. LANG-006 and LANG-026.
- **Unit families beyond duration.** `distance`, `mass`, and the contextual `size` family, whose
  units resolve at render rather than at compile time. The mechanism is implemented; each further
  family is a row in the table, added when a real feature forces it. LANG-026.
- **Automation and lifecycle events.** Declared events and time, app, and network hooks, which
  would extend the `on` vocabulary beyond control events. LANG-020.
- **Concurrency.** A fork form plus the concurrency policy that must accompany it —
  queue, single-flight, cancel-previous, or exclusive. LANG-019 and DEF-NAV-011.
- **Errors and boundaries.** Result values, structured failure handling, and exhaustive case
  matching over them. LANG-021.

Retired forms worth knowing about, because older material may still show them: `alias` (now `let`),
`.Empty`/`.Loading`/`.Error` members (now `is empty` and subject cases), explicit `interpolate` (now
interpolated strings), condition-list `when` (now subject `when`), `for … in` (now `loop`), `.Name`
dot-arguments (now `Name:` labels), and the `project`/`publish` visibility words (now `workspace`
and `public`).
