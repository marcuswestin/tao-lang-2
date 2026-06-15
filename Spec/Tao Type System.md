# Tao Type System

This document describes the (intended) Tao type system.

Any commented out code is WIP material and should be ignored.

## Basic typing

In these examples, `=>` means "is equivalent to". It is not part of tao syntax.

### Primitive Types and Values

Everything in Tao is "typed". This means that Tao can ensure that you don't put one type of value where another different one is expected.

Tao's primitive types are `text`, `number`, `item`, `list`, `view`, `action`, and `boolean`

Each one can be expressed as "literals", e.g

- `number`: `1`, `-99`, `5,100,234,110`, `3.14`
- `text`: `"Hello World"`, `"Tao"`, `""` (empty text)
- `boolean`: `true`, `false`
- `item`: `Person.{ Name."Ro", Age.40 }`, `Person.{ }` (empty item of type `Person`)
- `list`: `[1, 2, 3]`, `[ ]` (empty list)
- `action`: `action Name { ... }` (declaration), `action { ... }` or `action.{ ... }` (inline)
- `view`: `view Name { ... }` (declaration)

```tao
// The `number` type represents any number value (inside the range -2^53 + 1 to 2^64 - 1):
<NumberLiteral> => number
number.<NumberLiteral> => number
// e.g:
typeof 1 => number
typeof number.42 => number
typeof 3.14 => number

// The `text` type represents any piece of text (in utf8 encoding).
typeof <TextLiteral> => text
typeof text.<TextLiteral> => text
// e.g:
typeof "Hello World" => text
typeof text."100" => text

// The `list` type:
typeof list T => list T
typeof [T, ...] => list T
typeof [TypeA, TypeB, ...] => list TypeA | TypeB | ...
// e.g:
typeof [1, 2, 3] => list number
typeof ["Hello", "World"] => list text
typeof [1, "Hello", "World", true] => list number | text | boolean
typeof [number, text] => list number | text

// The `item` type:
type Person is { Name, Age }
typeof Person.{ Name."Ro", Age.40 }
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
alias ExampleName = Name."Ro"
  => typeof ExampleName is Name // true
  => typeof ExampleName is text // false
  => text is Name // false
type Person is { Name, Age }
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
[1, 2, 3] - 2 => [1, 3]
[1, 2, 3, 4, 5] - [2, 4] => [1, 3, 5]
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
"Hello" + [1, 2, 3] => Type Error!
[1, 2, 3] - "Hello" => Type Error!
"Hello" * [1, 2, 3] => Type Error!
true and "Hello" => Type Error!
true or "Hello" => Type Error!
not "Hello" => Type Error!
```

### Type of Aliases

An `alias` allows to reference values and expressions by name.

The value of an `alias` will _always automatically update_ in real-time to reflect the referenced expression's value.

Conceptually, you could substitute any `alias` name with its right-hand value at any time and anywhere in your code.

```tao
alias <AliasName> = <Expression>
  => <AliasName> becomes <Expression>
alias Alias1 = 1
  => Alias1 => 1
alias Alias2 = Alias1
  => Alias2 => Alias1 => 1
typeof Alias1
  => typeof 1
  => number
```

Some examples:

```tao
type Currency is text
type USD is Currency
type Price is number
type Discount is number

alias Price = Price.314
alias Discount = Discount.10

alias DiscountPrice = Price - Price * Discount

render Text "{DiscountPrice} USD"

type Title is text
type OnPress is action

render Button "Buy", OnPress -> {
  do Purchase
}
```

### Views: Declarations and Rendering

A `view` defines how to render some piece of UI.

When you `render` a view somewhere in the code, it displays at the corresponding place in the UI.

```tao
view <ViewName> <Parameters> { <Body> }
  => alias <ViewName> = view <Parameters> { <Body> }
render <ViewName> <Arguments> { <Body> }
  => <ViewName> appears in the UI along with its <Body>
```

