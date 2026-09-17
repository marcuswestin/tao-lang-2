# Tao Revolution — Final Decisions

The decided design of post-MVP Tao. Each line is a decision the language will include. This is the
authoritative rationale record behind the Tao Revolution program; `Process.md` beside it says how
the program proceeds, and `Coverage.md` maps each capability to the app feature and test that
forces it.

> **Status: complete.** Every item from the four-design analysis is resolved and recorded here. The
> analysis records — what all four designs agreed on, and each design's position on every contested
> point — are frozen in `Docs/Roadmap/Archive/Tao Revolution analysis/`. The drag-and-drop worked example
> is a roadmap item (an example app to implement), not a decision.
>
> **These decisions are made on their own merits.** The target is the best possible Tao for the MVP
> and Revolution implementations — internally consistent and unambiguous — not agreement with what
> `2 - Next` or `Docs/Spec/` settled earlier. Where a decision supersedes a shipped spelling, it is
> recorded under _Migrations from what ships today_, immediately before the open list.
>
> **Amending this document.** From here on, a change to a decision goes through the tranche process
> (`Process.md`): it is proposed against real app code, lands in `2 - Next` as the sprint contract,
> and this record is updated in the same change so the two never disagree.

---

## 1. Premise and file organization

- The three demo apps are the specification. The overview is a map, not a grammar.
- Demo sources use the `.tao-revolution` extension so the current toolchain ignores them.
- **A folder is one module.** Sibling declarations in the same folder see each other with no import
  ceremony:

```swift
// Recipe.tao and RecipeCard.tao are in the same folder — RecipeCard needs no import to see Recipe.
data Recipes / Recipe { Title text }
```

- **`use X [as Y] from @pkg` exists only for genuinely external packages and other folders**:

```swift
use Button, TextField from @design-kit
use Recipe as SharedRecipe from ../Sharing
```

- **Two visibility modifiers and no others**: `file` narrows a declaration to its source file;
  `public` widens it past the folder or package boundary.

```swift
file function Slugify(Title text) returns text { … }   // only this file may call it
public data Households / Household { … }               // other folders and packages may reference it
```

- **Each app has the same file decomposition**, so the security story is reviewable on one page:

```
Skillet/
  App.tao            — app root: providers, design, navigator
  Data.tao           — entities
  Access.tao         — access rules
  Rules.tao          — transactions and automations
  Chrome.tao         — shared navigation and shells
  Recipes/            — per-feature screens
  Design.tao
  Words.tao
  Scenarios.tao
  Tests.tao
  FetchRecipe.ts      — TypeScript sidecar
```

Data, authority, and multi-row semantics stay three separate files rather than one, specifically so
that reviewing what a person may do never requires reading what a row contains.

---

## 2. Data and the store

### Types and typed slots

Three symbols could each plausibly mean "has this type", and the language gives each exactly one job
so that none of them ever has to be disambiguated by position:

- **`is` defines a type.** A type declaration is a statement about the world, and it always reads
  `type Name is <type>`:

```swift
type Foo is number
type Bar is list of text
type Course is one of Breakfast, Lunch, Dinner, Snack
type RecipeDraft is { Foo, Bar }
```

- **Juxtaposition declares a typed slot.** A slot is a name, its type, then its trailing traits, and
  it reads the same wherever slots are declared — entity fields, item fields, and every declaration's
  parameters:

```swift
Title text (required "Name this recipe")        // an entity field
Servings number (default 4)                     // an entity field
action FetchRecipe(Link text) returns …         // a parameter — the same shape
view Status(Message text, Tone default Neutral)
view CookScreen(Recipe, Meal?)                  // a bare name takes its same-named type
```

- **`:` binds a value to a name at call sites and in literals**: `Text(Timer.Step.Text, Lines: 1)`,
  `create Timer { StartedBy: Me }`, `update Me { Units: Imperial }`. In a _value body_ — a
  configuration block, a scene's chrome fills, a command's members — juxtaposition binds instead
  (`Label "Focus session"`, `Icon "checkmark"`), because nothing in such a body can be a declaration.
  The rule is that **juxtaposition declares in a type body and binds in a value body**, and no block
  is both: the one that was, the command block, now declares its slots in a parameter list (§8).

This is why a parameter is not written `Link is text` or `Link: text`. `is` is the language's
predicate word in every expression (`where Role is Owner`, `when Recipe is Favorite`,
`Invite.Email is none`), and in a parameter list it also invites a constraint reading rather than a
type ascription — the shape that produced `Recipe is available Recipe` and `Actor is signedIn
Account` in the source designs. `:` is worse still: parameter lists deliberately mirror call sites,
so `CookScreen(Recipe, Meal: Meal)` would read as a declaration and as a call with the same
characters and two different meanings. Juxtaposition collides with neither, and it makes a parameter
list and a field block the same thing written the same way.

- The one cost is a missing comma: `(Recipe, Meal)` declares two parameters and `(Recipe Meal)`
  declares one named `Recipe` of type `Meal`. This is accepted deliberately — naming a slot after a
  _different_ type's name is already pathological (real renames read `StartedBy Account`,
  `Mine draft of Stop`), and the type checker catches the typo at the first use site.

### Unit values and literals

- **A literal carries its type**: `#FBF7EF` is a color, `"…"` is text, `12` is a number, `yes` is a
  yes/no. Colors also construct as `rgb(217, 98, 43)` and `hsl(20, 66%, 51%)` — the forms the
  runtime (React Native) accepts natively.
- **One accessor mechanism builds, converts, and reads unit values.** `.unit` on a number constructs
  a typed value; `.unit` on a typed value reads it back as a number in that unit. The two round-trip:

```swift
let Wait = 220.ms                 // number → duration
Wait.s                            // duration → number: 0.22
(1.cm).meters                     // distance, read in meters: 0.01
Wait.meters                       // compile error — wrong family
when 10.meters is { 1000.cm -> A, 100.cm -> B }   // equality by normalization: 1000 cm is 10 m → A
```

- **Convertible families have a canonical base and fixed ratios**, so `.unit` converts freely:
  `duration` (base nanoseconds; `ms, s, min, h, d, wk`, with long singular/plural aliases like
  `1.second` / `30.seconds`), `distance` (base meters; `mm, cm, m, km, mi`), and `mass` (base grams;
  `g, kg, oz, lb`). **There is no bare `m` duration unit** — `m` is meters; minutes are `min`.
  **Months and years are not durations** (no fixed length); they are calendar arithmetic on dates:
  `today + 1.month` means what a calendar means, `duration X = 1.month` is a compile error.
