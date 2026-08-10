# Tao Type System

This document describes the (intended) Tao type system.

Current implementation status: this repo currently supports `text` and `number` literals, coarse `list` and `item` values, `view` and `layout` declarations, the transitional `alias` binding, the state/action MVP for view-local `state`, named/inline `action`, `set`, `do`, stateful reads, and reactive rerendering, simple custom `type` declarations, typed primitive/list/item construction by juxtaposition, member access, scoped parameter type declarations, value references, invocation-only typed argument labels with `:`, and exact-first type-based render/action/item-field binding. The intended language described below replaces value `alias` with immutable `let`, expands parameters into declaration properties, and adds the closed-union assignability needed by `Presentable`; that migration is not implemented yet. Boolean, typed list elements, operators beyond MVP compound `set`, interpolation, functions, `match`, optional item fields, extension is item, and richer collection inference remain future work.

Any commented out code is WIP material and should be ignored.

## Basic typing

In these examples, `=>` means "is equivalent to". It is not part of tao syntax.

### Primitive Types and Values

Everything in Tao is "typed". This means that Tao can ensure that you don't put one type of value where another different one is expected.

Tao's scalar and structural core types include `text`, `number`, `boolean`, `item`, and `list`. Callable declaration kinds include `action`, `function`, `view`, `frame`, `layout`, `ui`, `nav`, and `dialogue`; each declaration name is a value of its corresponding callable type.

Each one can be expressed as "literals", e.g

- `number`: `1`, `-99`, `5,100,234,110`, `3.14`
- `text`: `"Hello World"`, `"Tao"`, `""` (empty text)
- `boolean`: `true`, `false`
- `item`: `Person { Name "Ro" Age 40 }`, `Person { }` (empty item of type `Person`)
- `list`: `[1 2 3]`, `[ ]` (empty list)
- `action`: `action Name { ... }` (declaration), `action { ... }` (inline)
- callable declarations: `view Name { ... }`, `ui Detail { ... }`, `nav Stack { ... }`, `action Save { ... }`, and the other declaration kinds above

```tao
// The `number` type represents any number value (inside the range -2^53 + 1 to 2^64 - 1):
<NumberLiteral> => number
number <NumberLiteral> => number
// e.g:
typeof 1 => number
typeof number 42 => number
typeof 3.14 => number

// The `text` type represents any piece of text (in utf8 encoding).
typeof <TextLiteral> => text
typeof text <TextLiteral> => text
// e.g:
typeof "Hello World" => text
typeof text "100" => text

// The `list` type:
typeof list T => list T
typeof [T ...] => list T
typeof [TypeA TypeB ...] => list TypeA | TypeB | ...
// e.g:
typeof [1 2 3] => list number
typeof ["Hello" "World"] => list text
typeof [1 "Hello" "World" true] => list number | text | boolean
typeof [number text] => list number | text

// The `item` type:
type Person is { Name Age }
typeof Person { Name "Ro" Age 40 }
  => Person

typeof boolean T => boolean
<BooleanLiteral> => boolean
boolean.<BooleanLiteral> => boolean
typeof true => boolean
typeof false => boolean
```

You can also define new types, from other ones with `type <New Type> is <Type>`:

```tao
type <New Type> is <Type>
  => <New Type> is <Type>
type Name is text
let ExampleName = Name "Ro"
  => typeof ExampleName is Name // true
  => typeof ExampleName is text // false
  => text is Name // false
type Person is { Name Age }
```

- `type <Type> is <Type>` for defining a new type, based on another
- `<TypeA> is <TypeB>` for checking if one type "comes from" the other
- Future: `type <Type> is like <Type>` may define a structural type that matches anything _like_ it; meaning it has at least the same characteristics as the other type.
- `has` for checking if a list contains a thing; and if an item has an optional property
  - `<A List> has <Value>` => true if the list contains the value
  - `<A List> has <Another List>` => true if the list contains all values of another list
  - `<An Item> has <Optional Property>` => true if the item has that optional property