Tao comes with a core library, including UI components. For example, `Text` renders any `text` value in the UI:

```tao
view Example {
  // Display `Hello ... ` in the UI:
  render Text "Hello World!"
}
```

The `render` keyword can only be used inside of other views - Tao will take care of rendering your root view for you

Also, inside of any `view` the `render` keyword can be dropped - and you should:

```tao
view Example {
  Text "Hello World!" // same as `render Text "Hello World!"`
}
```

Conventional Tao is expected to drop `render` inside any `view` once render elision is implemented.

The one exception is for example code. It is useful to demonstrate using views without a wrapping `view Example { ... }` wrapper definition:

```tao
render Text "Hello World!"
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
render Text when
  IsLoggedIn -> "Logged in"
  otherwise -> "Logged out"
```

This boolean `when` expression is separate from type-matching `match` expressions, described later.

You use an `action` to update any `state`:

```tao
view Button text as Label, action as OnPress {
  Text Label
  on press -> { do OnPress }
}

view Button2 text as Label, OnPress is action {
  Text Label
  on press -> { do OnPress }
}

action OnPress {
  set IsLoggedIn = true
}

render Button "Hi", action {
  set IsLoggedIn = true
}

render Button "Hi", OnPress
```

`do <Action>` invokes an action value. It is valid anywhere action execution is valid, such as inside a view interaction body or another action body.

Actions are ordinary typed arguments and are matched the same way as view arguments. `<Type> -> { ... }` is shorthand for `<Type>.{ ... }`. If no type appears before `->`, the type defaults to `action`.

```tao
render Button "Hi", -> {
  toggle IsLoggedIn
}

render Button2 "Hi", OnPress.{
  toggle IsLoggedIn
}

render Button2 "Hi", OnPress -> {
  toggle IsLoggedIn
}
```

You can use `alias` to create new values that depend on other `state`. It will always change automatically whenever a `state` that it uses changes.

For example, a button can change its text when the user logs in; or display a user's full name:

```tao
type Title is text

alias ButtonText when
  IsLoggedIn -> Title."Logout"
  otherwise -> Title."Login"

alias DisplayName when
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
alias MinutesCountdown = Countdown.asMinutes
render Text "T minus {MinutesCountdown} minutes"
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
alias Doubled = Count * 2
  => typeof ((stateful number) + number) => (stateful number) + (stateful number) => stateful number
alias Greeting = "Hi " + Name
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

// Mixing an alias with a state becomes `stateful T`
alias Two = 2 => typeof Two = 2 => number
alias Quad = Count * Two
  => typeof Quad = (stateful number) * number
  =..> typeof Quad = stateful number
```

Notes:

- `stateful` is a **type modifier**, not a nominal `type`. It composes with any base type: `stateful number`, `stateful text`, `stateful Person`, `stateful list T`, etc.
- Reading a `stateful T` in view or action position is the only place it collapses to `T`. Elsewhere (e.g. in a top-level `alias`), expressions stay `stateful T` so downstream views/actions can subscribe.
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

alias Name = Name."Ro"
alias Name "Ro" // shorthand for: alias Name = Name."Ro"
alias Age 40    // shorthand for: alias Age = Age.40

Name is text => true
Alias is Name => true
Name is Alias => false
text is Name => false
```

Typed construction has these forms:

```tao
Type.<Literal>       // constructs a typed value, e.g. Name."Ro", Age.40, Person.{ ... }
<Value> as <Type>   // type-fixes a compatible value, e.g. "Ro" as Name
<ValueA> with <ValueB> // merges two values
```

`with` produces a new value by overlaying the right value onto the left value. For item values, matching properties from the right value replace matching properties from the left value, and properties that are only present on one side remain present in the result.

```tao
type Person is { Name, Age }

