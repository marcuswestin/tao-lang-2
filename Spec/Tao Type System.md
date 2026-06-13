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
- `item`: `{ Name "Ro", Age 40 }`, `{ }` (empty item)
- `list`: `[1, 2, 3]`, `[ ]` (empty list)
- `action`: `action Name { ... }` (declaration), `action { ... }` (inline)
- `view`: `view Name { ... }` (declaration)

```tao
// The `number` type represents any number value (inside the range -2^53 + 1 to 2^64 - 1):
number T => number
<NumberLiteral> => number <NumberLiteral> => number
// e.g:
typeof 1 => typeof number 1 => number
typeof 42 => typeof number 42 => number
typeof 3.14 => typeof number 3.14 => number

// The `text` type represents any piece of text (in utf8 encoding).
typeof text T => text
typeof <TextLiteral> => typeof text <TextLiteral> => text
// e.g:
typeof "Hello World" => typeof text "Hello World" => text
typeof "100" => typeof text "100" => text

// The `list` type:
typeof list T => list T
typeof <ListLiteral of T> => list typeof Ts => list Ts
typeof [TypeA, TypeB, ...] => list TypeA | TypeB | ...
// e.g:
typeof [1, 2, 3] => list number
typeof ["Hello", "World"] => list text
typeof [1, "Hello", "World", true] => list number | text | boolean
typeof [number, text] => list number | text

// The `item` type:
typeof </* Any item literal with properties `KeyN ValueN` */>
  => item { Key1 typeof Value1, Key2 typeof Value2, ... }
typeof { Name: "Ro", Age: 40 }
  => item { Name: typeof "Ro", Age: typeof 40 }
  => item { Name: text, Age: number }

typeof boolean T => boolean
typeof </* Any boolean literal */> => typeof boolean <literal> => boolean
typeof true => boolean
typeof false => boolean
```

You can also define new types, from other ones with `type <New Type> is <Type>`:

```tao
type <New Type> is <Type>
  => <New Type> is <Type>
type Name is text
  => typeof Name is Name // true
  => typeof Name is text // false
  => typeof text is Name // false
type Person is { Name text, Age number }
```

- `type <Type> is <Type>` for defining a new type, based on another
- `<TypeA> is <TypeB>` for checking if one type "comes from" the other
- `type <Type> is like <Type>` for defining a type that matches anything _like_ it; meaning it has at least the same characteristics as the other type.
- `has` for checking if a list contains a thing; and if an item is missing any optional properties
  - `<A List> has <Value>` => true if the list contains the value
  - `<A List> has <Another List>` => true if the list contains all values of another list
  - `<An Item> has <Optional Property>` => true if the item has a `Name` property
- `when` for checking if a value is of a certain type and then doing something with it:

### Primitive Operators

Tao has some basic operators for its primitive types:

- `+` for number addition
- `-` for number subtraction, and list deletion
- `*` for number multiplication, and text repetition
- `/` for number division
- `and` for AND of two booleans
- `or` for OR of two booleans
- `not` for NOT of a boolean
- `has` for checking what's in a list, and whether an item is missing properties
- `${ ... }` for adding values into a piece of text

These are all the valid operations in Tao:

```tao
typeof number + number => number
typeof text + text => text

typeof number - number => number
typeof list of T - T => list of T
typeof list of T - list of T => list of T

typeof number * number => number
typeof text * number => text

typeof number / number => number

typeof boolean and boolean => boolean
typeof boolean or boolean => boolean
typeof boolean not boolean => boolean

typeof "... ${ text | number | boolean } ..." => text
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
"Hello ${ <some text>! How are you? }" => "Hello <the text>! How are you?"
```

All other uses of these operators are blocked by Tao's type system:

`````tao
1 + "Hello" => Type Error!
"Hello" + [1, 2, 3] => Type Error!
[1, 2, 3] - "Hello" => Type Error!
[1, 2, 3] - [1, 2, 3] => Type Error!
"Hello" * [1, 2, 3] => Type Error!
true and "Hello" => Type Error!
true or "Hello" => Type Error!
not "Hello" => Type Error!

### Type of Aliases

An `alias` allows to reference values and expressions by name.

The value of an `alias` will _always automatically update_ in real-time to reflect the referenced expression's value.

Conceptually, you could substiture any `alias` name with its right hand value at any time and anywhere in your code.

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
alias Price = 3.14 USD

alias DiscountPrice = Price - Price * Discount is Price

func DiscountPrice Price, Discount is Price {
  return Price - (Price * Discount)
}

render Text "${DiscountPrice(Price, 10%)} USD"

render Button Title "Buy", OnPress action { .. }

render Button "Buy", action { ... }

render Button Title."Buy", OnPress.action { ... }




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

You use an `action` to update any `state`:

```tao
render Button "Login", OnPress action {
  set IsLoggedIn true
}
```

Actions can be shorthanded with `->`, and be Type Matched in arguments. This gives a concise syntax for most views that want an action:

```tao
render Button ButtonText, -> {
  toggle IsLoggedIn
}
```

You can use `alias` to create new values that depend on other `state`. It will always change automatically whenever a `state` that it uses changes.

For example, a button can change its text when the user logs in; or display a user's full name:

```tao
alias ButtonText when
  IsLoggedIn -> "Logout"
  otherwise -> "Login"