- `match` for checking if a value is of a certain type and then doing something with it:

### Primitive Operators

Tao has some basic operators for its primitive types:

- `+` for number addition
- `-` for number subtraction, and list deletion
- `*` for number multiplication, and text repetition
- `/` for number division
- `and` for AND of two booleans
- `or` for OR of two booleans
- `not` for NOT of a boolean
- `has` for checking what's in a list, and whether an item has optional properties
- `{ ... }` for adding values into a piece of text

These are all the valid operations in Tao:

```tao
typeof number + number => number
typeof text + text => text

typeof number - number => number
typeof list of T - T => list of T
typeof list of T - list of T => list of T
typeof list of T has T => boolean
typeof list of T has list of T => boolean
typeof item has <OptionalProperty> => boolean

typeof number * number => number
typeof text * number => text

typeof number / number => number

typeof boolean and boolean => boolean
typeof boolean or boolean => boolean
typeof not boolean => boolean

typeof "... { text | number | boolean } ..." => text
```

Some examples:

```tao
1 + 2 => 3
"Hello" + "World" => "HelloWorld"
[1 2 3] - 2 => [1 3]
[1 2 3 4 5] - [2 4] => [1 3 5]
"Hello" * 2 => "HelloHello"
true and true => true
true and false => false
true or false => true
not true => false
"Hello {SomeText}! How are you?" => "Hello <the text>! How are you?"
```

All other uses of these operators are blocked by Tao's type system:

```tao
1 + "Hello" => Type Error!
"Hello" + [1 2 3] => Type Error!
[1 2 3] - "Hello" => Type Error!
"Hello" * [1 2 3] => Type Error!
true and "Hello" => Type Error!
true or "Hello" => Type Error!
not "Hello" => Type Error!
```

### Immutable Bindings

`let` creates a real immutable binding. It is not textual substitution, a macro, or an alternate declaration name. The binding cannot be reassigned.

In a declarative scope, a `let` expression is reevaluated when a reactive dependency changes, so views depending on it update automatically. In an action, `let` captures the expression's value for that action execution. Reusable code belongs in a `function` or a specialized declaration rather than in a code-substitution feature.

Declarative expressions are pure, so an implementation may cache a `let` between dependency revisions without changing observable behavior. Module/import cycles are permitted when they do not require an impossible eager value cycle. A value-initialization cycle with no already-available value is a diagnostic; it is never resolved from arbitrary source or import order.

During migration, the implemented `alias` keyword may remain as deprecated compatibility syntax. A source action may rewrite it only when the binding has equivalent `let` evaluation and cycle behavior. Declaration synonyms, textual substitution, and cycle-sensitive cases require an explicit migration rather than a blind keyword replacement.

```tao
let <Name> = <Expression>
  => <Name> is immutably bound to the evaluated expression
let Value1 = 1
  => Value1 => 1
let Value2 = Value1
  => Value2 => 1
typeof Value1
  => typeof 1
  => number
```

Some examples:

```tao
type Currency is text
type USD is Currency
type Price is number
type Discount is number

let Price = Price 314
let Discount = Discount 10

let DiscountPrice = Price - Price * Discount

render Text("{DiscountPrice} USD")

type Title is text
type OnPress is action

render Button("Buy", OnPress -> {
  do Purchase()
})
```

### Views: Declarations and Rendering

A `view` defines how to render some piece of UI.

When you `render` a view somewhere in the code, it displays at the corresponding place in the UI.

```tao
view <ViewName> <Parameters> { <Body> }
  => defines a callable view value named <ViewName>
render <ViewName> <Arguments> { <Body> }
  => <ViewName> appears in the UI along with its <Body>
```

Tao comes with a core library, including UI components. For example, `Text` renders any `text` value in the UI:

```tao
view Example {
  // Display `Hello ... ` in the UI:
  render Text("Hello World!")
}
```

The `render` keyword is valid inside render-bearing declarations: `view`, `frame`, `layout`, `ui`, `nav`, and `dialogue`. App roots mount a nav rather than rendering ordinary content directly.