alias PersonA = Person.{ Name."A", Age.1 }
alias PersonB = PersonA with Person.{ Name."B", Age.1 }
  => Person.{ Name."B", Age.1 }

alias PersonC = PersonA with { Name."C" }
  => Person.{ Name."C", Age.1 }
```

In `Value with { ... }`, the bare item patch is interpreted in the type context of `Value`. Its properties are matched with the same rules as item construction. Scalar properties named in the overlay replace the inherited scalar value. Nested item properties merge recursively with the inherited nested item value. List and collection merge semantics are deferred; until explicit append/remove syntax exists, list-like properties replace as a whole. Overlays do not mutate the base value.

Two types are compatible for `as` when they are in the same direct ancestry chain. Child-to-parent and parent-to-child type-fixing are allowed; sibling-to-sibling type-fixing is not. Union types, structural `like` types, and other overlapping shapes do not participate in `as` unless a later spec defines that explicitly.

```tao
type Name is text
type Alias is Name
type Nickname is Alias
type AKA is Alias

alias Alias = Name."Ro" as Alias         // OK: parent to child
alias ParentName = Alias."Ro" as Name    // OK: child to parent
alias Nickname = AKA."Ro" as Nickname    // Type Error: sibling to sibling
```

Action values have two extra construction shorthands:

```tao
action { ... }      // shorthand for action.{ ... }
-> { ... }          // shorthand for action.{ ... }
<ActionType> -> { ... } // shorthand for <ActionType>.{ ... }
```

`action Name { ... }` is a declaration form and is only valid where declarations are allowed. Inline action values are only valid in expression or argument positions.

Named type values keep their named type at compile time, even when evaluating them produces the same underlying value as their parent type:

```tao
type <NewType> is <SubType>
  => <NewType> is <SubType>

type Name is text
type FirstName is Name

alias Name = Name."Ro"
alias FirstName = FirstName."Ro"

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

alias AlsoName = FirstName as Name
  => typeof AlsoName => Name

state CurrentFirstName = FirstName."Ro"

set CurrentFirstName = Name."Mo"
  => Type Error

set CurrentFirstName = Name."Mo" as FirstName
  => OK
```

### Declaration Shorthands

You can shorthand common declarations when the binding name is also the type name:

```tao
alias <Name> = <Value>
  => <Name> becomes <Value>
  => typeof <Name> => typeof <Value>

state <Name> = <Value>
  => <Name> becomes stateful <Value>
  => typeof <Name> => stateful typeof <Value>

alias Width = 30
  => typeof Width => number

state Height = 30
  => typeof Height => stateful number

alias <NamedType> <Value>
  => alias <NamedType> = <NamedType>.<Value>

// The shorthand only works when <NamedType> is already a declared type.
alias Name2 "Bar"
  => Type Error

alias FirstName "Joe"
  => alias FirstName = FirstName."Joe"
  => typeof FirstName is FirstName

type LastName is text
state LastName "Doe"
  => state LastName = stateful LastName."Doe"
  => typeof LastName is stateful LastName
```

## Views and Actions

```tao
view <ViewName> <Parameters> { <Body> }
  => alias <ViewName> = view <Parameters> { <Body> }

action <ActionName> <Parameters> { <Body> }
  => alias <ActionName> = action <Parameters> { <Body> }
```

### Parameters and Arguments

Parameters are types. A parameter signature is a dictionary of `<Type> -> <Alias>` pairs. When no alias is given, the type name is also the value alias inside the view body.

Primitive source types such as `text`, `number`, and `boolean` must use `as <Alias>` when used directly as parameters, because the primitive type name itself is not a value alias authors can use in expressions.

```tao
view <Name> <Type> [is <ParentType>] [as <ScopedAlias>] [, <MoreTypes> ...] { ... }

view Profile Person {
  Text Person.Name + " " + Person.Age
}

view TextX text { ... } // Type Error: primitive source type needs an alias

view Text1 text as Value {
  Text Value
}