alias DisplayName when
  IsLoggedIn -> "${FirstName} ${LastName}"
  otherwise -> "Guest"
```

Another example, a "T minus ..." countdown timer that updates as every second passes:

```tao
use every from @tao/time

state Countdown 100.seconds

view CountdownTimer {
  Text "T minus ${Countdown} seconds"

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
render Text "${T minus ${MinutesCountdown} minutes}"
```

A `state` value can only ever be updated by an `action`; and an `action` can only ever happen in response to an `event`.

An `event` could be a user touching the screen, a push notification arriving, a network request failing, or even time passing.

For example:

````tao
state Counter = 0
Text Value Counter
Button Title, OnPress -> { set Counter += 1 }

All `stateful` values are *reactive*. This means that whenever something `stateful` updates value, *every* other part of the app that refers to that state also update, immediately and automatically.

When a stateful value is rendered in a view, it always updates to its latest value.

Anytime a stateful value is used to decide what to do, e.g `if <state> > 10 { ... }`, it re-evaluates the moment the state updates.

Only in an action is a state considered as its "current" value, at the time of the action event.

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
  Text value Count     // render Count => render stateful number => number
  Text value Doubled   // render Doubled =..> number
  Text value Greeting  // render Greeting =..> text
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
`````

Notes:

- `stateful` is a **type modifier**, not a nominal `type`. It composes with any base type: `stateful number`, `stateful text`, `stateful Person`, `stateful list T`, etc.
- Reading a `stateful T` in view or action position is the only place it collapses to `T`. Elsewhere (e.g. in a top-level `alias`), expressions stay `stateful T` so downstream views/actions can subscribe.
- `set X = <expr>` requires `X` to be a `state` binding; the RHS is type-checked against `X`'s underlying `T` (after `stateful` collapse on both sides).

### Named Types

A new type can be defined as a named variant of an existing type. Two differently named types are always different, even when they have the same underlying value type. A named type can also allow for having an `optional` value, in which case it either has a value, or it is `missing`.

```tao
type <NewType> is <SubType>
  => evaluate <NewType> => evaluate <SubType>
  => <NewType Value> <SubType Value> => <NewType Value>
  => <SubType Value> <NewType Value> // Type Error!
  => set <state NewType> = <SubType Value> // Type Error!
  => set <state NewType> = <NewType Value> <SubType Value> // OK

type Name is text
type FirstName is Name
type LastName is Name

state UserName = Name "John"
  => set UserName = Name "Johnny" // OK
  => set UserName = "Johnny" // Type Error!

<TypeA> is <TypeB> == true when <TypeA> is a subtype of <TypeB>

FirstName is Name => true
LastName is Name => true
Name is FirstName => false
FirstName is LastName => false
Name is text => true
FirstName is text => true
text is Name => false
```

### Declaration Shorthands

You can shorthand many declarations.

```tao
alias <Name> = <Value>
  => alias <Name> = (typeof <Value>) <Value>
state <Name> = <Value>
  => state <Name> = stateful (typeof <Value>) <Value>

alias Width = 30
  => alias Width = (typeof 30) 30
  => alias Width = number 30
  => typeof Width is number

state Height = 30
  => state Height = stateful (typeof 30) 30
  => state Height = stateful number 30
  => typeof Height is stateful number

alias <NamedType> <Value>
  => alias <NamedType> = <NamedType> <Value>

alias FirstName "Joe"
  => alias FirstName = FirstName "Joe"
  => typeof FirstName is FirstName

state LastName "Doe"
  => state LastName = stateful LastName "Doe"
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

Parameters and arguments are `Name Type` pairs:

```tao
view ExampleView <ParamName1> <ParamType1>, <ParamName2> <ParamType2>, ... { ... }
action ExampleAction <ParamName1> <ParamType1>, <ParamName2> <ParamType2>, ... { ... }

// e.g:
use Button from @tao/ui

view Profile Person Person, IsSelf boolean {
  // Render a title
  Text "${Person.FirstName} ${Person.LastName} Profile"
  // And if this is not my profile, render a Button to follow them
  if !IsSelf {
    Button Text "Follow", OnPress action { ... }
  }
  ...
}
```

Similar to an `alias`, parameters can be NameTyped:

```tao
type Title is text
type OnPress is action

// These two are equivalent:
view Example Title Title, OnPress OnPress { ... }
view Example Title, OnPress { ... }
```

And when rendering a view the arguments can also be NameTyped:

```tao
alias Title "Press me"
action OnPress { ... }

// These two are equivalent:
render Button Title Title, OnPress OnPress
render Button Title, OnPress
```

Action arguments

// Actions can be inlined, and shorthanded with `->`:
render Button Title, OnPress action { ... }
render Button Title, OnPress -> { ... }

view Example {
Button Title "Click me", OnPress action { ... } { }
Button Title "Click me", OnPress -> { ... } { }
}

// Parameter order doesn't matter:

view Example {
Button Title "Click me", OnPress -> { ... } { }
Button OnPress -> { ... }, Title "Click me" { ... } { }
}

// Parameters and arguments can be NameTyped:

type TypedOnPress is action
type TypedTitle is text
view TypedButton TypedOnPress, TypedTitle { }

view Example1 {
alias Title = TypedTitle "Click me"
action TypedOnPress { }
TypedButton TypedOnPress, Title { }
=> TypedButton TypedOnPress TypedOnPress, TypedTitle Title { }
}

view Example2 {
alias Title = "Click me"
action OnPress { ... }
Button Title, OnPress { }
=> // Error: Title is a text, not a TypedTitle
Button Title TypedTitle, OnPress TypedOnPress { }
=> // OK
}

// If no two Parameters share the same type, arguments become type-matched:

view Example1 {
view Label1 Text text { }
view Label2 Text1 text, Text2 text { }
type Label is text
view Label3 Label, Text text { }

Label1 "Hello" { } // OK
Label1 Text "Hello" { } // OK

Label2 "Hello", "World" { } // Type error: Arguments Text1 and Text2 are both strings
Label2 Text1 "Hello", Text2 "World" { } // OK

Label3 Label "Hello", "World" { } // OK
Label3 Label "Hello", Text "World" { } // OK
alias Greeting = Label "Hello" { }
Label3 Greeting, "World" { } // OK, because typeof Greeting is Label.
}

// If a parameter has type <TypeName>, and alias <TypeName> = <TypeName> <Value> would be legal , then <TypeName> <Value> is a valid argument.

view Example {
alias TypedTitle = TypedTitle "Press"
action TypedOnPress -> { ... }
TypedButton TypedTitle, TypedOnPress { } // OK
TypedButton TypedTitle "Press", TypedOnPress -> { ... } { } // Also OK
=> Effectively, this becomes the same conceptually as:
=> TypedButton TypedTitle (TypedTitle "Press"), TypedOnPress (TypedOnPress -> { ... }) { }
}

````
## Items (Objects/Structs)

An Item has any number of properties. Each property has a name and a typed value. They are similar to objects in typescript, or structs in go.

```tao
type <Item Type> is {
  <Property Name> <Property Type>,
  <Property Name> <Property Type>,
  ...
}
alias ExampleItem = <Item Type> {
  ...
} => typeof ExampleItem is <Item Type>

// e.g:
type Person is {
  FirstName FirstName,
  LastName, // Shorthand for: `LastName LastName`
  Age number,
  Job { // This also defines a type, named `Person.Job`
    Title text
  }
}
````

To use an item, you can use the item literal syntax. Each property is assigned a value the same way that an `alias` is. In addition

```tao
alias RoAge = 40
alias Person {
FirstName "Ro",
LastName, // Shorthand for: `LastName LastName`
RoAge, // Type-matches to `Age`

}

alias = Person {
Age = Person.Age 30, // Full form: `PropertyName = PropertyType PropertyValue`

FirstName, // Shorthand for `FirstName = Person.FirstName FirstName`
LastName "Doe", // == `LastName = Person.LastName "Doe"`
LocalizedFirst FirstName, // == `LocalizedFirst = LocalizedFirstName FirstName`
Alias = FirstName "John Doe" // == `Person1.Alias = FirstName "John Doe"` Not optional: compile-time deduced to type of FirstName "John Doe"
Job // == `Person1.Job = (missing Person1.Job) | (Person1.Job { Person1.Job.Title "Developer" })`
}

view ExampleView { ... } // == `alias ExampleView = view ExampleView { ... }`

action Example { // == `alias Example = action Example -> nothing { ... }`
alias Job { Title "Developer" } // == `alias Job = { Title text } { Title "Developer" }`
set Person.Job = Job // Not OK
set Person.Job { Title "Developer" } // OK: == `set Person.Job = Person.Job { Title "Developer" }`
set Person.FirstName = Person.LastName // type error
set Person.FirstName = Person.FirstName Person.LastName // OK type cast
}
```