Also, inside of any `view` the `render` keyword can be dropped - and you should:

```tao
view Example {
  Text "Hello World!" // same as `render Text "Hello World!"`
}
```

Conventional Tao is expected to drop `render` inside any `view` once render elision is implemented.

The one exception is for example code. It is useful to demonstrate using views without a wrapping `view Example { ... }` wrapper definition:

```tao
render Text("Hello World!")
// vs:
view Example {
  Text "Hello World!"
}
```

### State, Events, and Actions: Updating data when something happens

So far everything we have discussed is static - but UI is dynamic.

To represent data that changes, you declare `state` values. Any time a `state` value changes, all parts of the UI that use it also automatically update.

```tao
state IsLoggedIn false
render Text(when)
  IsLoggedIn -> "Logged in"
  otherwise -> "Logged out"
```

This boolean `when` expression is separate from type-matching `match` expressions, described later.

You use an `action` to update any `state`:

```tao
view Button Label text, OnPress action {
  Text Label
  on press -> { do OnPress() }
}

view Button2 Label text, OnPress action {
  Text Label
  on press -> { do OnPress() }
}

action OnPress {
  set IsLoggedIn = true
}

render Button("Hi", action {
  set IsLoggedIn = true
})

render Button("Hi", OnPress)
```

`do <Action>` invokes an action value. It is valid anywhere action execution is valid, such as inside a view interaction body or another action body.

Actions are ordinary typed arguments and are matched the same way as view arguments. `<Type> -> { ... }` is shorthand for creating an action value of `<Type>`. If no type appears before `->`, the type defaults to `action`.

```tao
render Button("Hi", -> {
  toggle IsLoggedIn
})

render Button2("Hi", OnPress) {
  toggle IsLoggedIn
}

render Button2("Hi", OnPress -> {
  toggle IsLoggedIn
})
```

You can use `let` in a declarative scope to create derived values that depend on `state`. The expression reevaluates whenever one of its reactive dependencies changes.

For example, a button can change its text when the user logs in; or display a user's full name:

```tao
type Title is text

let ButtonText = when
  IsLoggedIn -> Title "Logout"
  otherwise -> Title "Login"

let DisplayName = when
  IsLoggedIn -> "{FirstName} {LastName}"
  otherwise -> "Guest"
```

Another example, a "T minus ..." countdown timer that updates as every second passes. The `on ... -> { ... }` line uses future interaction/event syntax and is illustrative here:

```tao
use every from @tao/time

state Countdown 100.seconds

view CountdownTimer {
  Text "T minus {Countdown} seconds"

  on every 1.second -> {
    set Countdown = Countdown - 1
  }
}
```

Or, if we want to display it in minutes instead of seconds:

```tao
use every, Minutes from @tao/time

...

state Countdown = 100.seconds
let MinutesCountdown = Countdown.asMinutes
render Text("T minus {MinutesCountdown} minutes")
```

A `state` value can only ever be updated by an `action`; and an `action` can only ever happen in response to an `event`.

An `event` could be a user touching the screen, a push notification arriving, a network request failing, or even time passing.

For example:

```tao
state Counter = 0
Text "{Counter}"
Button "Increment", -> { set Counter += 1 }
```

All `stateful` values are _reactive_. This means that whenever something `stateful` updates value, _every_ other part of the app that refers to that state also update, immediately and automatically.

When a stateful value is rendered in a view, it always updates to its latest value.

Anytime a stateful value is used to decide what to do, e.g `if <state> > 10 { ... }`, it re-evaluates the moment the state updates.

Only in an action is a state considered as its "current" value, at the time of the action event.

The following `evaluate` lines are explanatory pseudocode for compile-time reasoning, not Tao syntax:

```tao
state Count = 0
  => typeof Count => stateful number
  => typeof evaluate Count => typeof Count
state Name = "Ro"
  => typeof Name => stateful text
  => typeof evaluate Name => typeof Name => text

// `stateful` is contagious: any expression that touches a something stateful is stateful.
let Doubled = Count * 2
  => typeof ((stateful number) + number) => (stateful number) + (stateful number) => stateful number
let Greeting = "Hi " + Name
  => typeof (text + stateful text) =..> stateful text

// `render stateful T` collapses to `T` when rendered.
view Show {
  Text Count     // render Count => render stateful number => number
  Text Doubled   // render Doubled =..> number
  Text Greeting  // render Greeting =..> text
}

// `set stateful X = stateful T` => `set stateful X = T`
action Increment {
  set Count = Count + 1
    => set Count = (stateful number) + number
    => set Count = (stateful number) + (stateful number)
    =..> set Count = number
}

// Mixing a declarative let with state produces a derived `stateful T`
let Two = 2 => typeof Two = 2 => number
let Quad = Count * Two
  => typeof Quad = (stateful number) * number
  =..> typeof Quad = stateful number
```

Notes:

- `stateful` is a **type modifier**, not a nominal `type`. It composes with any base type: `stateful number`, `stateful text`, `stateful Person`, `stateful list T`, etc.
- Reading a `stateful T` in a view or action is the only place it collapses to `T`. Elsewhere, declarative `let` expressions stay `stateful T` so downstream views and actions can subscribe.
- `set X = <expr>` requires `X` to be a `state` binding; the RHS is type-checked against `X`'s underlying `T` (after `stateful` collapse on both sides).
- Compound `set` forms such as `set X += <expr>`, `set X -= <expr>`, `set X *= <expr>`, and `set X /= <expr>` are shorthand for `set X = X <op> <expr>` using the corresponding operator.
- `toggle X` is shorthand for `set X = not X`, and requires `X` to be a boolean `state`.

### Named Types

A new type can be defined as a named variant of an existing type. Two differently named types are different, even when they have the same underlying source type.

Types and values are separate namespaces. A type is not a value and is not an expression. To create a value of a named type, use typed construction:

```tao
type Name is text
type Alias is Name
type Nickname is Alias
type AKA is Alias
type Age is number

let Name = Name "Ro"
let Age = Age 40

Name is text => true
Alias is Name => true
Name is Alias => false
text is Name => false
```

Typed construction has these forms:

```tao
<Type> <Literal>     // constructs a typed literal-shaped value, e.g. Name "Ro", Age 40, Person { ... }
<ValueA> with <ValueB> // merges two values
```

`with` produces a new value by overlaying the right value onto the left value. It never mutates the original.

For item values, matching properties from the right value replace matching properties from the left value, and properties that are only present on one side remain present in the result. For configured declaration values, the right block may replace public declaration properties only. Internal `let` bindings and runtime-owned state are not properties and cannot be patched.

```tao
type Person is { Name Age }

let PersonA = Person { Name "A" Age 1 }
let PersonB = PersonA with Person { Name "B" Age 1 }
  => Person { Name "B" Age 1 }

let PersonC = PersonA with { Name "C" }
  => Person { Name "C" Age 1 }

ui Profile {
  User User
  Theme Theme default SystemTheme
  let DisplayName = User.Name
  render ProfileBody(User DisplayName Theme)
}

let RoProfile = Profile { User Ro }
let DarkRoProfile = RoProfile with { Theme DarkTheme }
// `with { DisplayName "Other" }` is invalid because DisplayName is internal.
```

In `Value with { ... }`, the bare patch is interpreted in the type context of `Value`. Its properties are matched with the same owner-qualified rules as construction and invocation. Scalar properties named in the overlay replace the inherited scalar value. Nested item properties merge recursively with the inherited nested item value. List and keyed-collection merge semantics are deferred; initially they replace as a whole.

Two nominal types are compatible for typed value creation when they are in the same direct ancestry chain. Child-to-parent and parent-to-child type-fixing are allowed at invocation labels such as `Name: FirstName`; sibling-to-sibling type-fixing is not. A value is assignable to a closed union when its type is assignable to exactly one union member; this does not make the union a nominal ancestor for type-fixing. Structural `like` types and other overlapping shapes do not participate unless a later spec defines that explicitly.