view Text3 text as Value, Postfix is text {
  Text Value + Postfix
}
```

Conceptually, the parameter signature is a dictionary. The declaration decides both which argument type is accepted and which value alias is available in the body:

```tao
view V1 Foo { ... }
  => parameters: Foo -> Foo

view V2 Foo, Cat is text { ... }
  => parameters: Foo -> Foo, V2.Cat -> Cat

view V3 Foo, Cat is Mat as Bar { ... }
  => parameters: Foo -> Foo, V3.Cat -> Bar

view V4 Foo as Moo, Cat is text as Bar, Mat is text { ... }
  => parameters: Foo -> Moo, V4.Cat -> Bar, V4.Mat -> Mat
```

Inline parameter types create types scoped to the view. During invocation argument resolution, those scoped types are available in the invocation's argument scope and shadow outer types with the same name.

Inline types are possible, but they are mostly for local specificity. Prefer top-level named types when a concept is reusable across views or items.

```tao
type Name is text
type Age is number

view View1 Name, Age { }
view View2 Name is text, Age { } // defines View2.Name

render View1 Name."Ro", Age.40 { }
render View2 Name."Ro", Age.40 { }       // Name means View2.Name in View2's argument scope
render View2 View2.Name."Ro", Age.40 { } // equivalent
render View2 Name, Age { }               // Type Error: Name and Age are types, not values
```

Scoped parameter types are not meant to be referenced outside the view invocation. A future design may allow references such as `View2.Name` in more places, but this spec only relies on invocation argument scope.

Mixed scoped and outer parameters follow the same rule:

```tao
view Foo Name, Name2 is text, Alias, Nickname, AKA is Alias { ... }

render Foo Name."Name", Name2."Name2", Alias."Foo", Nickname."Bar", AKA."QWE" { }
// AKA resolves to Foo.AKA in Foo's argument scope. Alias and Nickname resolve to outer types.
```

### Argument Matching

Arguments are matched by exact type first, then by unambiguous type lineage. They are not matched by source order.

No two parameters may have the same exact type. No two provided arguments may have the same exact type before resolution.

Lineage matching assumes nominal, single-parent type ancestry. Union types, structural `like` types, and other overlapping shapes do not participate in lineage matching unless they are exact matches or the caller explicitly type-fixes with `as`.

Argument and item-property matching use the same rules:

- If any two provided arguments have the same exact type before resolution, error.
- If any two parameters have the same exact type, error.
- Resolve exact argument-parameter type matches.
- If any two unmatched arguments share lineage, excluding only the root literal type such as `text` or `number`, error.
- If any two unmatched parameters share lineage, excluding only the root literal type such as `text` or `number`, error.
- To manually disambiguate either case, the caller can type-specify first, such as `render V C."X" as B`.
- For each remaining unmatched argument, attempt to match it by type lineage.
- If the remaining unmatched arguments have more than one complete valid assignment, error.
- If any unmatched arguments remain, error.
- If any unmatched required parameters remain, error.
- Optional parameters may remain unmatched.

Multiple parameters may share lineage as long as they do not have the same exact type, but callers must provide exact or explicitly type-fixed arguments for enough of them that no ambiguous unmatched lineage remains.

Optional parameter syntax is still a separate design. The rule above only reserves how omitted optional parameters behave once that syntax exists.

```tao
view Text1 text as Value { ... }
render Text1 "Foo"        // OK, equivalent to text."Foo"

type String is text
type Alias is text
render Text1 String."Foo" // OK, String unambiguously matches text by lineage

view Text3 text as Value, Postfix is text { ... }
render Text3 "Foo", "Bar"              // Type Error: two provided text arguments
render Text3 "Foo", Postfix."Bar"      // OK
render Text3 text."Foo", "Bar"         // Type Error: two provided text arguments
render Text3 Postfix."Foo", "Bar"      // OK, Postfix exact-matches first, then "Bar" matches text
render Text3 Alias."Foo", Postfix."Bar" // OK
render Text3 "Foo" as Postfix, "Bar"   // OK, caller type-specifies to disambiguate