- **`size` is the one contextual family.** Its units are `px` (the density-independent point — React
  Native's dp, which is the only length RN core has, alongside percents), `rem` (px × `TextScale`,
  computed by Tao at render, for lengths that should grow with the person's text setting), and `%`
  (of the parent's relevant dimension). Size units do **not** interconvert at compile time:
  `10.px + 1.rem` is a composite that resolves at render, and `.px` reads back only from a px-pure
  value. There is no `pt` (a second name for `px`) and no `vw`/`vh` (not in the runtime; use
  `Screen`).
- **Arithmetic is dimensional analysis**: value + same-family value → that family; value × number →
  that family; value ÷ value (same family) → number; cross-family or value + bare number → compile
  error. For calendar values: `time − time → duration`, `date − date → duration` in whole days,
  `time + duration → time`, `date + whole days → date`, and `date + less than a day → time` — in the
  device's time zone unless stated (`… in Household.TimeZone`); automations must state theirs (§12).

```swift
duration Long = 10.s
date Tomorrow = today + 1.d
time InABit = today + 10.h                    // a date plus less than a day is a time
time Soon = now + 3.s
```

- **A bare number is a number** — a ratio, count, or scale. The one ergonomic exception: in a
  clause-list _size position_ (`size 64`, `tap min 48`, `cell min 220`) a bare number means `px`,
  which is the runtime's own convention for those properties.
- **Conversion is a call on the type name**: `number("42")`, `color(Input)`, `Course("Dinner")` — a
  capitalized name in call position converts when it names a type and renders when it names a view;
  the namespaces are distinct. A bad **literal** is a compile error, because the compiler evaluates
  it. A runtime conversion is optional in plain use, and a site that cares distinguishes _why_ it
  failed:

```swift
let Accent = color(Recipe.AccentText)          // an optional color: none if missing or invalid

when color(Input) {
   missing -> Text("No color set")              // the input was none or empty text
   invalid -> Text("'{ Input }' isn't a color") // nonempty but unparseable
   Color   -> Swatch(Color)                     // the bare name binds the parsed value
}
```

### Entities

- **`data Plural / Singular { … }` declares an entity as both a collection name and a row name**, so
  a loop infers its element:

```swift
data Recipes / Recipe {
   Title text (required "Name this recipe")
}

loop Recipes / Recipe { RecipeCard(Recipe) }   // Recipes is the collection, Recipe is each row
```

- **`data Accounts / Account with { … }` extends the platform account** rather than redefining it:

```swift
data Accounts / Account with {
   Memberships (owned)
   preference Units is one of Metric, Imperial (default Metric)
}
```

- **Closed case types** are written `type Course is one of Breakfast, Lunch, Dinner, Snack`. Cases
  may be text literals, spelled as the literal a person types (`type Unit is one of "g", "kg",
  "ml"`), never as a word for it. A case prints as its own name and translates like any other copy.
  This is the same `type X is …` head as every other type, so the inline form (`is one of Metric,
  Imperial`) works wherever a type goes. It replaces the nominal `enum Name { Cases }`.
- **A case is a value, a case-test target, and a responding view's answer** — the three roles the
  retired `enum`'s cases filled, which the new form must fill identically:

```swift
type Course is one of Breakfast, Lunch, Dinner
type ConfirmResult is one of Confirmed, Cancelled

let Fallback = Dinner                        // 1. a value: referenced, passed, stored
create Meal { Course: Dinner }               //    including as a field's value

when Recipe.Course is Dinner { … }           // 2. a case-test target, beside yes/no fields

view Confirm() responds ConfirmResult {      // 3. a responding view's typed answer (§9)
   action Yes() { respond Confirmed }
}
```

Cases share the value namespace, so two case types in one module may not declare the same case
name — the constraint the nominal `enum` avoided by scoping cases under their type. Where that
bites, the case type is the qualifier: `Course.Dinner`.

- **Lists declare their element type** as `list of T`: `type Bar is list of text`.
- **`{ … }` is the structural record type**, whose fields are ordinary typed slots and so may be
  bare names taking their same-named types: `type RecipeDraft is { Foo, Bar }`. **No `item` keyword
  precedes it in type position**, because `item { Foo: 1 }` already _constructs an item value_;
  requiring the keyword would make the same characters denote a type or a value depending on
  position, which is the collision that ruled out `Name: Type` in parameter lists. `item` remains a
  bare primitive type (a value of any item shape) and the value constructor's head.
- **A structural type may be written inline wherever a type is accepted**, a return position
  included: `action FetchRecipe(Link text) returns { Foo, Bar } { … }`. A type expression is a
  type expression, so `number` and `{ … }` are accepted in exactly the same places — there is no
  position that takes one and refuses the other.
- **The adjacent `} {` in that line is unambiguous.** The field list's brace balance closes the type,
  and no type expression may be followed by a bare block — `Name { … }` constructs a _value_ and is
  only meaningful in value position, while a type continues with an explicit keyword (`with { … }`).
  A parser therefore knows the next `{` opens the body, and no separator keyword is needed before it.
- Naming the shape (`type FetchedRecipe is { Foo, Bar }`) stays available and is worth doing
  when a test stub or another declaration must refer to it. That is a style choice, not a rule.
- **A type may itself be imported**, because `<expr> from <path>` is an ordinary expression and works
  in type position like any other (§15): `StorageKey Foo from ./Bar.ts` is a slot whose name is
  `StorageKey` and whose type is the `Foo` exported by that module.
- **Relations are inferred from names.** A plural entity name is a to-many; a singular name is the
  reverse to-one. Cardinality is never written out, and no inverse path is declared:

```swift
data Households / Household {
   Recipes (owned, ordered)          // to-many: Household.Recipes is a list of Recipe
}

data Recipes / Recipe {
   Household                         // to-one, reverse of the above: Recipe.Household is one row
}
```

- **The target is omitted when the field name is the entity name** (`Household`, above), and named
  by the `relation` trait when it is not:

```swift
data Memberships / Membership {
   Person (relation Accounts)        // named Person, pointing at the Accounts entity
}
```

Juxtaposition is _not_ used here. Inside a `data` block, fields are separated by nothing but
layout, so a juxtaposed type is genuinely ambiguous: in

```swift
data Documents / Document {
   Workspace
   Paragraphs (owned)
}
```

`Workspace Paragraphs` reads equally as one field named `Workspace` of type `Paragraphs` and as
two separate relation fields, and the grammar has no newline sensitivity to break the tie. The
`relation` trait carries the target explicitly, so nothing about a field's meaning depends on where
a line break falls. This is the one place where the three-symbol rule of §2 does not apply, and
the trait is required only when the names differ — the common case still writes nothing.

A reverse relation whose name differs from its entity names its collection the same way, which
removes the last reason to write cardinality or a `through` path by hand:

```swift
data Members / Member { Household Person (relation Accounts) }

data Households / Household {
   Seats (relation Members, owned)   // named Seats, but holds the Members collection — no
                                     // cardinality or inverse-path clause needed either way
}
```

- **A yes/no field names its poles**, with the field name serving as the `yes` pole:

```
<Name> yes / [<NoAlias>] no [(default <Value>)]
```

```swift
Favorite yes / no                            // no alias, and no is the default
Shared yes / Private no                      // the no pole reads as Private
Running yes / Stopped no
Public yes / Private no (default Public)     // the yes pole wins only when it is stated
```

**Without an explicit `(default …)` the `no` state is the default**, which is why a row that should
begin in the `yes` state says so at creation: `create Timer { Household, Step, StartedBy: Me,
EndsAt: now + Step.Timer, Running }`. Naming the bare field in a literal sets its `yes` pole; the
same field followed by `no` sets the other explicitly — `{ Happy no }` — which only matters when
overriding a `(default yes)`.

- **The alias precedes `no`**, so the keyword terminates it. This is not cosmetic: with the alias
  trailing, the parser cannot tell an alias from the next field's name without a contextual lexer
  token that fires on same-line position. Putting it between `/` and `no` makes the alias an
  ordinary identifier and deletes that hack. The one consequence is that an alias may not be a
  reserved word — the same constraint every other identifier in the language already has.
- **`yes / [Alias] no` is a type expression**, not only a field-head spelling — it may head a
  standalone type (`type Testing is yes / Production no`) exactly as `one of A, B, C` can, and
  `yes` / `no` are ordinary literal values of it. §8 covers matching one inline.
- `(owned)` gives cascade lifetime. `(ordered)` gives store-kept positions, so drag reordering needs
  no hand-maintained position field and the position reads back on the row.
- **A deleted row's references become `none`.** Deleting an account is the one exception: it redacts
  the row in place — clearing `Name`, `Email`, and `Photo` — rather than removing it, so relations
  that point at the person, and fact-pairs like `together CompletedBy, CompletedAt`, survive the
  person leaving. The stand-in's caption (e.g. "Former member") is a Prelude phrase an app may
  translate or override.

```swift
data Groceries / Grocery {
   CompletedBy Account?
   CompletedAt time?
   together CompletedBy, CompletedAt   // still true after Account deletion — CompletedBy reads as
                                        // the redacted stand-in, not none, so the pair stays whole
}
```

- **Optionality is a postfix `?` on the slot**: `Photo image?`, `Meal?`, `Press action?`. It applies
  wherever a slot is declared — entity fields, item fields, and parameters — and it is deliberately
  not a trait in the list, because it is the one trait that appears everywhere and reads better
  attached to what it qualifies; and because `Press action (optional)` would put a parenthesis
  directly after an action type, where a reader expects that type's parameter list. This replaces
  the shipped leading `optional Field Type`.
- **Every other trait trails in one parenthesized list, and that list belongs to `data`
  declarations.** The list is closed:

| Trait                   | Argument             | Meaning                                                |
| ----------------------- | -------------------- | ------------------------------------------------------ |
| `default <expr>`        | a value or case name | the field's value when it is not set                   |
| `relation <Entity>`     | an entity name       | the relation target, when the field is named otherwise |
| `required "<sentence>"` | a sentence           | completeness, never blocking (§ Correctness)           |
| `touch on change`       | —                    | restamp this field on every write to the row           |
| `owned`                 | —                    | cascade lifetime for a relation                        |
| `ordered`               | —                    | store-kept positions for a relation                    |
| `unique`                | —                    | a storage fact                                         |
| `search`                | —                    | participates in the entity's multi-field text search   |
| `device`                | —                    | a preference scoped to one device, so it does not sync |
| `title`                 | —                    | the one text field that names a row to a person (§9)   |

```swift
data Recipes / Recipe {
   Title text (required "Name this recipe", unique, search, title)
   Servings number (default 4)
   ChangedAt time (default now, touch on change)
   Ingredients (owned, ordered)
   Photo image?
}
```

- **`index`, `order by`, and `local only` trail the field list as a group**, separated from it by a
  blank line. Each states a storage fact about the _entity_ rather than about one field, so none
  rides a field's trait list — `index` names its field the same way `order by` already does:

```swift
data Workspaces / Workspace {
   Name text
   CreatedAt time (default now)

   index CreatedAt
   order by CreatedAt
}
```

Each trait is legal only where it means something — `owned` on a relation, `device` on a
preference — which the validator enforces rather than the grammar. `relation` is the one trait that
is redundant more often than not: it is written only when the field name differs from the entity it
points at, which is why relations above still read as bare names.

- **Parameters take no trait list.** The only trait a parameter has ever needed is a default, and it
  has a bare spelling that needs no parenthesis: `view Status(Message text, Tone default Neutral)`.
  Item fields take optionality and nothing else. Confining the parenthesized list to `data`
  declarations means a parenthesis after a type always means the same thing.
- **A slot is optional or defaulted, never both.** `Amount number? (default 0)` is a diagnostic: a
  default already makes the field always present, so the `?` would be a lie.
- **Absence is explicit**: an optional field's absence is `none` and is handled as such.

```swift
Text(when Recipe.Duration is none "No time given" / not Recipe.Duration)   // §8's ternary form
```

### Correctness

Three distinct words, deliberately not the same word — and **exactly three**. There is no fourth,
gentler severity: a message that neither blocks a write nor marks a row incomplete is product UI (a
`Text` under the field behind an `if`), not a language feature. One thin case asked for it, and
"dismissable" would have implied per-row dismissal state persisted for a hint.

- `validate <condition> "<sentence>"` — a store invariant enforced on **every** write path
  (keystroke, draft commit, transaction, sidecar import), which rejects the write.
- `required "<sentence>"` — completeness, which never blocks a write. It derives `Row.Incomplete`
  and `Row.Problems` so a row can be built one field at a time and still know it is unfinished.
- `refuse when <condition> "<sentence>"` — a domain rejection inside a transaction, before any write
  lands.

```swift
data Recipes / Recipe {
   Title text (required "Name this recipe")           // required: Recipe.Incomplete until set
   validate Servings >= 1 "A recipe serves at least one"   // validate: the write is rejected outright
}

transaction LeaveKitchen(Membership is Membership) for Me {
   refuse when Membership.Role is Owner and Membership is last owner
      "Make someone else an owner first."             // refuse: a domain check inside a transaction
   delete Membership
}
```

Further:

- **Sentences are written inline in plain English** at the point the rule is stated. They are source
  copy and are extracted for translation at build time.
- **`together A, B` makes two fields one fact**, so an amount never syncs without its unit:

```swift
data Groceries / Grocery {
   Amount number?
   Unit?
   together Amount, Unit
}
```

- **`local only` keeps an entity on the device** whatever datasource the app binds, so a synced
  variant never syncs it (amended by KEY-D7). It is the narrow form of per-entity datasource
  scoping — the general form landed with the multiple-datasources work amended into §6 — and it is
  what lets something like a writing session be data, surviving navigation and relaunch, without
  becoming something to sync. A stored `relation` may not cross the boundary: the two stores are
  separate, so a relation between them could not resolve, and it is diagnosed where it is written;
  `reference` is the link that may cross.
- **`unique`, `index`, `search`, and `order by` are declarative storage facts** stated on the entity,
  not preflight checks written in UI code:

```swift
data Recipes / Recipe {
   Title text (unique, search)
   CreatedAt time (default now)

   index CreatedAt
   order by CreatedAt
}
```

- **Cross-row invariants are ordinary validates**: `validate at least one Memberships where Role is
  Owner "A kitchen needs an owner. Make someone else an owner first."` Such an invariant is
  satisfiable only inside a transaction, which is why an entity carrying one is created `through`
  one. There is no second keyword (`keep one`) and no hand-written duplicate `refuse when` inside
  transactions restating the store's rule.
- **How a cross-row validate lowers to the store.** The intended providers (InstantDB's model)
  enforce per-operation rules — CEL expressions over the row, its linked rows, and the incoming
  change — not deferred whole-transaction constraints. So the compiler lowers one entity-level
  `validate` into generated per-operation rules on every write that could break it (here: `delete
  Membership` and `change Membership.Role`), each checking the surviving set through the relation.
  The duplication design C wrote by hand is what the compiler emits, so it cannot drift; and the
  provider's atomic multi-write transact is what makes `create through StartKitchen` able to satisfy
  the invariant in the same commit that creates the household.

### Preferences

- **A preference is an app-domain choice the OS has no opinion about** — `Units`, `KeepOffline`, a
  current workspace. What the OS _does_ own is not a preference: language is the per-app language a
  person sets in the system Settings (read as `Locale`), text size is the system text setting (read
  as `TextScale`), and light/dark is the system appearance — all read-only environment values (§13),
  never duplicated as app pickers. The one conventional exception survives as a preference:
  an in-app appearance _override_ (`Appearance is one of System, Light, Dark`), because offering one
  is an established app behaviour the OS supports rather than owns.
- A preference is its **own declaration form**, not a field trait, and it is **declared inside
  `data Accounts / Account with { … }`** — it is per-account state, reads as `Me.Units`, and is
  written as an ordinary update (`update Me { Units: Imperial }`) in product code and tests:

```swift
data Accounts / Account with {
   preference Units is one of Metric, Imperial (default Metric)
   preference KeepOffline yes / no (default yes)
   preference Appearance is one of System, Light, Dark (default System, device)
}
```

- Preferences are durable, personal, and synced per account, and are explicitly not shared product
  truth, so a current workspace or a unit choice cannot leak to collaborators.
- **Device scoping is a trailing modifier like every other trait** (§2's one convention), not a
  clause in prose: `(default System, device)` above — a device-scoped preference does not sync.

### Capability values

- **`secret` is a capability-grade value type**: unguessable and rotatable. A shared link is built
  from a secret, never from a row id:

```swift
data Recipes / Recipe {
   ShareCode secret?
}
```

---

## 3. Authority

- **Deny by default.** Nothing is readable or writable unless a rule grants it.
- **Four verbs**: `read`, `create`, `change`, `delete`. Verbs may be grouped on one line.
- **One `access <Entity> { … }` block per entity**, with verbs as bare lines:

```swift
access Recipe {
   read to Family of Household
   create, change to Cooks of Household
   change Shared, ShareCode through StartSharing or StopSharing
   delete to Owners of Household
}

access Invite {
   read to Cooks of Household or holder of Code
   create to Cooks of Household where Role in Cook, Guest   // a cook may invite cooks and guests
   create to Owners of Household                            // only an owner may mint an owner
   change Used to holder of Code
   delete to Owners of Household
}
```

- **The composition rules are part of the language, not a convention**: grants are additive; a bare
  `change` covers every field; a field no grant covers cannot change; and a field named in a
  `through` grant changes _only_ that way, even for callers a broader grant covers.
- **A grant may constrain the row as it will be** — `create to Cooks of Household where Role in
  Cook, Guest`, above, reads the _new_ row's `Role`, which is how "a cook may invite cooks and
  guests, but only an owner may mint an owner" is two lines instead of a transaction.

- **`audience Name for Entity = <path>` names a reusable set of accounts** derived from a durable
  relation path with a filter. The same named audience is used by both the access rules and the
  screens:

```swift
audience Cooks for Household = Household.Memberships[Role in Owner, Cook].Person

access Recipe {
   create, change to Cooks of Household   // used by an access rule …
}

// … and by a screen, so "who can cook here" is asked and answered in one place
Text("Cooking: { Cooks of Recipe.Household }")
```

- **Field-scoped change grants** keep everyday edits open while provenance, lifecycle, and sharing
  fields stay closed (`change Shared, ShareCode through StartSharing or StopSharing`, above — every
  other field stays open to `change Recipe`).
- **Transaction-only write paths** (`through <Transaction>`) reserve sensitive mutations for one
  named atomic operation, even for a caller in the right audience (`create through JoinWithInvite`,
  below).
- **Holder-of-secret grants** authorize whoever presents a capability. This is how invitations work.
  The grant needs no separate "authorizes" clause: presenting a `secret`-typed parameter to a
  transaction is what makes its caller `holder of <Field>` for that call, and the same access verbs
  that grant everyday changes (`through <Transaction>`, `to holder of <Field>`) say what the holder
  may do — mirroring how the store's own rules check a bearer secret against a related row rather
  than consulting a separate authorization table:

```swift
access Invite {
   change Used to holder of Code            // presenting Code as it is authorizes the caller
   create through JoinWithInvite
}

transaction JoinWithInvite(Code secret) for Me returns Household {
   refuse when Invite.Email is not none and Invite.Email is not Me.Email
      "This invitation was sent to someone else."
   update Invite { Used }
   create Membership { Household: Invite.Household, Person: Me }   // the row `create through` allows
}
```

- **Inherited policy**: `access Ingredient as Recipe` takes the parent's rule wholesale.
- **A write is checked against the row as it will be**, which lets an invitation create the very
  membership that then protects it: `JoinWithInvite` above both creates the `Membership` and relies
  on `Recipe`'s rules being satisfied by the row _after_ that creation, not before it.
- **Authority is store-enforced and screens only ask.** No screen decides permission; it asks and the
  answer comes from the rule the store enforces:

```swift
command Favorite(Recipe) {
   Title "Favorite recipe"
   Icon "heart"
   do FavoriteRecipe(Recipe)
}
// shown only while `can change Recipe` — the command asks the store; nothing re-implements the rule (§8)
```

---

## 4. The public boundary

- **One declaration** carries what is visible, when, and how it is addressed — and it is `publish`,
  with no `public` prefix. Publishing _is_ crossing the account boundary; prefixing it `public`
  would say "public public". `public` keeps its single §1 meaning, cross-module code visibility,
  and has no runtime meaning anywhere:

```swift
publish Recipe when Recipe is Shared as SharedRecipe by capability Recipe.ShareCode {
   Title
   Course
   Servings
   Ingredients { Name, Amount, Unit }
}
```

- A projection is a **distinct read-only type with a closed field allow-list**: `SharedRecipe`, above,
  has `Title`, `Course`, `Servings`, and `Ingredients { Name, Amount, Unit }` — nothing else on
  `Recipe`, private or not, is reachable through it.
- **A `when` filter is for revocation-shaped conditions only** — row-derived states whose flipping
  must make every handed-out link stop resolving (`when Recipe is Shared`). Liveness that the holder
  is entitled to learn about is _not_ a filter; see the invitation below.
- **Public links are addressed by a rotating capability.** Revoking is rotation, not hiding a URL:

```swift
update Recipe { ShareCode: new secret }   // every link built from the old ShareCode stops resolving
```

- **Computed facts derive from the row alone — never from the viewer.** A fact like
  `Anyone = Invite.Email is none` is fine everywhere; a viewer-dependent fact (the old `ForMe`)
  would require server-side evaluation the intended providers do not have, so it does not exist.
  The question it answered belongs to the transaction, which checks it with real authority at the
  moment that matters: `refuse when Invite.Email is not none and Invite.Email is not Me.Email
  "This invitation was sent to someone else."` Facts are advisory — the screen renders them, the
  store's rules enforce the truth.
- **An invitation publishes unfiltered, with its liveness as facts**, because a used or expired
  invitation and a mistyped code must not be indistinguishable — the holder was sent this link and
  is entitled to know what became of it, and the join screen needs a projection to say so from:

```swift
publish Invite as OpenSeat by capability Invite.Code {
   Household { Name }
   Role
   ExpiresAt                            // the device computes Expired from this; advisory, like all facts
   Used                                 // the yes/no field itself, not a filter
   Anyone = Invite.Email is none        // row-derived
}
```

Real revocation — deleting the invitation or rotating its code — still produces `missing`.

- **How this compiles to the providers** (none of it is server code): on InstantDB, the capability is
  its native `ruleParams` share-link rule, the row filter is a view rule, and the field allow-list is
  its field-level view permissions; on Firestore, whose reads are whole-document, the compiler
  materializes the projection as the documented separate public record, synced inside the same
  atomic write; on Supabase, RLS plus column privileges. `publish` compiles to each provider's own
  documented pattern.
- A **generated preview** shows exactly what the projection ships, so what an author previews cannot
  drift from what crosses the boundary.
- **Anonymous resolution is derived, not declared.** A link or screen whose parameters are all
  projections or secrets can only be reading published data, so it resolves without an account by
  construction — and one that touches anything else cannot, which the compiler enforces rather than
  a keyword asserts:

```swift
link SharedRecipeLink "/shared/{SharedRecipe}" -> {
   present SharedRecipeScreen(SharedRecipe) as root
}

view SharedRecipeScreen(SharedRecipe) { … } // takes the projection, never the entity — public by construction
```

---

## 5. Writes, effects, and outcomes

- **`transaction Name(params) for Me [returns T] { … }` is an all-or-nothing commit across rows**,
  declares who may call it, and may return a value. Access rules still apply to each write inside it
  (`JoinWithInvite`, §3, is one).
- **`for <Name>` introduces the caller as an ordinary binding** — `Me` is not a keyword. The demos
  write `for Me` because it reads best, but it is a name like any parameter, capitalized like every
  value; the runtime binds it to the authenticated account the call arrived under. There is no
  lowercase `me`, no `signedIn`, and no `viewer` — one concept, one ordinary name (§11 for where the
  signed-in account comes from in product code).
- **Direct write verbs express a single authorized mutation without ceremony:**

```swift
create Recipe { Household: MyKitchen, Title: "Toast" }
update Recipe { Servings: 6 }
delete Recipe
toggle Recipe.Favorite
update each Grocery where Bought is no { Bought }   // a bulk form
```

- **One structured outcome vocabulary for every effect.** It distinguishes `queued` (durably
  accepted on this device, offline) from `saved` (confirmed by the provider), alongside rejection,
  conflict, and error. Offline is never modelled as an error:

```swift
when do LeaveKitchen(MyMembership) {
   rejected -> present Notice(Problem) as toast    // a refuse when sentence, or a validate failure
   queued   -> present Notice("Saved — will sync when back online") as toast
   error    -> present Notice(Message) as toast    // a thrown exception, not a domain rejection
}
```

- **One mandatory, app-wide safety net, and it is a read net.** `guard default { … }` is declared
  once, anonymously, and covers the states of the _subject_ a site is reading. A site names only the
  cases it treats specially, so `unauthorized` can never be accidentally skipped:

```swift
guard default {
   loading      -> Spinner(Label: "Opening Skillet…")
   missing      -> EmptyState(Icon: "questionmark.folder", Title: "This is gone")
   unauthorized -> EmptyState(Icon: "lock", Title: "You don't have access to this")
   rejected     -> Problem { Text(Problem) [caption, danger] }
   error        -> Message { Text(Message) [body] }
}

// A site overrides only what differs — a public screen never invites sign-in for a dead link.
guard SharedRecipe { missing -> Gone; unauthorized -> Gone }
```

- **Effect outcomes belong to the calling site.** There is no second, write-only net and no catch-all
  case absorbing outcomes the site did not name. The consequence is deliberate and worth stating: a
  site that fires an effect and names no outcome gets no automatic message, so naming outcomes is the
  write-side discipline this buys the smaller net with:

```swift
on press -> { do LeaveKitchen(MyMembership) }   // silent on rejection — nothing renders unless named
```

- **No `conflict` case exists in the net.** The store resolves an ordinary write fieldwise and latest
  (§11), leaving the app nothing to arbitrate; where a composed draft can genuinely conflict,
  resolution belongs to the draft's own generated comparison (§7).
- **An unhandled `save <Draft>` rejection invalidates the draft**, so it shows beside the fields
  rather than anywhere else. This is the one write outcome with a defined home, because the draft is
  a place that can hold it:

```swift
save Edit   // if refused, Edit.Invalid and Edit.Problems carry the sentence beside the field —
            // no `when` needed at this site for the common case
```

- **Availability is a state, not an empty collection.** Loading, missing, unauthorized, and error
  are distinct from "there are zero rows":

```swift
when Recipes {
   loading  -> Spinner()
   empty    -> EmptyState(Title: "No recipes yet")        // zero rows — not a failure
   otherwise -> loop Recipes / Recipe { RecipeCard(Recipe) }
}
```

- **Emptiness is content, not failure**, handled at the site that cares, as `empty` above.

---

## 6. Reads

- **`query Name from <path> { … }` is live and provider-backed**, with filtering, ordering, search,
  grouping, and limits declared next to the consumer. Views never poll or subscribe manually:

```swift
query RecentRecipes from MyKitchen.Recipes {
   where CreatedAt > now - 7.days
   order by CreatedAt descending
   limit 20
}
```

- **A module-level query is not part of the language today**, although it could be added and nothing
  strictly prevents it; queries live in the view whose mount owns their reactive lifetime.

- **Queries traverse relations** rather than requiring hand-written joins: `MyKitchen.Recipes` above
  crosses the `Household -> Recipe` relation with no join clause to write.
- **Multi-field text search is declared on the entity and consumed by the query**:

```swift
data Recipes / Recipe { Title text (search), Ingredients { Name text (search) } }
query FoundRecipes from MyKitchen.Recipes { search Query }
```

- **Grouped and aggregate queries retain their contributing source rows**, so a folded total can be
  traced back and written through:

```swift
query AisleTotals from MyKitchen.Groceries {
   group by Aisle
   Count = count()
}
// AisleTotals[0].Count is a number; AisleTotals[0].Groceries is still the rows behind it
```

- **`presence` is ephemeral live collaboration state** scoped to a durable subject: who else has this
  row open.

```swift
presence Viewers on Recipe   // Viewers.Others lists the other accounts with this Recipe open now
```

**Amended by the HTTP datasource work** (implemented; `Docs/Roadmap/HTTP Datasource/`, forced by
`Apps/HNReader`). Remote read-only feeds enter through the datasource seam, never through
imperative fetch actions:

- **`Http` in `@tao/data` is a query-driven datasource.** Entities stay ordinary `data`
  declarations; a live query's activation is the fetch trigger, so no screen-lifecycle hook, fetch
  outcome handling, or bulk import verb exists for feeds.
- **The protocol is descriptor-driven fill with local evaluation.** The provider is offered each
  active query's descriptor — entity, equality filters, effective order field and direction,
  limit — fetches through an app adapter, and upserts rows by the entity's single `(unique)`
  field; the store keeps evaluating every query locally, so a fill may land a superset and
  API-side ordering is materialized as a row field.
- **The adapter declares the query shapes the API actually supports** (`TR.Http.adapter` /
  `TR.Http.on`); a live query matching no declared shape fails loudly, never silently fetching
  nothing.
- **Availability is cache-first and per query.** `refreshing` (a fill running behind renderable
  rows) and `stale` (a failed refill behind renderable rows) join `loading` / `empty` / `error` as
  **advisory** cases: a guard that does not name them falls through to content, and they never
  route to the `guard default` net (§5). A failed refresh over cached rows is `stale`, never
  `error` — offline stays a non-error.
- **Staleness is declared** (`CacheFor` on the datasource), measured on the runtime clock a check
  holds; journeys bind a deterministic stub adapter through an ordinary app variant (§11, §16).

**Amended by the multiple-datasources work** (implemented; `Docs/Roadmap/Multiple datasources/`,
forced by `Apps/HNReader`'s bookmarks). An app's data is the union of the stores its datasources
hold, which retires the deferred "per-entity datasource scoping" and generalizes `local only`:

- **A datasource states the collections it stores**, in a `Data` reference block, and an app binds
  the set it mounts: `Datasource { HackerNews, Personal }`. The one-datasource form is unchanged and
  holds the whole catalog.
- **Which store holds a collection is a fact about the project, not about an app.** A query compiles
  once and every app reads the same store, so the partition comes from the project's `Data` slots,
  and a store is named by the collections it holds rather than by any datasource that fills it, while
  a provider that defaults its storage key takes the bound datasource's own name;
  two datasources declaring the same collections are alternatives for one store — a stub or preview
  variant — and an app binds one of them. A partial overlap is a diagnostic.
- **Membership is structural.** It never crosses the provider boundary, a patch where it is bound may not change
  it, and `local only` is the same fact decided on the entity.
- **A listed datasource may be derived where it is bound**: `Datasource { HackerNews, Personal with
  { StorageKey "…" } }`. It is the ordinary `with`, applied at the binding; the declaration keeps its
  own value, so two apps bind one datasource differently, and no separate override block exists.
- **`reference` is the link that crosses a store boundary.** It stores the target's `unique` value
  and reads as a handle with availability — the row when its store holds it, otherwise a placeholder
  that is `loading` while the store fetches it by that value, `error` if the fetch fails, and
  `missing` after — and it resolves only among its own project's stores. A stored `relation` stays
  inside one store and now says so for a datasource boundary as well as for `local only`. A
  reference owns nothing: no delete cascades across the boundary, and there is no inferred inverse
  — `query Bookmarks { where Story == Story }` is it. The name is optional when the field is named
  after the entity: `Story (reference)`.

---

## 7. Editing

- **One rule, two binding targets.** An input binds either directly to an existing row's field —
  writing through on keystroke, with validate, together, and access still holding — or to a draft:

```swift
TextField(Value: bind Recipe.Title)   // direct: every keystroke is a write, checked like any other
```

- **Two draft flavours**:

```swift
draft New = Recipe for new { Household: MyKitchen }   // does not exist yet — may be incomplete
draft Edit = Recipe from Recipe                        // a composed edit of an existing row

TextField(Value: bind New.Title)
Stepper(Value: bind Edit.Servings)
save Edit
```

- A draft **carries the entity's own `validate` and `required`** rather than restating rules: `New`,
  above, is `New.Incomplete` until `New.Title` is set, because `Recipe.Title` is `(required "…")`.
- **Conflicts are a draft concern.** A field-by-field comparison component is generated from the
  entity rather than authored:

```swift
if Edit.Conflicted { RecipeConflict(Edit) }   // a generated diff, not hand-authored UI
```

---

## 8. Commands, actions, and concurrency

### Commands and actions

**Settled by the interaction system tranche** (KEY-D10; implemented). The earlier model made an
action discoverable through title metadata and treated a command as a bound affordance reference.
KEY-D10 replaces both halves with the configured command model below; the former `intent` concept
word and its declaration model are retired.

- **The `command` is the discoverable verb, and the `action` behind it is a private procedure.**
  `Title`, `Description`, and `Summary` move off `primitive action` onto `primitive command`. There
  is no longer a way to make an action discoverable, because nothing lists an action: a declaration
  that only ever runs cannot name itself, in the same way a view that is only ever composed cannot
  name a title (§9). The former `intent` term retires; the metadata it carried belongs to the
  command.
- **A command is a standalone configured value, not a reference plus affordances.** It is declared
  at module level or in a view or scene body — the placement `action` already has — and it declares
  its slots in a parameter list, exactly as an action does. Its body holds member fills and exactly
  one `do` clause naming the action it runs:

```swift
package
command Finish(Document) {                  // a slot is a parameter: a bare name takes its same-named type
   Title "Finish document"
   Summary "Finish { Document.Title }"
   Icon "checkmark.circle"
   Enabled Document.Final is Draft
   do -> { update Document { Final } }
}
```

- **Slots replace closing over a view.** A command's parameters are its own, declared exactly as
  `view CookScreen(Recipe, Meal?)` reads (§2), which is what makes one verb reusable everywhere the
  noun appears rather than an affordance belonging to one screen. A view-body command still closes
  over that view's parameters, state, and actions.
- **Juxtaposition means one thing in a command block: bind.** The slots live in the parameter list,
  so the block never has to tell a slot from a fill by what a name reaches. `Enabled CanSave` is a
  value, with no `:` escape hatch, and `command Like(Track Song)` renames a typed slot the way any
  parameter list does — the `Track Document` deferral is closed. Two slots of one type are the
  ordinary parameter case: legal to declare, bound by label at the invocation, and diagnosed there
  when an unlabeled argument could mean either. (Revised from the first implementation, which
  declared slots in the block by juxtaposition and had to legislate around both ambiguities;
  `Docs/Roadmap/Keyboard driven apps/Open - Shell composition and member syntax.md` §2.)
- **Invocation is `do` with arguments, and binding is derivation.** `do Finish(Document)` invokes a
  command exactly as `do SaveWorkspace()` invokes an action: the arguments bind to the slots by
  label or by type through the one binding mechanism, with the same arity and type diagnostics, and
  every `do` carries its call parentheses. `Finish with { Document }` derives a command value with a
  slot filled, for surfaces and menus; a binding may also refine `Label`, `Icon`, `Key`, and
  `Enabled`, and overriding `Title` is an error, because the title is what identifies the verb
  wherever it is listed. A bound command invokes over the slots its binding left open.
  `do X with { … }` is retired as redundant.
- **Three surfaces retire.** `Rail { … }` retires because a rail is ordinary shell layout (§10); `Palette
  all` retires because the palette is always present rather than opted into; and the in-view
  `menu Name { … }` block retires, because the per-view `Commands` slot is the ordering mechanism
  and a surface never needed a second way to list. `Toolbar` stays, `Menu` (the OS menu bar) stays,
  and `present … as menu` stays.
- **A mention is unfilled on purpose, and the surface supplies the noun.** `Toolbar { Finish }` names
  the verb; the slot is filled from the presenting scene's parameters, matched by type, at
  invocation. That is what makes one declared verb usable from a row's button and from the scene's
  own chrome without either restating what it acts on. A slot the scene cannot supply
  unambiguously — no parameter of that type, or more than one — is an error at the mention, because
  a surface cannot choose on the author's behalf.
- **`Description` stays**, alongside `Summary`: the first explains the verb, the second names the
  particular invocation.
- **`shortcut` is a primitive value type.** `Key` is typed `shortcut`; a bare string literal in that
  position is a shortcut literal, and `primary + "n"` chains a modifier onto a key. Only `primary`
  is registered, and it lives in `@tao/keys` as an ordinary imported value rather than a keyword,
  because `primary` is also an ordinary design and layout word. Naming a platform key is diagnosed.
- **`Toolbar` is `list of command`**, so a toolbar lists commands and only commands; there is no
  second toolbar vocabulary in which an action carries a title of its own.
- **Every module publishes its commands.** A generated table of a module's commands — identity,
  slots and whether each names an entity, and the value to run — is registered at load through the
  handwritten `TR.Interaction.RegisterCommands`; a view-body command registers while its view is
  mounted. That table is what a verb surface reads to ask which commands act on what a person has in
  front of them. At the implemented boundary the catalog is scoped to the compiled project, so app
  variants and sibling app declarations in that project share it; changing that boundary requires
  an authored app-ownership construct. At the T2 boundary the authored surfaces and dispatch still
  remained; KEY-D8–D13 below supersede that historical implementation boundary.

**Amended by the keyboard-attention tranche** (`Docs/Roadmap/Keyboard driven apps/`, KEY-D8–D13).
The core reducer, keyboard dispatch, mounted-node narrowing, verb layer, hints, overview, and palette
are implemented. The keyboard plan's **Remaining decided implementation** ledger is authoritative
for the adapter and surface tail; this decision section states the target contract, not that every
part has landed.

- **Attention is one runtime-owned reducer, not Tao state.** It owns the focused region, one
  remembered target and narrowing string per region, engagement, and the modal stack; modes such as
  narrowing, verbs, hints, and overview are derived. Tests and launches reset attention, while the
  public interaction outline remains immutable snapshots. Mounted nodes privately provide the
  reducer with activation, focus, engagement, render order, geometry, and row values.
- **Regions come from presentation semantics.** Presented occurrences, selection items, split
  panes, and a view's non-nav sibling subtree are regions. That sibling subtree is one compiler
  descriptor whose mounted roots coalesce without introducing a wrapper or layout node. A target is
  selected eagerly but never activated implicitly; narrowing uses locale-aware, case-insensitive
  word-prefix subsequences across rendered text, and a sole candidate becomes the target.
- **Keyboard and pointer input share semantic operations.** Enter activates or engages; Escape
  clears narrowing, disengages without losing the target, ascends, then opens overview; arrows move
  region or target attention; `.` opens verbs; physical `Slash` toggles hints; and `primary+K`
  opens the palette. In the palette and pending-slot chooser, arrows cycle the displayed choices and
  Enter invokes or accepts the selected choice. Authored bare-letter command keys invoke only as verb
  accelerators while the verb layer is open. A currently displayed generated hint or overview key
  enters its assigned identity; other letters extend narrowing, including in the palette. Keyboard
  movement may target an input without engaging it; Enter engages the already targeted input.
  Engaged input, modal occurrence, target, focused scene, app command, then reducer key is the
  dispatch order. Modifier chords invoke directly. Pointer activation first targets the same node.
- **Command policy folds from authored surfaces.** An entity orders defaults with
  `commands A, B` and withholds one with `commands hide C`; a view promotes commands using
  `Commands { … }` and excludes inherited defaults with `hide C`. The folded verb order is view
  commands, rendered inner controls, entity defaults, then other applicable commands. The first verb
  with a given visible label wins, so a verb menu never presents indistinguishable choices. Commands
  with open slots enter a pending flow that fills required slots in declaration order from mounted
  entity targets, store search, or inline scalar input. The reducer and generated pending surface
  have landed: an already-decided entity is accepted directly, otherwise entity slots use mounted
  candidates and the store-backed picker, while scalar slots use inline input.
- **Interaction conditions stay ordinary words.** `pressed`, `focused`, and `hovered` are postfix
  conditions; `when FocusBar is active` tests named region focus. These and the new Tao test phrases
  use spelling-validated identifier seams rather than adding reserved grammar keywords.
- **Generated interaction surfaces are runtime renderings, not authored navigation** (KEY-D13).
  Hints, overview, the target's verb menu, the always-present command palette, and contextual Help
  read the interaction outline, attention snapshot, current bindings, and generated catalog. One
  host renders them above app content as a sibling after toasts; they do not enter Back history,
  and hidden layers are removed from accessibility traversal. Hints use cached app-relative bounds,
  overview lists mounted regions, the verb menu preserves the command tiers above, and the palette lists every
  titled command and entity while applying the same locale-aware word-prefix subsequence matcher as
  attention. Help remains unimplemented.
- **Generated keys are deterministic runtime policy** (KEY-D13). Existing identities retain their keys across
  reorders; new identities are considered in canonical identity order and receive the first free
  label-derived letter, then another distinctive label letter, then a two-letter sequence. One
  canonical key parser and identity-to-key resolver drives validation, reducer dispatch, and every
  displayed assignment; a shown key cannot dispatch a different identity. Reducer keys and explicit
  shortcuts or accelerators are never allocated. Affordances remain absent until the first
  hardware-key dispatch, while `press key` drives that same seam in tests.

### The AI surface

- **`Assistant { … }` on the app is a closed projection of nouns, verbs, and searches** — the same
  allow-list principle as `publish` (§4). Nothing is exposed unless listed; access rules still
  apply, so the block grants visibility, never authority:

```swift
app Skillet {
   Assistant {
      Entities {
         Recipe
         Household
      }
      Commands {
         CreateRecipe
         FavoriteRecipe
         CookRecipe               // DeleteRecipe deliberately absent
      }
   }
}
```

- On iOS this compiles to `AppEntity` + `EntityQuery` + `AppIntent` build-time metadata (the commands'
  titles and summaries above); on other platforms it emits a JSON tool schema of the same shape,
  which is what any function-calling model consumes. One block, every assistant. This Assistant and
  native projection remain unimplemented: T6 is deferred until the repository has a tracked native
  iOS build path on which the Swift bridge and App Intents tests can run.
- **A test runs a verb the way an assistant would** and asserts on the store: `as assistant do
  FavoriteRecipe(Shakshuka)`, then `expect stored Shakshuka is Favorite`; a verb not in the block is
  `expect refused`.

### Undo

- **Undo is a property of the command, and it is derived, not declared.** A command whose action is
  only store writes is undoable, because the store knows every inverse: a `toggle` is its own, an
  `update` records prior values at commit, a `create` reverses to a `delete`, and a `delete` restores
  through tombstones (§11). A command that crosses the boundary — a sidecar call, a `notify` — is not,
  and the compiler sees that too. `Undoable no` opts a store-only command out (`JoinWithInvite` should
  not be casually reversed). The platform undo gesture and an assistant's "undo that" both reach it;
  one command is one undo step.

### Concurrency

- **Concurrency is declared, not coded** — a single-flight policy and a latest-pending policy. Both
  policies can be keyed to a specific row so independent values do not share a lock or queue:

```swift
action Save() runs single { … }                              // refuse a second in-flight call
action Search(Query text) runs latest from ./Search.ts       // retain only the latest waiting call
```

- **`runs latest` is a foreign-action scheduling contract.** One action value has at most one running
  invocation and one waiting invocation. A newer call replaces the waiting call's arguments; the replaced
  call resolves as skipped without entering an action transaction, crossing the external boundary, or
  reporting a failure. The running call is not cancelled. When it settles, the newest waiting call starts
  with the direct or joined ownership mode captured at that call's own site. A native action using
  `runs latest` is invalid.

- **An action exposes a live in-flight boolean for busy states**:

```swift
Button("Save") [primary, busy when Save.Running] { on press -> { do Save() } }
```

- **Shortcuts are platform-abstract.** The primary modifier is named, never hard-coded to a platform:

```swift
command New(Title text) {
   Title "New recipe"
   Key primary + "n"
   do CreateRecipe(Title)
}
// never Key "cmd+n" — cmd names a platform
```

### Conditionals

- **`if` is one-sided and never takes `else`.** It conditionally includes one branch and nothing
  more: `if Step.Timer is not none { StartTimerFor(Step) }`.
- **`when` covers two or more outcomes, and is the value-producing form.** One word for "maybe do
  this", one word for "cover every case":

```swift
Label when Recipe is Favorite { yes -> "Remove from favorites", no -> "Favorite" }
```

- There is no `if / then / else` expression and no `else if` chain; either would give `if` two
  contradictory shapes. A chain of unrelated conditions is nested `when`, or a subject-less
  `when { A -> …, B -> …, otherwise -> … }`.
- **Cases may be predicates on the subject**, matched top to bottom, so a range split needs no
  `else if` chain either:

```swift
when Screen.Width { < 500.px -> Narrow, < 1000.px -> Medium, otherwise -> Wide }
when Servings { < 2 -> "solo", < 6 -> "family", otherwise -> "a crowd" }
```

This is what the design's `screens { }` block (§13) desugars to.

- **A yes/no value has a compact two-outcome form**, so the common case need not spell out the full
  block. `yes / [Alias] no` is a type expression like any other (§2) — the same mechanism as
  `one of A, B, C` — so it can name a standalone type or head a field, and a value of it can be
  matched inline. The label before the second branch is mandatory, and is either the universal `not`
  or the type's own no-pole alias when one was declared:

```
when <boolean-expression> <YesExpr>
when <boolean-expression> <YesExpr> / not <NoExpr>
when <boolean-expression> <YesExpr> / <NoAlias> <NoExpr>
```

```swift
item Person { Happy yes / Sad no }
let Person = { Happy no }                    // the field literal's explicit no form (§2);
                                              // reuses the type name, same as Testing below

when Person.Happy A                          // sugar for { yes -> A, no -> none } — an optional result
when Person.Happy A / not B                  // the universal label, always available
when Person.Happy A / Sad B                  // Happy's own no-pole alias reads equally well

let Foo = yes                                // yes/no is a type in its own right, usable bare
when Foo A / not B                           // Foo has no declared alias, so only `not` is available

type Testing is yes / Production no
let Testing = yes                            // reuses the type name in value position — the two
                                              // namespaces are distinct, so this is not a collision
when Testing A / Production B                // a standalone type's alias works the same way
```

This is the value-producing sibling of the block form (`when X { yes -> A, no -> B }`), for exactly
the two-outcome case; a case type with more than two cases still needs the block.

### Stopping early

Three constructs, one per context, so no word is asked to mean two things:

- **`guard <data object> { <matches> }` — views only.** If any case matches, its block renders and
  the rest of the view does not. This is the same `guard` as the app-wide net (§5): it is about a
  _data object's availability_, never about a boolean:

```swift
file view RecipeScreen(Recipe) {
   guard Recipe { loading -> Spinner(), missing -> EmptyState(Title: "This is gone") }
   render Col [screen] { Text(Recipe.Title) [title] }   // reached only once Recipe is available
}
```

- **`check <boolean expression>` — actions only.** If the expression is false, the action stops
  there. This is what makes the confirmed-destructive idiom read plainly:

```swift
action Delete() runs single {
   let Sure = ask Confirm(DeleteRecipeQuestion(Recipe.Title), Verb: "Delete")
   check Sure
   delete Recipe
}
```

- **`if <boolean expression> { … return }` — functions only.** A function stops by returning, and
  `if` is the one-sided test that gets it there:

```swift
function FirstOwner(Household is Household) returns Account {
   if Household.Memberships is empty { return none }
   return Household.Memberships[0].Person
}
```

- Drafts are durable and belong to the row, so there is **no discard-changes dialogue** and nothing
  to guard on leaving a screen. If a leave hook is ever needed it is the navigation lifecycle
  (DEF-NAV-006), not a variant of any of these three.

---

## 9. UI

- **One renderable declaration kind: `view`.** A screen, a reusable leaf, a content-accepting
  wrapper, and a modal that answers are all the same declaration. Nothing about a view's role is
  written on its head, because every distinction a kind could carry is either read off the body or
  belongs to the call site. (`scene` — amended below — is the single exception, and it is not a
  second kind: `scene is view`, and it carries the one fact a body genuinely cannot state.)

```swift
view RecipeScreen(Recipe) { … }                        // a link presents it (§10) — nothing marks that here
file view RecipeCard(Recipe) { … }                     // a reusable leaf
view Section(Title text) { render Col [card] { Text(Title) [sectionTitle]; @@content } }
view Centered() { render Col [screen, content center center] { @@content } }
file view NewRecipeSheet(Household) responds Recipe { … }   // answers with a typed value
```

- **Presentation is a property of the call site, never the declaration.** A view composes inline in
  a render tree, or `nav` presents it — `present X(…) as overlay | sheet | window | root | menu |
  toast`, `reveal X(…) in @slot` (§10) — with the mode chosen where the presenting happens. No
  keyword marks a view navigable, modal, or reusable.
- **Capabilities are inferred from the declaration, never declared.** A view accepts caller content
  iff its body places `@@content`; it offers named render slots iff its body declares them; it
  returns a typed answer iff its head declares `responds T`. The `responds` clause survives the
  `dialogue` kind it arrived with.
- **One body grammar.** State, entity queries, actions, commands, aliases, tags, and render are
  legal in any view body — there is no statelessness ladder, so a stateful content-accepting
  wrapper (a collapsible section) is expressible.
- **Host-facing self-description is supplied slots on `scene`** (amended by KEY-D11; they began on
  `view`). The prelude owns the vocabulary, not the compiler: `Title`, `Toolbar`, and `Header`;
  `Icon`, `Badge`, detents, appearance, and package-extensible host traits wait for forcing
  features. A fill is an ordinary capitalized member in the body — no content-side keyword or
  declaration modifier is added — and its value is an ordinary reactive expression over the scene's
  parameters, state, and reads:

```swift
scene RecipeScreen(Recipe) {
   Title Recipe.Title
   command Share() {
      Title "Share recipe"
      Icon "square.and.arrow.up"
      do ShareRecipe(Recipe)
   }
   Toolbar { Share }
   render RecipePage(Recipe)
}
```

- **`scene is view`: a scene is presented, never composed.** That is the one fact a body cannot
  state, and the only reason the kind exists. Because the chrome slots live on `scene` alone, a
  declaration that is only ever composed _cannot_ declare a title nothing would read — dead chrome
  becomes unrepresentable rather than merely discouraged. Composing a scene inline is diagnosed at
  the render site. This reverses part of the unified-view decision above, for that stated reason.
- **A plain view may still be presented.** A scene is the way to _add_ chrome, not a requirement for
  presentation: a pushed plain view is legal and shows Back-only header chrome. `nav is scene`, so a
  mounted navigator still supplies its own chrome.
- **`Header false` is the explicit opt out**, for a scene that owns its whole surface. Back still
  works through the reducer, the gesture, and the hardware key — only the bar is gone. A scene that
  suppresses its header may not fill `Title` or `Toolbar`, by the same rule that put the slots on
  `scene` in the first place, and is exempt from the pushed-scene `Title` requirement.

- **A host reads only the directly presented scene.** Host-facing slots never bubble from descendants;
  a wrapper that carries a title or toolbar fills its own slots from its own parameters. Because
  `nav is scene is view`, so a nav inherits the same optional slots rather than masking them, but a host
  never reads through the nav to whichever descendant it currently presents.
- **Self-description stays with the scene; presentation policy stays at the call site.** A presenter
  cannot override `Title` or `Toolbar`; two presenters that need different policy express that policy
  on `present` (`Key: Recipe` remains on `present … as window`), while stable self-description is a
  slot. Whether a slot is required is inferred from the host usage in §10, never from the view head.
- **No arrangement-only category.** A wrapper that only positions caller content (`Centered`) and
  one that owns content around it (`Section`) are indistinguishable to the language. If a future
  rule ever needs the distinction, it returns as a property derived from the render tree, never as
  a keyword (`Docs/Roadmap/Deferred Tao language decisions.md`).

**Amended by the unified view tranche.** This section originally decided five renderable kinds —
`ui` (navigable), `view` (reusable leaf), `frame` (content-owning wrapper), `layout`
(arrangement-only wrapper), and `dialogue` (typed answer) — with capability and presentation read
off the keyword. Every distinction the kinds encoded is derivable from the declaration body
(`@@content`, slot declarations, `responds T`) or belongs to the site that presents the view, so
the kinds priced a second copy of information the compiler already has, and their statelessness
ladder forbade legitimate combinations (a stateful wrapper). The keywords `ui`, `frame`, `layout`,
and `dialogue` retire with nothing replacing them — no marker, no modifier — and the primitive
types `visual`, `presentable`, `ui`, `frame`, and `layout` collapse into the single primitive
`view` (`nav`, `datasource`, and `app` are untouched). A `public destination` marker for
package-exported views was considered and deferred (`Docs/Roadmap/Deferred Tao language
decisions.md`).

**Amended by KEY-D11 and the host-read/native-nav tranche.** The unified view decision made
every view presentable but left host-owned chrome without a typed way to read the presented view's
self-description. The declaration model already supplies that mechanism: primitive families own
supplied slots in the prelude and declarations fill them as named members. `Title` and `Toolbar`
therefore live on `scene is view` as optional host-facing slots. They remain reactive,
direct-only, and usage-required; no second metadata channel, preference bubbling, call-site override,
or compiler-owned title vocabulary is introduced. `nav is scene is view` keeps the slots by refinement so a
navigator can describe itself when it is itself presented, without exposing its child's slots.

- **Every declaration's parameter list is parenthesized, including an empty one** — `view
  RecipeLibrary()`, `action Add()` — so a declaration mirrors the call site that invokes it.
- **Parameter types are inferred from the type name** — `view RecipeScreen(Recipe)` — not restated.
  A stated type is juxtaposed and its traits trail, exactly as in a field: `view Status(Message
  text, Tone default Neutral)`, `view CookScreen(Recipe, Meal?)` (§2).
- **Every argument list is parenthesized, containers included**: `Col() [page]`. This reverses an
  earlier exception — "empty argument lists on containers are omitted" — which never survived contact
  with the implementation. The exception bought a little quiet in the render tree and cost a rule:
  §10's own shell example writes `Col() [fill]` and `Navigator() [fill]`, `Docs/Spec/Tao Layout and
  UI.md` states that render arguments are always parenthesized, and `1 - Current` has written `Col()`
  since the surfaces tranche. The mirroring rule now has no exception anywhere, which is worth more
  than two saved characters per line. _(Amended while rewriting `Apps/WordFlower/4 - Revolution`,
  Process step 2.)_
- **`render` introduces the visual tree**, and the visible hierarchy is the primary shape of the code:

```swift
render Col [screen] {
   Text(Recipe.Title) [title]
   Row [gap sm] { Text(Recipe.Course); Text(Recipe.Servings) }
}
```

- A **`[ … ]` clause list** after any element carries layout and style, resolved through the design.
- **Conditional styling has three shapes, and a list may mix them.** Each entry stays an entry, so
  independent conditions coexist without nesting:

```swift
// A condition postfixed to an entry. Several may sit in one list, independently.
render Foo2 [ink green when Person.Happy, ink red when Person.Sad]

// A case map supplying one clause's value.
render Foo [ink when Timer.EndsAt > Now { yes -> fine, no -> good }]

// A case map supplying whole clause lists, beside an ordinary postfix condition.
render Row [card, when Tone { Neutral -> [background sunken], Good -> [ink good] },
            ink accent when Tone is Warning]
```

- The three are told apart by what is present, not by lookahead: an entry that _starts_ with `when`
  is a case map over clause lists, an entry whose clause already has its value takes `when` as a
  postfix condition, and an entry whose clause still needs a value takes the `when` block as that
  value.
- **Interaction states are ordinary conditions**: `pressed`, `focused`, and `hovered` may appear
  wherever a `when` condition may — `[background ember.20 when pressed]` — so control-state styling
  is this same grammar, not a separate one (§13).
- A map over a case type is often better expressed once in the design — a parameterized entry
  (`[background aisle(Grocery.Aisle)]`, §13) — but the site retains the ability.
- **Layout primitives express intent**, never device coordinates or flexbox mechanics:

```swift
Row [gap md, content spread center] { Text(Recipe.Title) [claim 1]; Icon("chevron.right") }
```

- **`Grid` is a layout container in the `Col` / `Row` / `Scroll` family — it wraps a `loop`, never
  iterates itself.** `loop` stays the one construct that iterates (and keys each item by its row id),
  so the vertical list and the grid are the same shape. Non-loop children before the loop are the
  header, after it the footer; emptiness stays at the site (§5):

```swift
Grid [cell min 220, gap md] {
   Text("This week's picks") [sectionTitle]              // header — scrolls with the grid
   loop Recipes / Recipe {
      RecipeCard(Recipe) [span 2 when Recipe is Featured]
      on select -> { open RecipeLink(Recipe) }
   }
}

Grid [columns 7, gap sm] {                                // a generated collection: a calendar
   loop WeekOf(WeekStart) / Day { DayCell(Day); on select -> { set Selected = Day } }
}
```

- **Grid's clauses**: `cell min 220` (as many columns as fit cells that wide — a compile-time
  lowering to the bridged component's integer column count, recomputed from the container),
  `columns 7` (fixed, conditionable: `columns 7 when wide, 4 when medium`), `gap`, `masonry`, and
  per-item `span N`. The runtime bridge is Shopify's FlashList — virtualization, recycling, masonry,
  and spans are its; the min-width arithmetic and the collection-owned selection are Tao's, since
  the platform has neither.
- **Every element kind declares which clauses it accepts, and the validator rejects the rest** with
  a targeted diagnostic (`'cell min' applies to Grid`). Clauses are presentation, so they never
  move into the parentheses — parentheses carry data, brackets carry presentation.
- **Paged content binds to a 1-based index**, two-way like `Value:`, and moving is an ordinary
  assignment — there are no `next page` / `previous page` verbs, and no separate row-selection
  binding, because `on select` on a loop already covers that. `Pages` wraps a `loop` exactly as
  `Grid` does, so "containers wrap, `loop` iterates" holds without exception:

```swift
state StepNumber = 1
Pages(Page: StepNumber) {
   loop Recipe.Steps / Step {
      Col [gap md, content center center] {
         Text("Step { Step.Position } of { Recipe.Steps.Count }") [caption]
         Text(Step.Text) [pageTitle, center]
}  }  }
Button("Next") { on press -> { set StepNumber += 1 } }
```

- **This binds to every store the language targets.** Which mechanism the pager reaches depends only
  on what it is paging:
  - An **owned relation** (`Recipe.Steps`) is loaded whole with its parent, so `Page:` is an index
    into an in-memory list. No backend pager is involved, `Count` is the list's length, and live
    updates arrive with the parent row.
  - A **top-level collection** (a `loop` over `MyKitchen.Recipes` inside `Pages`) lowers to the store's
    offset/limit window: `offset (N-1) × size, limit size`. That is InstantDB's native pager (its
    docs use `pageNumber` exactly this way), Supabase's `.range()`, and an ordinary `offset` argument
    on GraphQL; a pure Relay connection with opaque cursors is walked forward and cursors are cached
    per page. The window stays live where the store is live.
  - "N of M" over a top-level collection needs a count the store may not offer cheaply (InstantDB
    exposes `hasNextPage` to the client, not a total), so `Recipe.Steps.Count` is exact and free
    while `Recipes.Count` may lower to a separate count query. Both spellings are the same in Tao;
    only the cost differs.
- **Events attach in the element's own block**:

```swift
Button("Save") { on press -> { save Edit } }
TextField(Value: bind New.Title) { on change -> { } }
```

- **A ticking clock is a library value, not a language construct.** There is no `clock` declaration,
  no `live` binding, and no `every` clause; the runtime library exposes an interval whose value is
  reactive, and ordinary `let` derives readings from it:

```swift
use Interval from @tao/time

file view TimerBar(Timer) {
   state Tick = Interval(1.s)                    // starts on mount, stops when the view unmounts
   let Left = Timer.EndsAt - Tick.Value          // Tick.Value: the time as of the latest tick

   render Row [card, content spread center] {
      Text(Timer.Step.Text, Lines: 1) [label, claim 1]
      Text(when Left > 0 Left.Clock / not "Done") [pageTitle, ink good when Left <= 0]
   }
}
```

`Tick.Stop()` and `Tick.Start()` control it; `Tick.Running` reads it. The lowering is the obvious
one — `setInterval` plus a state update per tick — and because `Interval` is a library value
bridged like any other (§15's `from` mechanism inside `@tao/time`), the language carries no timer
grammar at all. One interval serves several displays through derived `let`s.

**Amended by the focused writing tranche** (implemented; `Docs/Roadmap/Focused writing tranche/`). This
section and §11's `use auth from @tao/auth` originally imported a stdlib package under a lowercase
service name and reached its declarations through it (`time.Interval(1.s)`, `auth.Account`). A
package binds nothing of its own: `use X from @pkg` imports declarations by name, as every other
import in the language does, so the spelling is `use Interval from @tao/time` and `Interval(1.s)`.
Implementing the service form would have needed a second `use` form plus a package-as-namespace
value kind, and the segment names of the packages that already exist — `ui`, `nav`, `data` — were
Tao keywords at the time (`nav` and `data` still are; the unified view amendment above later retired
`ui` as a keyword, and the `@ui/` folder name deliberately survives it), so the shape does not
generalize to the packages it would first apply to. A package that
wants a namespace declares a type or a value and exports it under a name.

- **`loop` repeats content over a collection with the singular row name**:

```swift
loop Recipes / Recipe {
   RecipeCard(Recipe)
   on select -> { open RecipeLink(Recipe) }
}
```

- **Accessibility is part of the model.** Semantic labels on controls and non-text media, focus as
  declared product behaviour, and design checks that reject unnamed interactive elements:

```swift
Image(Recipe.Photo, Description: Recipe.Title)   // a semantic label, not decoration
```

- **For the Revolution target, a collection row's interaction label is derived, never declared**
  (amended by KEY-D2, D5). The interaction outline names every `loop` row by one static ranking: the
  first unconditional `Text` the row renders whose value is a member path on the row — preferring
  the entity's `(title)` field when the row renders it, and following a bound parameter one level
  into a rendered row view — then the `(title)` field read at runtime, then the entity and its
  handle. A function-wrapped or interpolated value is opaque and passes to the next candidate. One
  computation names the row for the outline, palette, and a journey's `expect label`; a selectable
  row also projects it as the accessible name of its press surface. A non-selectable row does not
  gain a row-level accessibility traversal stop: its visible descendant text remains
  platform-readable. A row with several roots has no root-level label projection, which the
  validator hints. The rest of the outline is derived the same way: a `loop` is a collection and
  each row an item; a render binding `Press` or `Submit`, or a row with `on select`, is an action
  control; a render binding `Value` with a change is an input control; a presented occurrence, a
  selection item, and a split pane are regions.

- **A map must name a non-map alternative** over the same rows. Location graphics are never the only
  way to use a feature:

```swift
Map(Places) alternative { loop Places / Place { PlaceRow(Place) } }
```

---

## 10. Navigation

- **Four container kinds**: a back-stack, a replaceable detail pane, an adaptive selection container,
  and a multi-pane split — `StackNav`, `SlotNav`, `SelectionNav`, `SplitNav`. The selection container
  was first written `TabNav`, which named one of its surfaces rather than what it is: the same
  declaration is a tab bar, a sidebar, a drawer, or a toggle bar depending on `Display` and width, so
  the kind is named for the selection it owns. `TabNav` is retired without an alias, and the
  host-read-set bullet below — which already said `SelectionNav` — is the spelling the rest of this
  document and the implementation use. _(Amended while rewriting
  `Apps/WordFlower/4 - Revolution`, Process step 2.)_
- **Navigators are keywordized bindings**: `nav WelcomeNav = StackNav { Initial WelcomeScreen() }`.
- **The selection container is tabs when narrow and a sidebar when wide**, declared once, with no
  device name anywhere:

```swift
nav SkilletNav = SelectionNav {
   @library StackNav { Initial RecipeLibrary }
   @plan    StackNav { Initial WeekScreen }
}
```

- **The split declares compact progression and pane collapse order once**; the runtime picks panes
  from available width:

```swift
nav RecipeWorkspace = SplitNav {
   Compact { Progression @list, @detail; Back reverse }
   @list   { Content StackNav { Initial RecipeLibrary }, Width 420, CollapseOrder 1 }
   @detail { Content SlotNav { Initial NoRecipeSelected }, Width min 460, CollapseOrder 2 }
}
```

- **`Progression` is an ordered listing, not new syntax** — the order of the names _is_ the
  compact-width progression, so no arrow appears. `Back reverse` walks it backwards.
- **`CollapseOrder N` means the Nth pane to fold away as width shrinks** — order 1 folds first, so a
  tablet losing width keeps `@detail` (the recipe) and folds the list. The member is named `Order`
  rather than `Priority` precisely because "priority 1" read both ways in the source designs; an
  _order_ is self-evident.

- **A render site may name a nav** (KEY-D7 as amended by the shell-composition review, 2026-09-02).
  `nav is scene is view`, and the grammar agrees: everything that renders a view renders a nav, so
  persistent chrome around navigated content is ordinary layout — a `Col` holding the navigator and
  a bar — and no frame kind exists. The app root is a view with arguments, and a nav-typed
  parameter renders like any other view, which is how one shell serves every preview variant:

```swift
app Skillet {
   Name "Skillet"
   view SkilletShell(SkilletNavigator)
}

view SkilletShell(Navigator nav) {
   render Col() [fill] {
      Navigator() [fill]
      when CurrentCook { empty -> { } otherwise -> { CookBar() } }
   }
}
```

- **A rendered nav still owns its occurrences, Back, restoration, and chrome**; only where it sits
  in the tree changes. Three invariants keep it honest, all diagnosed at the render site: a nav
  renders **at most once**, **never inside a loop**, and **never inside a conditional branch** — its
  history lives on its mount, so a branch that unmounted it would silently drop where the person
  was. The bar beside it may be conditional; only the navigator is held to the rule. A nav or a
  parameter renders as the value it was bound to, so the render site passes it no arguments,
  content, or events.
- **The host routes to what it holds.** Back reaches a rendered nav through the presentation that
  hosts it, after that presentation's own overlays and content history; `present @key` reaches a
  rendered selection the same way; and a rendered nav restores by its own declaration identity when
  it mounts. `replace … in app` replaces the whole root — the shell view included — because the
  root is what the app mounts. The rail retires into ordinary shell layout, and the shell root
  stops being special: an app mounts one nav, synthesized around its root view when the root is a
  view.

- **A live root.** The top-level experience follows workspace state as an ordinary reactive value:
  `view when MyKitchen { loading -> Loading, none -> WelcomeNav, otherwise -> SkilletShell(SkilletNavigator) }`. No
  screen imperatively replaces the app.
- **Reveal-or-focus, never duplicate.** `reveal Screen(Row) in @slot` focuses an equal mount instead
  of stacking a second copy of the same product state:

```swift
reveal RecipeScreen(Recipe) in @detail   // a second call with the same Recipe focuses, not re-mounts
```

- **Presentation modes with automatic fallbacks** — overlay, sheet, window, root, menu, toast. A
  window is a window on a laptop and a full-screen sheet elsewhere, and carries a semantic key so
  reopening the same subject focuses one window. **An overlay is Tao's own layer and a sheet is the
  platform's**: every nav owns an absolute overlay lane above its content, so an overlay stacks there
  — covered entries stay mounted but hidden, and `dismiss` or Back consumes the top one before the
  nav's ordinary content history — while a sheet is the card the OS slides up and lets a person drag
  down. Both are dismissible modals; only the sheet hands presentation to the host. This mode was
  implemented and specified from the start and was missing from this list rather than from the
  language. _(Recorded while rewriting `Apps/WordFlower/4 - Revolution`, Process step 2.)_

```swift
present JoinKitchen(Code) as sheet
present WorkspaceNameNotice() as overlay
present CookScreen(Recipe) as window (Key: Recipe)
present SharedRecipeScreen(SharedRecipe) as root
present ActionsMenu(Recipe) as menu
present Notice("Saved") as toast
```

- **One declaration carries address, URL, and mounting policy.** There is no separate destination and
  mount:

```swift
link RecipeLink(Recipe) "/recipes/{Recipe}" -> {
   reveal RecipeScreen(Recipe) in @detail   // revealing into a slot also selects the tab holding it
   focus @detail
}
link CookMealLink(Recipe, Meal) "/cook/{Recipe}/{Meal}" -> {
   present CookScreen(Recipe, Meal: Meal) as window (Key: Recipe)   // one window per recipe
}
link JoinLink(Code secret) "/join/{Code}" -> {
   present JoinKitchen(Code) as sheet
}
```

- **Link parameters are declared on the head.** Entity parameters name their entity type; other
  parameters state their type, and secrets add `secret`. The path is optional: without one, Tao
  derives a kebab-cased path with parameters in declaration order. Supplying a path is the author's
  explicit stability promise. Links are ordinary in-app invocable declarations and expose `.Url`.
  Alias declarations retain the target's one authored address; a wrapper link is required for a new
  address.
- **A window's `Key:` is the row itself**, which is what makes reopening the same subject focus the
  one window rather than open a second.
- **`focus` takes a slot expression**, so `focus @detail` is the ordinary line and the conditional
  form is just a `when` over the size class:
  `focus when container { narrow -> @detail, otherwise -> @list }`.
- **A link body may write before it mounts**, e.g. `update Me { CurrentHome: Item.HearthList.Home }`,
  so arriving somewhere can set the context that place is read in.
- Restoration needs no per-link clause: C's `restore while Row is available` is already the guard on
  the parameter, and a window's fallback is already the presentation-mode rule.
- **A destination is a derived subset, not a syntax.** The places the `Restore` policy reaches — a
  view presented `as window` or `as root`, mounted in a nav pane, slot, or `Initial`, or named in a
  `link` body — are the app's _destinations_: a word for spec prose and diagnostics only, with no
  surface marker (§9). A destination's parameters must serialize, and that requirement is inferred
  entirely from use — the diagnostic lands at the usage site ("CookScreen cannot be presented as a
  window: parameter `Undo action` does not serialize"), never at the declaration, because the
  declaration is not wrong; the placement is.
- **Host read-sets and requirements belong to the stdlib host family.** For the current families and
  presentation modes, the complete set is:
  - a `scene` entry in `StackNav`, including `Initial` and later pushes, reads `Title` and `Toolbar`
    from that scene and requires `Title`; a plain-view entry reads neither and receives Back-only
    chrome;
  - `present … as window` reads both slots and requires `Title`; its full-screen-sheet fallback on a
    non-windowing target preserves this window contract rather than dropping the chrome;
  - `Toolbar` is optional in both hosts, and an absent toolbar means no toolbar items;
  - `SlotNav`, `SelectionNav`, and `SplitNav`, and the sheet, root, menu, and toast presentation modes,
    read neither slot. Selection items retain their explicit `Label` and `Icon`, and split panes retain
    their own configuration, rather than acquiring values by bubbling from content.

  Native and basic implementations of a family have the same read-set. The native host renders these
  values in platform chrome; the basic host renders equivalent styled Tao chrome. A missing required
  slot is diagnosed at the placement — for example, "StoryScreen is pushed on a StackNav: it must fill
  Title" — because the scene is valid and that use is not. Slot changes update mounted host chrome
  reactively.
- **A responding presentation is never restorable.** A view presented while its `responds T` answer
  is awaited does not survive relaunch — the asking context is gone, so restoring the question alone
  would be a lie. This is consistent with the default exclusions below and holds even when a
  responding view is presented `as window`.
- **A link resolves without an account when its parameters make that possible** — all projections or
  secrets (§4). No `public` marker exists on links or screens.
- **Links wait and win.** A link whose target is not mounted yet runs when it is, so a shared link
  opens after sign-in, and an incoming link supersedes restored state.
- **The browser is a delivery medium, not a language target.** Browser Back dispatches the same
  semantic reducer as hardware Back, visible Back, and tests. Session history mirrors successful
  Back-consumable mutations but is never authoritative over app state; drift is repaired from the
  reducer state. Forward is an in-memory redo of Back: consecutive Back chains replay as fresh
  occurrences, while any new navigation clears the redo journal even when the navigation itself,
  such as selection activation or root replacement, adds no browser entry. An asked occurrence
  is dismissed by browser Back but never re-asked by Forward. Once the app reducer reaches its root,
  Back is no longer intercepted and the browser leaves the app origin. History entries from before
  a reload are inert, and Forward across a reload is not a current goal.
- **Restoration is default-on and host managed.** `Restore` is written only to deviate:
  `Restore automatic { Exclude sheets, menus, toasts }` applies declared semantic-category
  subtractions at snapshot time, while `Restore fresh` on a preview or test variant neither reads nor
  writes host storage. Toasts and responding/asked occurrences never restore by language rule.
  Every committed reducer change schedules a coalesced snapshot and payload equality suppresses
  redundant writes; this classification is intentionally independent of browser-history visibility.
- **Restoration is transactional for the whole app.** A restored tree must be one the live reducer
  could have produced. Invalid or incompatible data, an unavailable provider, an unregistered view,
  or a nav kind without restoration capability emits a warning-level tooling diagnostic and lands on
  the live initial root. Declared exclusions are partial by policy; failures never manufacture a
  partially restored tree. Applications cannot observe restoration diagnostics or name a fallback.
  Production telemetry carries codes and identities, not view arguments or entity tokens.
- **Snapshot identity is owner derived.** Declaration identity is
  `["tao.declaration", 1, projectId, packageId, modulePath, declarationKind, declarationName]`, where
  `packageId` is the owning project's checked-in `@folder` or the reserved `@workspace` root marker.
  Consumers read it and never recompute it from an installation name. Variants and complete
  configured datasource bindings receive distinct snapshot keys. Providers own opaque entity-token
  production and resolution; the snapshot also fixes provider, schema, and entity identity and
  restores a live availability-tracked handle.
- **Project identity is explicit and stable.** Clones, moves, and organizational transfers retain a
  checked-in project ID. `tao project id <new> --replace` is the explicit independent-fork operation
  and severs persisted-state compatibility. Duplicate IDs are rejected when distinct dependencies
  meet locally and at publish time. Public alias chains flatten to the target's canonical identity
  while retaining one-hop lexical navigation; cycles are invalid, and a wrapper creates new identity.
- **Release metadata is source-owned.** `project` carries a numeric three-component SemVer as
  `version "<major>.<minor>.<patch>"` and may name `DefaultApp <AppName>`. An explicit CLI
  `--app` selection wins over `DefaultApp`; without either, tooling presents the available apps.
  `DefaultApp` deliberately remains source-compatible spelling but is parsed as a capitalized
  identifier and validated in the project slot rather than becoming a grammar keyword.

---

## 11. App composition and providers

- **`project { id, name, version, DefaultApp, targets, languages, license }` declares the product envelope**:

```swift
project {
   id "skillet"
   name "Skillet"
   version "1.0.0"
   DefaultApp Skillet
   targets phone, tablet, laptop
   languages "en-US", "es"
}
```

- **`app Name { … }` is the one composition root** selecting design, providers, permissions,
  language, and its root view:

```swift
app Skillet {
   Design SkilletDesign
   Datasource Kitchen
   Notifications Alerts
   view SkilletShell(SkilletNavigator)
}
```

- **App variants are keywordized bindings**: `app SkilletPreview = Skillet with { Datasource Memory }`.
  A variant swaps providers for previews, on-device builds, and tests without forking any product
  declaration. An app that mounts several stores binds the set — `Datasource { Kitchen, OnDevice }` —
  and `Kitchen with { … }` inside that set adjusts one member app-locally (amended into §6).
- **The standard component kits are native by default and keep an explicit basic tier.** `@tao/ui`
  and `@tao/nav` share one package shape: the package root publishes pass-through aliases to names in
  `native/`, while `basic/` publishes clause-honouring portable implementations. Thus
  `use StackNav from @tao/nav` selects platform-native navigation with no ceremony, and
  `use StackNav from @tao/nav/basic` selects the basic rendering without changing the declaration or
  any call site. Native and basic implementations expose the same family configuration and the same
  host read-sets (§10); native uses maintained platform navigation machinery and chrome where
  available, while basic renders the contract as styled Tao controls rather than ignoring it.
- **Provider bindings are keywordized**:

```swift
datasource Kitchen = Cloud { … }
files Photos = Files { … }
notifications Alerts = Notifications { }
permissions LocationAccess { Reason "To find recipes near you" }
```

A provider _type_ that needs a TypeScript implementation names it with an ordinary expression —
`provider FooBar from ./XYZ.ts` (§15).

- **Identity is a library with swappable providers, not language surface.** `use auth from
  @tao/auth` exposes the common interface: `auth.Account` is the live signed-in account (a handle
  with availability — loading, none, available — like any other), and `auth.SignIn(…)` /
  `auth.SignOut()` are ordinary actions whose concrete flow the bound provider supplies (the
  datasource's own auth — InstantDB's magic codes and OAuth — or a test provider in a variant).
  **The convention the demos follow** is one binding at the app root, which is where `Me` comes
  from everywhere else in this document:

```swift
use Account from @tao/auth
let Me = Account                 // module-visible; every screen reads Me, tests sign accounts in
```

The live root then gates on it as ordinary data: `view when Me { none -> WelcomeNav,
otherwise -> SkilletShell(SkilletNavigator) }`. Nothing about identity is a keyword.

- **The datasource is a `Cloud { … }` value** carrying write behaviour, conflict model, delete
  retention, and an `Offline { … }` block:

```swift
datasource Kitchen = Cloud {
   Conflicts fieldwise latest
   Deletes tombstones for 30 days
   Offline { Recipes, Meals, MapTiles for MyKitchen }
}
```

- **Conflict policy is `Conflicts fieldwise latest`** — independent fields, last write wins, no
  dialogue owed, above. Composed edits opt out per draft (§7).
- **Local-first is provider behaviour, not screen code**: optimistic writes, durable queues,
  synchronization, and tombstones — none of which a screen declares or codes around.
- **Delete retention is declared** so a mistaken delete can come back: `Deletes tombstones for 30
  days`, above.
- **The offline block states the full closure** of what remains usable with no network, including map
  tiles: `Offline { Recipes, Meals, MapTiles for MyKitchen }`, above.
- **Each permission carries the human reason** shown at first use, and a permission is a multi-state
  value a screen can render honestly rather than a boolean:

```swift
when LocationAccess { granted -> NearbyPlaces(), denied -> Text("Enable location to see nearby places") }
```

---

## 12. Automations

- **`automation` is provider-owned scheduled work driven by data**, which keeps running when every
  screen is closed. It is explicitly not a timer on one mounted device.
- **Its clause set mirrors what the platform's own notification model specifies** — a trigger, a
  content payload, an interruption level, and a deep link — plus the data-driven clauses only a
  store-owned automation can have:

```swift
automation TimerFinished for Timer {
   schedule at Timer.EndsAt           // the trigger, derived from the row
   while Timer is Running             // cancels once the row moves on
   once per Timer.EndsAt              // semantic deduplication key: one alert per timer per end time
   to Timer.StartedBy                 // the audience — accounts; a notification reaches their devices
   notify time sensitive {
      Title Timer.Step.Recipe.Title
      Body "Timer done — { Timer.Step.Text }"
   }
   opens CookLink(Timer.Step.Recipe)  // the deep link
}
```

- **No `using Notifications` clause** — the app has one notifications provider and naming it per
  automation is ceremony. **The audience is `to <accounts>`** — a notification always reaches an
  account's devices, so `on devices of` says nothing extra. **`opens` is lowercase** like every other
  clause.
- **Urgency is the platform's interruption-level vocabulary, per notification.** iOS defines exactly
  this — passive, active, time-sensitive (and critical, entitlement-gated and out of scope) — and
  there is no per-app quiet-hours API anywhere: do-not-disturb belongs to the person's Focus modes,
  which a time-sensitive notification may break through _if the person permits it_. So Tao has no
  `QuietHours` window on the provider; a bare `notify { … }` is active, `notify passive { … }` waits,
  and `notify time sensitive { … }` is the timer that must ring. The reason lives with the
  automation that knows it, and the person keeps the override.
- **An automation cannot write** (no `then update …`) — if scheduled work must change data, it
  `do`es a transaction rather than holding write authority of its own — and there is no
  `when permission denied` fallback clause: a denied permission is a value the screen already
  renders honestly (§11), and the timer's own view shows "Done" regardless.
- **Scheduling names the owning domain time zone**, so reminders survive travel and daylight saving:
  `schedule at start of Meal.Day in Meal.Household.TimeZone`.

---

## 13. Design system

- **One `design` declaration, organized as typed value blocks plus styles, screens, and rules.** The
  block name types its members — every entry in `colors { }` must be a color — so the checker needs
  no annotations. There is no generic `tokens` block:

```swift
design SkilletDesign {
   colors {
      cream #FBF7EF
      ember #D9622B { 20 #F4D7C8, 60 #B34E1F }        // a family: ember, ember.20, ember.60
      night #16130F
      canvas when Scheme is Dark night / not cream     // a derived, conditional color
      ink   when Scheme is Dark cream / not #2B2622
      aisle(Aisle) when Aisle { Produce -> #7A9D54, Bakery -> #C68B59, otherwise -> #999 }
   }
   sizes {
      xs 4.px, sm 8.px, md 12.px, lg md + 4.px         // folded at build
      screen 20.px, touch 48.px
      readable 1.rem                                    // grows with the person's text setting
   }
   text {
      title [size 24.px, weight semibold, line 30.px]
      body  [size 16.px, line 1.4]                      // a bare number is a ratio (§2)
   }
   screens { narrow below 500.px, medium below 1000.px, wide }
   styles {
      card   [background canvas, radius md, pad md, gap sm]
      danger [ink #C0392B]
      Text   [ink ink]                                  // element default: every Text starts here
      Col    [gap sm]
      Button [tap min touch, background ember.20 when pressed]
      App    [background canvas]                        // the root element's default
   }
   rules {
      rule contrast at least wcag.aa
      rule tap targets at least 44.px
      rule meaning survives without color or motion
   }
}
```

- **A value family nests as a head value plus a block**: `ember #D9622B { 20 #F4D7C8 }` declares
  `ember` and its shades, addressed as paths (`ember.20`); numeric path segments are allowed in
  design names.
- **There is no `meaning` layer and no `dark { }` block.** A semantic role is a _derived color_ — a
  named entry whose value is conditional on the environment (`canvas`, `ink` above) — so the old
  tokens → meaning → dark stack collapses into one block with derivation. A batch form
  (`dark { canvas night, ink cream }`) may return later as pure sugar over these `when`s, if listing
  every override of one condition on one page proves valuable; the same goes for a `platform { }`
  block over `Platform` conditions.
- **The checkable rule survives unchanged**: raw visual values are confined to the design, and
  product screens speak in names. `Text(Recipe.Title) [ink #2B2622]` in product code is rejected by
  the design check; the same literal inside `design { }` is fine.
- **Entries fold or react — two tiers, one grammar.** An entry derived from other entries or
  constants folds at build time (`lg md + 4.px`); an entry conditioned on the environment resolves at
  render, constant per frame. Both are ordinary expressions; only `screens { }` breakpoints must be
  foldable.
- **Parameterized entries** are the case-keyed palette, by the same mechanism as `phrase`:
  `aisle(Aisle)` above, used as `[background aisle(Grocery.Aisle)]`.
- **`styles { }` holds two kinds of entry, told apart by case.** A lowercase name is a bundle a site
  opts into (`[card, danger]`); a Capitalized name is an **element default** — every `Text` in the
  app starts from the `Text` entry, and `App` is the root's. This replaces the
  `style Control { base / variant / state }` stack: the base is the element default, a variant is a
  bundle, and a state is an ordinary condition.
- **Generated interaction affordances use ordinary element defaults** (KEY-D13). `Hint` styles an anchored
  key-and-label affordance and `Overview` styles the generated overview, verb, and palette surfaces;
  an app may override either in `styles { }` without declaring or owning those runtime layers.
  This settles the floating-layer part of LANG-018: a layer is a host-owned rendering above content,
  outside navigation and Back, rather than a declared portal or nav occurrence. The broader modal,
  popover, and authored overlay-family syntax remains deferred.
- **Interaction states are conditions.** `pressed`, `focused`, and `hovered` join the condition
  vocabulary, so state styling is §9's postfix `when` (`background ember.20 when pressed`), not a
  sub-grammar of its own.
- **No reference marker.** A bare name in a clause list resolves to a style, text style, or design
  value; clause keywords are a closed, reserved set, so a style may not be named `pad` and the
  validator says so at the declaration.
- **`patterns { }` is not carried forward.** A named arrangement with slots is an ordinary `view`
  placing `@@content` (§9), and a row pattern like the source designs' `Line` is such a view plus
  element defaults. If a demo finds a need a view cannot meet, it returns.
- **`screens { }` names the size classes** — the block is not called `sizes`, which holds size
  values. No pixel count or device name appears in a screen; the use is `when Screen is narrow`, and
  the block desugars to §8's predicate-case `when` over `Screen.Width`.
- **The environment is a set of read-only reactive values**, Capitalized like every handle. None can
  be `set` — the writable thing is a preference (`update Me { Appearance: Dark }`), and the system
  resolves the value:

| Value       | Type                                                                       |
| ----------- | -------------------------------------------------------------------------- |
| `Scheme`    | `Light / Dark`, resolved from the system and the `Appearance` preference   |
| `Contrast`  | `Standard / High`                                                          |
| `Motion`    | `Full / Reduced`                                                           |
| `TextScale` | number                                                                     |
| `Screen`    | the `screens { }` class                                                    |
| `Platform`  | `Phone / Tablet / Laptop` — the project's targets                          |
| `Pointer`   | `Coarse / Precise`                                                         |
| `Direction` | `LTR / RTL`                                                                |
| `Locale`    | the person's per-app language and region, owned by the OS (§2 Preferences) |

- **Design conditionals are ordinary `when` expressions** — the same three shapes as conditional
  styling (§9). No special syntax exists for the design block.
- **Container conditions are a use-site tool, deferred past MVP, and never a design-block one.** An
  element opts in with `[container]`; `when Container …` is legal only in that element's
  _descendants_, never on the container itself — which makes the measure-loop unrepresentable rather
  than discouraged — and `Container` never appears in `design { }`, because it means something
  different at every site. `Screen` covers the rest, and navigation's `focus when container { … }`
  becomes this same value when it lands.
- **`rules { }` makes accessibility executable — each rule where it is actually decidable** (§16):
  contrast, naming, heading order, and declared tap minimums are build diagnostics; layout-dependent
  rules (200% clipping, overflow) are measured over the scenario gallery; perceptual rules (meaning
  without colour) are stated here as review criteria the gallery surfaces, never as pass/fail.
- **Adaptation reads the person's settings first** — `Motion`, `Contrast`, `Pointer`, `TextScale` —
  before guessing from hardware.

---

## 14. Copy, words, and formatting

- **A quoted string in a copy position is the source copy.** There is no keyword at a use site:
  `Button("New recipe")`, `Text("Shared from Skillet")`. Strings are extracted for translation
  automatically.
- **No key namespace exists anywhere in the language.** The stable key other designs paid a keyword
  for is the source sentence itself, and changing that sentence _should_ invalidate its translations;
  `tao words check` reports the resulting gap. There is consequently no key to write in a rule, a
  test selector, or a catalog path, and no escape hatch that names one.
- **`phrase` names copy that needs more than a literal** — typed holes, plural forms, or measurement
  forms:

```swift
phrase WeekTitle(Day date) = "Week of { Day.Short }"
phrase ItemCount(Count number) = one "{ Count } item" / other "{ Count } items"
phrase Mass(Amount number) = metric "{ Amount } g" / imperial "{ Amount in ounces } oz"
```

- **Inline sentences in `validate`, `required`, and `refuse` are source copy too**, extracted the
  same way, so plain English and localization are not in tension. The sentence lives next to the rule
  that produces it, always.
- **A sentence several rules share is a `phrase`**, which is the same mechanism as every other named
  copy and needs no new one: `phrase InviteUsed = "This invitation has already been used."`, then
  `refuse when Invite is Used InviteUsed`.
- **User data is accepted where copy is expected and is never translated.** Configuration strings
  (icon names, shortcut keys, storage keys) are other types and are never extracted:

```swift
Text(Recipe.Title)        // user data — never extracted, never translated
Text("Shared from Skillet")   // source copy — extracted
Icon("plus")               // a configuration string — a different type, never extracted either
```

- **The words file holds translations only**, keyed by the source literal or phrase name, with
  inheritance between locales:

```swift
words "es" {
   "New recipe"        "Nueva receta"
   WeekTitle(Day)      "Semana del { Day.Short }"
}
```

- **The language comes from `Locale`** — the per-app language the person sets in the system
  Settings, which the OS surfaces once an app ships more than one localization. It chooses which
  `words` block applies; there is no `strings SkilletWords` catalog to bind, and no app-built
  language picker duplicating the OS's (§2 Preferences).
- **A missing translation is a reported gap, never a silent blank**: `tao words check` fails the
  build when a source string or `phrase` has no `"es"` entry, rather than falling back silently.
- **Dates, times, durations, numbers, and units format for the reader at the rendering edge**, from
  semantic values:

```swift
Text(Recipe.Duration)   // a duration value; the edge renders "35 min" or "35 minutos" by locale
```

- **Measurement system follows an account preference, not the language.** Conversion is authored on
  the individual `phrase`, because the unit of a bare `number` is data (an `Amount` beside a `Unit`)
  and the phrase is the only place with standing to say `in ounces`. A typed unit value
  (`distance`, `duration`) needs no phrase at all — it formats at the edge by the same preference.

---

## 15. The TypeScript boundary

- A typed contract is declared in Tao and implemented in a `.ts` sidecar. The compiler checks the
  join in both directions from an emitted type.
- **For values and type slots, `from` is an ordinary expression operator.** Foreign view and action
  declarations use the declaration-head boundary described below.

```
<expression> from <path>
```

The free names in the expression resolve to **named exports** of that path. That is the whole
mechanism: because it is an expression, it needs no keyword announcing it and no declaration form
of its own, and it appears in every position an expression may appear.

```swift
let Blah = FooBar from ./XYZ.ts                      // in value position

type Local is datasource with {
   StorageKey Foo from ./Bar.ts                      // in type position — the slot's type is imported
   provider FooBar from ./XYZ.ts                     // filling the primitive's implementation
}
```

- **It binds loosest**, taking the whole expression to its left, so a call reads the way it would if
  the callee were local: `FetchRecipe(Link) from ./FetchRecipe.ts` is `(FetchRecipe(Link)) from …`,
  a call to the imported `FetchRecipe`, not a call to something taking `Link from …`.
- **There are no default exports.** Every name crossing the boundary is a named export, in both
  directions, which is what lets one file back several bindings and lets an expression carry more
  than one imported name.
- **`from` already means provenance** in `use X from @pkg` — the same word doing the same job. The
  path is written bare rather than quoted, and there is no inline `ts` fence.
- **This retires `implement inject provider|nav "./Local.ts"` and the inline fence.** Nothing
  replaces them: neither `implement` nor a kind word nor a marker keyword survives in these positions.
- **The compiler emits a bridge metadata module beside the Tao source** (`Recipe.tao.ts`), which is
  what makes the join checkable from the TypeScript side.
- **The compiler emits each module's interaction outline table beside that bridge** (KEY-D2, T3):
  one static descriptor per `loop` and per event-wired render — the node kind, the row's label
  ranking, its provenance — which the module's loop frames and render sites reference and the
  runtime registers at mount. The table is generated; the registry, the label evaluation, and the
  accessibility projection are handwritten in `TR.Interaction`, and nothing generated is ever
  attached to `TR`.

### Foreign views

A view may declare a named TypeScript implementation in its head:

```swift
view CodeEditor(Content text, Change action(text)) accepts content slots @toolbar from ./CodeEditor.tsx
```

- The sidecar provides the named export matching the view declaration.
- Tao owns the public parameter, response, caller-content, and named-slot contract. Evaluated values
  cross as plain JavaScript values; action parameters cross as invokable action values.
- The component receives `Layout`, `Tag`, one `Slots` record keyed by the declared `@slot` names, and
  `children` only when the head declares `accepts content`.
- The component owns its native root, honors Layout and Tag, and renders every accepted content channel
  exactly once. `responds T` remains available on the foreign view head.
- `render inject` remains the occurrence-level native implementation form; a foreign view declaration
  does not replace it.
- The compiler follows transitive relative static imports, dynamic imports, and re-exports for TypeScript,
  TSX, JavaScript, JSX, and JSON sidecar files. Installed packages remain external.

### Action failures

A native action declares a failure where it detects it, and its failure contract is inferred:

```swift
type SaveFailure is one of Offline, Rejected

action Save() {
   fail Offline "Could not save this draft."
}
```

- `fail Case "sentence"` aborts the complete joined action call, discards its private writes, and skips
  the remaining statements in every caller block.
- A native action's cases are inferred from its own `fail` statements. The same case may appear at
  multiple detection sites with different sentences.

A foreign action has no Tao body and declares its failure cases on the declaration head:

```swift
action Publish(Value text)
   fails Offline "Publishing is unavailable."
   fails Rejected "Publishing was rejected."
   from ./Api.ts
```

- `fails Case "sentence"` is available only on a foreign action. The sidecar provides the named export
  matching the action declaration.
- Crossing the boundary is an inline external effect. It is not reordered, deferred, or rolled back.
- A provider failure selects a declared case and may carry a server-authored sentence. An unknown case
  stays unknown and never borrows copy from another declaration.
- Failure messages use, in order: the provider/server sentence; the matching foreign declaration or
  native `fail` sentence; then `Couldn't finish '<action name>.' Nothing was changed.`.
- Injected code holds no authority. Validation and durable authority stay in Tao; failures cross as
  structured outcomes rather than arbitrary thrown application values.

The broader runtime action-transaction model remains explicitly deferred in `Roadmap.md`; these failure
contracts do not settle distributed atomicity, automatic retry, or rollback of external effects.

### Unexpected render failure containment

- **Containment is automatic and has no Tao author syntax.** Every loop item is isolated from its siblings,
  every screen or presented view is a screen boundary, and every app host has an overlay boundary. Healthy
  children render directly rather than through a permanently visible diagnostic surface.
- After a crash, the boundary reruns the same subtree through a diagnostic pass using compiler-owned
  declaration and source metadata plus bounded, structurally redacted arguments. The same failure against
  the same state escalates from item to screen to app; at app level it becomes a stopper rather than a
  retry loop.
- Recovery offers **Try again** only when no external effect occurred since the boundary began. **Restart
  app** remounts without clearing data. **Reset app data** appears only when every participating provider
  grants reset, requires a second confirmation, and creates a recoverable backup before destructive calls.
- This adopts containment and recovery only. The generalized semantic capture/replay artifact remains
  explicitly deferred in `Roadmap.md`.

---

## 16. Verification

- **`fixture` builds a named, reusable data graph plus identity state.** Its rows are handles that
  tests and scenarios point at:

```swift
fixture HomeKitchen {
   account Ro { Name: "Ro", Email: "ro@example.com" }
   Home = create Household { Name: "Garden Kitchen" } through StartKitchen(Ro)
   Shakshuka = create Recipe { Household: Home, Title: "Shakshuka", Servings: 4 } for Ro
}
```

- **`test "sentence"` is a journey at product altitude**, run on a named device class, with a fresh
  store, clock, and network per test:

```swift
test "cooking the first thing" on phone with HomeKitchen {
   run Skillet
   press "Recipes"
   press "Shakshuka"
   expect text "Shakshuka"
}
```

- **`test` in test files, `check` everywhere else.** Journeys are `test "…"`; `check <boolean>` is
  only ever the early-exit statement inside an action (§8). The two words never meet: a test file
  declares journeys and never needs an early exit, and product code never declares a journey. The
  earlier `check "sentence"` spelling for journeys is retired.
- **Tests nest.** A `test` may contain other tests, which is how a file groups journeys over one
  subject without repeating its setup. An inner test's sentence reads as a continuation of its
  parent's, and the parent's `with <fixture>` and device apply to every test inside it:

```swift
test "workspaces" on phone with HomeKitchen {
   test "creating one names it" { … }
   test "renaming one keeps its documents" { … }
}
```

- **`select` stays** for reaching into a repeated element by position:
  `select #recipeRow[2] { expect text "Shakshuka" }`.
- **`data <status>` is retired.** Driving a provider into `loading`, `error`, or `ready` from a test
  step is not carried forward; the states it exercised are reached through the world controls below
  (network, sync, and the datasource fault injection) or return later under a spelling that names
  the provider rather than a bare `data`.
- **UI steps select by visible text or `#tag` — there are no role words in test syntax.** `press
  "New recipe"` matches by accessible name; `enter "Foxglove" into #kitchenName` reaches what
  visible text cannot identify. A `#tag` lowers to the runtime's own `testID`, and text matching is
  the testing library's ordinary query, so steps map one-to-one onto what the harness can actually
  do. Accessibility is not weakened by dropping the role words, because it is enforced where it is
  declared: the design's `rules { }` (one accessible name per control, heading order) run over every
  scenario (§13), which is a stronger guarantee than each journey re-asserting roles line by line.
  Selectors never name a translation key, because there are none (§14).
- **Tests assert the rendered source-language sentence** (`expect text "…"`). A test that must hold
  in any locale asserts the phrase value instead:

```swift
expect text InviteUsed   // holds under any locale, since it names the phrase rather than its English
```

- **Store checks are ordinary queries, not an assertion sub-language.** A test's scope reads the
  store with full authority (it is the harness, not a person), so it queries with the same syntax
  product code uses and asserts on plain values — no `expect stored` grammar to learn, and nested
  graphs are just traversals:

```swift
let Garden = Households where Name is "Garden Kitchen"
expect Garden.Count is 1
expect Garden[0].Memberships.Count is 1
expect Garden[0].Memberships[0].Role is Owner
expect Shakshuka is Private
```

- **Policy is probed by acting as an account** — a hidden button is not proof of security, so the
  test writes _as_ someone and watches the store refuse:

```swift
as Ro update Shakshuka { Shared }
expect refused
expect Shakshuka is Private
```

- **The world is controllable**: clock and advance, network offline and online, wait for sync,
  relaunch, additional accounts, and collaborators acting concurrently.
- **Fault injection proves atomicity, and the proof is read off the screen.** The injection is
  addressed at the provider and names the write that fails — not a position in a transaction, which
  breaks silently when the body is reordered — and the assertion is the UI content a person would
  see, plus a query where the absence matters:

```swift
datasource fails after create Membership "cloud rejected the membership"
press #createKitchen
expect text "cloud rejected the membership"
expect (Households where Name is "Foxglove").Count is 0   // nothing landed — the atomicity proof
```

- **Sidecars are stubbed by contract**, not by mocking a network, and the stub is addressed to the
  action — there is no separate `sidecar` keyword, because the action is the thing being stubbed. A
  failure stub picks a **declared case**, so renaming a case breaks the test at compile time rather
  than silently passing; a stub by message would match copy, which the words file translates:

```swift
action FetchRecipe fails NotARecipe
action FetchRecipe returns { Foo: 1, Bar: ["123", "abc"] }
```

- A success stub supplies the **value**, so it needs no type name and works whether the action's
  return type was named or written inline.
- **A preference in a test is an ordinary update, and the device locale is a scenario pin — both
  within the runtime's real capabilities.** `prepare { update Me { Units: Imperial } }` is just data.
  `locale "es"` on a scenario lowers to mocking the localization module (expo-localization) in the
  Jest environment, which is the standard, supported move — so no account-scoped `set X for Ro`
  statement exists, and nothing pretends to change the OS.
- **Pseudolocale is a scenario mode, exactly as the platform does it.** Xcode runs an app in
  Double-Length, Accented, or Right-to-Left _pseudolanguages_ as scheme diagnostics — review modes,
  never shipped languages — so Tao mirrors that: `locale pseudolocale` on a scenario, paired with
  `direction rightToLeft` so mirrored layout is reviewed in the same pass, and never an entry in
  `project { languages }`:

```swift
scenarios SharedRecipe "localization" {
   fixture RiverKitchen
   run Skillet at SharedRecipeLink(Shared)
   device phone

   scenario "pseudolocale" {
      locale pseudolocale
      direction rightToLeft
   }
}
```

- **`scenario` pins a named, buildable app state** — fixture, destination, device, appearance, text
  scale, contrast, motion, network, clock, locale — for screenshots and review:

```swift
scenarios Recipe "devices" {
   fixture HomeKitchen
   run Skillet at RecipeLink(Shakshuka)

   scenario "tablet" {
      device laptop 1440 x 900
      appearance dark
   }
}
```

- **Scenarios are string-named groups containing string-named entries.**
  `scenarios [Subject] "group" { … }` has an optional app or view subject and a required group name;
  every nested `scenario "entry" { … }` has a required entry name.
- **Group clauses are inherited defaults.** An entry clause of the same kind replaces the group clause
  wholesale, including the mutually exclusive `run`/`render` subject clause. After inheritance, every
  entry has exactly one device and subject; a declaration subject supplies an omitted subject. Fixture
  is optional and yields an isolated empty store, but handles in `prepare` or render arguments require it.
- Entry names are unique within a group. Language identity is `(group, entry)`; compiler and Studio
  identity also include source path. The former dotted singular spelling is retired without an alias.

- **A scenario subject is either an app run or one focused view render.** `run Skillet` exercises the
  app, optionally at a destination; `render RecipeRow(Recipe: Shakshuka)` mounts one parameterized
  view with named fixture-handle arguments. The two subjects are mutually exclusive. Only a scenario
  render may omit a required action, receiving a per-cell invocation-recording stand-in from Studio.
- **A scenario entry may continue with an ordered interaction prefix spelled exactly like a test
  body.** Complete `press`, `enter`, and `submit` operations join `press down`, `press up`, `hover`,
  tag-only `focus`, and deterministic `advance`. `select #tag[index] { … }` scopes nested replayable
  interactions to one loop row. Assertions, app launch or relaunch, navigation `back`, and host-only
  toolbar operations remain test-only. Studio replays the prefix once per mounted revision and
  leaves the reached state interactive.
- **`prepare` is the scenario-local data delta.** It contains ordered `update <fixture-handle> { … }`
  statements applied after the selected fixture and before the subject mounts. It does not introduce
  a second fixture or hidden Studio-owned state.
- **The first network spelling is exactly `network online` or `network offline`.** Latency, injected
  failures, and synchronization controls remain part of the broader verification world and need their
  own provider-addressed spelling before they join authored scenarios.

- **Sketch placeholders and flexible space are semantic stdlib leaves.** `Placeholder(Label)` shows
  labelled hatch chrome only in development, is empty without changing declared layout in release,
  and receives an ordinary `tao check` shipping warning. `Spacer()` has implicit `claim 1`, replaced
  by an explicit occurrence-level `[claim N]`.

- **There is no `design check` declaration.** The design's `rules { }` are the acceptance criteria,
  and each rule runs where it is actually decidable, so nothing is restated at a check site and
  nothing pretends to be a test that a machine cannot in fact perform:
  - **Statically decidable rules are build diagnostics** — free, always on, no test run involved.
    Because raw values are confined to the design and screens speak in names (§13), contrast to WCAG
    AA is checkable per (ink, background, scheme) pair at compile time; unnamed interactive elements,
    heading order, declared tap-target minimums, and raw-values-outside-the-design are ordinary
    validator errors.
  - **Rules that need rendered layout annotate the scenario gallery for human review.** `tao review`
    renders every `scenario` (each is a pinned, buildable state — that is what they are for) into a
    gallery, flagging what it can measure there — text clipping at 200% scale, horizontal overflow —
    on the screenshots. A person accepts or rejects; nothing here is a pass/fail gate in `tao test`.
- **The line between functionality testing and QA is explicit.** `test` journeys assert
  _functionality_ — deterministic, machine-decidable, run headlessly in CI (§16 above). Visual and
  perceptual quality — "does meaning survive without colour", "does this layout read well
  mirrored" — is _QA_: humans reviewing the scenario gallery, with the pseudolocale and RTL
  scenarios as standing review states. The language never encodes a QA judgement as an assertion,
  because a failing "test" no machine can actually evaluate teaches people to ignore red.

---

## 17. Product scope — the demos

The demos are the specification, so what they are is a language decision: a feature exists only if
some demo forces it.

- **The travel app is Wayfare.** ("Wayfair" is a furniture retailer's trademark.)
- **Hearth's tabs**: Today, Week, Lists, People, Around, Settings — with **routines as a feature,
  not a tab**: a list item may repeat, and its occurrences appear in Today and Week. That keeps both
  forcing functions without a seventh tab: **occurrence queries** (durable rows unioned with
  generated recurrences, nothing fake persisted) and **nearness** (a distance preference and
  `order by distance from Here`).
- **Wayfare's tabs**: Trips, Today, Documents, Settings. Documents forces the `files` provider —
  attaching a PDF that stays readable offline — which nothing else does.
- **Recipe editing is write-through.** Each recipe field stands on its own, which is what
  write-through is for; the draft-from-row and conflict path is forced instead by Wayfare's stop
  editing.
- **Nearby places**: `places near Here within 5.km`, with `Here` capitalized like every live handle
  and the radius an account preference.

---

## 18. Settled minor spellings

One-token decisions, recorded once. The rows worth a reason: `Homeware` because `Household` is the
entity and would collide in every bare-name position; `StartedBy Account` because `Cook` is a `Role`
case; `[Role in Owner, Cook]` because `|` is the type-union operator; `Key primary + "n"` because
`cmd` names a platform (§8).

| Concern                | Spelling                                         |
| ---------------------- | ------------------------------------------------ |
| Grocery category type  | `Aisle`                                          |
| Last category case     | `Homeware`                                       |
| Split slot names       | `@list` / `@detail`                              |
| Shortcut literal       | `Key primary + "n"`                              |
| Changed-at stamp       | `(default now, touch on change)`                 |
| Delete retention       | `Deletes tombstones for 30 days`                 |
| File size unit         | `megabytes`                                      |
| Audience filter        | `[Role in Owner, Cook]`                          |
| Timer owner field      | `StartedBy Account`                              |
| Button tap minimum     | `tap min 48`                                     |
| Command palette        | runtime-owned and always present; no declaration |
| Reorder flag           | `Reorderable: yes` (a condition allowed)         |
| Project identity       | `id "skillet"`                                   |
| Desktop target         | `laptop`                                         |
| Scenario device        | `device laptop 1440 x 900`                       |
| Scenario appearance    | `appearance dark`                                |
| Conflict policy        | `Conflicts fieldwise latest`                     |
| Nav / variant bindings | `nav X = …` / `app X = …`                        |

(The source table's `Line` row-pattern and `sizes { }` size-class rows are superseded by §13:
patterns are retired in favour of ordinary content-accepting views, and the size-class block is
`screens { }`.)

---

## Migrations from what ships today

These decisions are made on their own merits: the target is the best possible Tao, internally
consistent and unambiguous, not agreement with what `2 - Next` or `Docs/Spec/` settled earlier. Where a
decision above supersedes a shipped spelling, that is recorded here so the change is deliberate and
the work is visible — not as a contradiction to be litigated.

1. **`type X is one of …` replaces `enum Name { Cases }`.** Next settled the nominal enum
   (`enum ConfirmResult { Confirmed }`) and `Docs/Spec/Tao Type System.md` describes enums as nominal
   types. Collapsing them into the one `type Name is …` head means a case type is declared like every
   other type and its inline form works wherever a type goes.
2. **Postfix `?` replaces leading `optional`.** `Docs/Spec/Tao Type System.md` states "Optional item
   fields use `optional Field Type`" and Next writes `optional PromptSubtitle text`; optionality is
   now `Field Type?`, and every other trait trails in one parenthesized list. One convention holds
   for entity fields, item fields, and parameters alike.
3. **Juxtaposition replaces `Name is Type` in parameter lists.** Next settled `Name is Type`
   (`function DocumentLabel(Title is text)`). Parameters now read exactly as fields do
   (`DocumentLabel(Title text)`), and `is` is reserved for defining a type and for predicates (§2).
4. **`<expr> from <path>` replaces `implement inject provider|nav "./Local.ts"` and every inline
   `ts` fence.** `Docs/Spec/` has a declaration form for filling a primitive and would have gained a
   second for actions; instead reaching TypeScript is an ordinary expression, so `implement`,
   `inject`, and the kind word after it all leave these positions.
5. **Named exports only, in both directions.** `Docs/Spec/Tao Data.md` states that "a sidecar
   default-exports a zero-argument factory". Since `<expr> from <path>` resolves the expression's
   free names against the module, every name crossing the boundary must be a named export — which is
   also what lets one file back several bindings.
6. **Text-or-`#tag` selectors replace role words in test steps.** Next introduced the role-word
   shape (`expect checkbox #markFinal checked`); §16 now selects by visible text or `#tag` only,
   with role and name guarantees enforced by the design's `rules { }` across scenarios instead of
   per step.

---

## Still to be decided

Nothing. Every contested item is resolved. Follow-on work lives in the repository roadmap — notably
the drag-and-drop example app, which will stress-test gesture ownership, drop targets,
cross-container moves, and drop-as-authorized-write against the decisions above, and may send
refinements back through the tranche process.