```tao
type Name is text
type Alias is Name
type Nickname is Alias
type AKA is Alias

view NameSink Name { ... }
view AliasSink Alias { ... }
view NicknameSink Nickname { ... }

let NameValue = Name "Ro"
let AliasValue = Alias "Ro"
let NicknameValue = Nickname "Ro"

render NameSink(Alias: AliasValue)      // OK: child to parent
render AliasSink(Name: NameValue)       // OK: parent to child
render NicknameSink(AKA: NicknameValue) // Type Error: sibling to sibling
```

Action values have two extra construction shorthands:

```tao
action { ... }      // inline action value
-> { ... }          // shorthand for action { ... }
<ActionType> -> { ... } // shorthand for <ActionType> action { ... }
```

`action Name { ... }` is a declaration form and is only valid where declarations are allowed. Inline action values are only valid in expression or argument positions.

Named type values keep their named type at compile time, even when evaluating them produces the same underlying value as their parent type:

```tao
type <NewType> is <SubType>
  => <NewType> is <SubType>

type Name is text
type FirstName is Name

let Name = Name "Ro"
let FirstName = FirstName "Ro"

evaluate Name
  => "Ro"
evaluate FirstName
  => "Ro"

typeof Name
  => Name
typeof FirstName
  => FirstName

FirstName is Name
  => true
Name is FirstName
  => false

view NameSink Name { ... }

state CurrentFirstName = FirstName "Ro"

set CurrentFirstName = Name "Mo"
  => Type Error

render NameSink(FirstName: CurrentFirstName)
  => OK
```

### Declaration Shorthands

Bindings and state use explicit assignment:

```tao
let <Name> = <Value>
  => <Name> becomes <Value>
  => typeof <Name> => typeof <Value>

state <Name> = <Value>
  => <Name> becomes stateful <Value>
  => typeof <Name> => stateful typeof <Value>

let Width = 30
  => typeof Width => number

state Height = 30
  => typeof Height => stateful number

let FirstName = FirstName "Joe"
  => typeof FirstName is FirstName

type LastName is text
state LastName "Doe"
  => state LastName = stateful LastName "Doe"
  => typeof LastName is stateful LastName
```

## Callable Declarations

```tao
view <ViewName> <Parameters> { <Body> }
  => defines a callable view value named <ViewName>

action <ActionName> <Parameters> { <Body> }
  => defines a callable action value named <ActionName>
```

Apps, functions, frames, layouts, UI, navs, and dialogues use the same declaration-property and configured-value model. Their distinct keywords add role-specific validation and behavior; they do not introduce separate argument systems. An app is not invoked as UI, but `App with { ... }` creates another immutable launch configuration that retains the originating app declaration ID.

A declaration name denotes its callable definition. In a context that requires a configured value, a declaration with no required properties is implicitly applied with zero arguments; this is why `Initial HomeUi` and `present HomeUi` are valid. A context that expects a callable-definition type receives the definition without applying it. An unconstrained `let Home = HomeUi` therefore binds the definition; use `let ConfiguredHome = HomeUi {}` when an explicit configured descriptor is required without an expected type. Parameterized declarations always require normal application.

### Declaration Properties And Arguments

A callable declaration defines its public inputs as properties. Header parameters are shorthand for the same property slots; they do not form a second parameter system.

```tao
view Profile User {
   render Text(User.Name)
}

// Equivalent public property surface:
view ProfileLonghand {
   User User
   render Text(User.Name)
}
```

A property may accept an existing named type, create an owner-qualified type from a source type, be optional, or have a default:

```tao
view PersonLine {
   Person Person
   Label text
   optional Subtitle text
   Density number default 1

   render Text("{Label}: {Person.Name}")
}
```

`Label text` creates the nominal slot type `PersonLine.Label` based on `text`; `Subtitle text` and `Density number` similarly create owner-qualified types. Existing-type shorthand such as `Person Person` can be written as bare `Person` when the property and accepted type have the same name.