view Text4 text as Value, String { ... }
render Text4 "Foo", String."Bar" // OK
render Text4 String."Bar", "Foo" // OK
render Text4 "Foo", "Bar"        // Type Error: two provided text arguments
render Text4 "Foo", text."Bar"   // Type Error: two provided text arguments
```

Actions use the same parameter and argument rules as views.

```tao
view Button text as Label, action as OnPress {
  Text Label
  on press -> { do OnPress }
}

view Button2 text as Label, OnPress is action {
  Text Label
  on press -> { do OnPress }
}

action OnPress {
  do Save
}

action Save {
  ...
}

render Button "Hi", action {
  do Save
}

render Button "Hi", OnPress

render Button "Hi", -> {
  do Save
}

render Button2 "Hi", OnPress.{
  do Save
}

render Button2 "Hi", OnPress -> {
  do Save
}
```

## Match Expressions and Overloaded Views

Use `match` to branch by type:

Inside each `when` branch, the matched value is narrowed to that branch's type. The `match` expression's result type is the union of its branch result types, and that union must type-check wherever the match expression is used.

```tao
type Cat is text | number
alias Cat 1

render Text match Cat
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

An item type has properties. Each property is a typed value. Item construction uses `Type.{ ... }`; bare `{ ... }` is reserved for bodies and content blocks. In a type definition, `ItemType + { ... }` creates a new item type by adding or refining properties from the right-hand shape.

```tao
type Person is { Name, Age }
type Person2 is { Name is text, Age } // creates type Person2.Name

alias PersonA = Person.{ Name."A", Age.1 }
alias PersonB = PersonA with Person.{ Name."B", Age.1 }
alias PersonC = PersonA with { Name."C" }
```

For items, the right value overrides matching properties from the left value, and the result has the merged item type. A bare `{ ... }` patch is allowed as the right operand of `with`; it is interpreted in the type context of the left item value.

Item properties are matched with the same rules as view arguments. They are not positional.

```tao
type FirstName is text
type LastName is text
type Age is number
type Person is { FirstName, LastName, Age }

alias Person1 = Person.{ FirstName."Ro", LastName."Cat", Age.40 } // OK
alias Person2 = Person.{ "Ro", 40 }                               // Type Error
alias Person3 = Person.{ "Ro", "Cat", 40 }                        // Type Error

alias RoAge = Age.40
alias Person4 = Person.{ FirstName."Ro", LastName."Cat", RoAge }   // OK, RoAge type-matches Age
```

Inline item property types create scoped property types:

```tao
alias Name "Ro"
alias Age 40

type LastName is Name
type FullNamePerson is Person + { LastName }
alias FullNamePerson = FullNamePerson.{ Name, Age, LastName."Johnsson" }

type FullNamePerson2 is Person + { LastName is text }
alias LastName "Petterson"

alias Bad = FullNamePerson2.{ Name, Age, LastName }              // Type Error: LastName value is the outer LastName type
alias OK = FullNamePerson2.{ Name, Age, LastName."West" }         // OK: LastName type resolves to the scoped property type
alias OK2 = FullNamePerson2.{ Name, Age, text."West" as LastName } // OK: explicit type-fix to the scoped property type

type FullNamePerson3 is Person + { LastName }
type FullNamePerson4 is Person + { LastName is FullNamePerson2.LastName }
```

Inside item construction, scoped property types are available in the constructor's argument scope and shadow outer types with the same name. This is the same scoping rule used by view invocation arguments. Outside the constructor argument scope, `LastName` still refers to the outer type/value.

Unlike view parameter scoped types, item property scoped types are part of the item type and can be referenced with their qualified name, such as `FullNamePerson2.LastName`.