The header form uses the same rules:

```tao
view PersonLine Person, Label text, optional Subtitle text { ... }
```

Omitting an optional property binds `none`; spelling `default none` is redundant. Omitting a defaulted property binds the normalized default value. An invocation must bind every other required property. Partial application is deferred.

Arguments may appear inline or in a property block:

```tao
render Profile(User)

render PersonLine() {
   Person(User)
   Label("Owner")
   Subtitle("Active")
}
```

Property constructors such as `Label "Owner"` explicitly name their destination slot. This is preferred whenever multiple slots accept the same source type.

### Argument Matching

Arguments are not positional. A declaration's slots are owner-qualified even when several accept the same source type. Matching proceeds in this order:

1. Bind explicitly named property entries such as `Label "Owner"`.
2. Bind values whose exact type is one unbound owner-qualified slot type.
3. Bind remaining values by exact accepted type, then by nominal type lineage, only when one complete assignment is possible.
4. Bind a remaining value to a closed-union slot only when it is assignable to exactly one member and one complete assignment remains.
5. Apply normalized defaults and `none` for omitted optional slots.
6. Error on an unmatched argument, an unbound required slot, or more than one complete assignment.

Source order never resolves an ambiguity. Duplicate source types are valid in a declaration because their slot types are distinct, but bare literals cannot choose between them:

```tao
view TextPair {
   Primary text
   Secondary text
   render Text("{Primary} / {Secondary}")
}

render TextPair(Primary "A", Secondary "B") // OK
render TextPair(TextPair.Primary "A", TextPair.Secondary "B") // OK
render TextPair("A", "B") // Type Error: ambiguous text arguments
```

The invocation-only `<Type>: <Value>` form remains valid when a caller needs to construct an exact argument type explicitly. Exact and nominal slots take priority over closed-union membership so a broad union cannot steal an argument from a more specific property. Two compatible union slots remain ambiguous unless explicitly named. Structural `like` types and other overlapping shapes do not participate in matching unless a later specification defines their behavior.

Item construction and declaration invocation use the same owner-qualified matching algorithm. Render children do not: ordinary render expressions in a caller block remain children and are never consumed as declaration properties solely because their types happen to match. Named render slots are also separate from property slots.

A keyed collection property written `{ @ EntryType }` accepts arbitrary stable entries such as `@home { ... }`. A caller may place literal keyed entries directly in the configured declaration when owner-qualified matching can assign them to one keyed-collection property:

```tao
Nav.SelectionNav {
   Initial @home

   @home {
      Label "Home"
      Content HomeStack
   }
}
```

This is equivalent to wrapping the entry in `Items { ... }`; `Items` remains available for an empty, prebuilt, computed, or otherwise explicitly named collection. Direct entries are aggregated before property matching. If their entry types admit more than one complete keyed-property assignment, the caller must name the destination property. Supplying both direct entries and an explicit value for the same property is a duplicate-property error.

Every targetable key owned by one configured declaration belongs to that owner's key namespace and must be unique there, whether supplied directly or through an explicit property and even when different keyed properties receive the entries. A nested configured declaration begins a new namespace. Ordinary non-targetable keyed data remains scoped to its property and may reuse names. Property names such as `Items`, `Panes`, and `Auxiliaries` organize descriptor data but do not become target-path segments.

Each entry creates an owner-qualified key value throughout the containing invocation. A dependent property may accept `key of Items`, meaning one key assigned to that configured `Items` property. References such as `Initial @home` resolve independently of source order and cannot escape their configured owner without an explicitly declared key type.

Direct keyed entries in `Value with { ... }` configure and replace the complete matched keyed-collection property, exactly like its explicit property form. They do not introduce implicit key-by-key merging.

Actions, functions, views, UI, navs, dialogues, frames, and layouts all use these declaration-property and argument rules.

```tao
view Button Label text, OnPress action {
  Text Label
  on press -> { do OnPress() }
}

view Button2 Label text, OnPress action {
  Text Label
  on press -> { do OnPress() }
}

action OnPress {
  do Save()
}

action Save {
  ...
}

render Button("Hi", action {
  do Save()
})

render Button("Hi", OnPress)

render Button("Hi", -> {
  do Save()
})

render Button2("Hi", OnPress) {
  do Save()
}

render Button2("Hi", OnPress -> {
  do Save()
})
```

## Match Expressions and Overloaded Views

A closed union is declared with `type Name is A | B | ...`. A configured value of any member is assignable to the union, while `view`, `dialogue`, or any other nonmember is not. Nested named unions flatten for membership checks, duplicate members are rejected, and a value compatible with multiple overlapping members requires explicit type construction rather than order-based selection.

Use `match` to branch by type:

Inside each `when` branch, the matched value is narrowed to that branch's type. The `match` expression's result type is the union of its branch result types, and that union must type-check wherever the match expression is used.

```tao
type Cat is text | number
let Cat = Cat 1

render Text(match Cat)
  when text -> Cat
  when number -> "{Cat + 9}"
```

Overloaded views can use the same `match` shape. Each `when` clause declares the parameter types available in that branch; names bind the same way as ordinary view parameters.

```tao
view ViewA match
  when Age -> { Text Age }
  when Name -> { Text Name }
  when Age, Name -> { Text "{Age} {Name}" }
  when Name, Age -> { ... } // Type Error: duplicate case matches previous case
```

## Items (Objects/Structs)

An item type has properties. Each property is a typed value. Item construction uses `Type { ... }`; bare `{ ... }` is reserved for bodies and content blocks. In a type definition, `ItemType + { ... }` creates a new item type by adding or refining properties from the right-hand shape.

```tao
type Person is { Name Age }
type Person2 is { Name text Age } // creates type Person2.Name

let PersonA = Person { Name "A" Age 1 }
let PersonB = PersonA with Person { Name "B" Age 1 }
let PersonC = PersonA with { Name "C" }
```

For items, the right value overrides matching properties from the left value, and the result has the merged item type. A bare `{ ... }` patch is allowed as the right operand of `with`; it is interpreted in the type context of the left item value.

Item properties use the same owner-qualified matching rules as declaration arguments. They are not positional.

```tao
type FirstName is text
type LastName is text
type Age is number
type Person is { FirstName LastName Age }

let Person1 = Person { FirstName "Ro" LastName "Cat" Age 40 } // OK
let Person2 = Person { "Ro" 40 }                              // Type Error
let Person3 = Person { "Ro" "Cat" 40 }                        // Type Error

let RoAge = Age 40
let Person4 = Person { FirstName "Ro" LastName "Cat" RoAge }   // OK, RoAge type-matches Age
```

Inline item property types create scoped property types:

```tao
let Name = Name "Ro"
let Age = Age 40

type LastName is Name
type FullNamePerson is Person + { LastName }
let FullNamePerson = FullNamePerson { Name Age LastName "Johnsson" }

type FullNamePerson2 is Person + { LastName text }
let LastName = LastName "Petterson"

let Bad = FullNamePerson2 { Name Age LastName }              // Type Error: LastName value is the outer LastName type
let OK = FullNamePerson2 { Name Age LastName "West" }         // OK: LastName type resolves to the scoped property type
let OK2 = FullNamePerson2 { Name Age LastName "West" } // OK: typed construction uses the scoped property type

type FullNamePerson3 is Person + { LastName }
type FullNamePerson4 is Person + { LastName FullNamePerson2.LastName }
```

Inside item construction, scoped property constructors are available in the constructor's argument scope and shadow outer values with the same name. This is the same scoping rule used by declaration invocation arguments. Outside the constructor argument scope, `LastName` still refers to the outer type/value.

Owner-qualified property types are part of the item or declaration type and can be referenced with their qualified name, such as `FullNamePerson2.LastName` or `PersonLine.Label`.
