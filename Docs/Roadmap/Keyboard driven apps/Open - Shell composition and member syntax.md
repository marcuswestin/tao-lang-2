# Resolved — shell composition and member syntax

Two design questions raised by Ro after T1/T2 landed (2026-09-02), both concerning decisions the
tranche had already implemented. **Both were resolved the same day in favour of the recommendations
below and implemented as the "revised" tranche** (`7ac87001` makes the shell a view and retires the
frame; `27f6884b` moves a command's slots into a parameter list). The reasoning stays here as the
record; `Decisions.md` §8 and §10 carry the decisions.

**Everything below is historical comparison, including every grammar and Tao code block.** It
describes the superseded `FrameNav`, app `Navigator`, edge-slot, module-query, and block-slot command
alternatives so the review can be audited; none is current syntax or architecture. KEY-D7 and
KEY-D10 are the current contract.

## 1. Does the frame need to be a nav kind at all?

**What `FrameNav` actually buys.** Not layering or scroll behaviour — a `Col` holding a fixed bar
above a scrolling child is ordinary layout and always was. The single reason the kind exists is
that **a render tree cannot name a nav**:

```langium
RenderStatement:
    'render' (injection=Injection layoutClause=LayoutClause?
        | view=[ViewDeclaration:ID] '(' argumentList=ArgumentList? ')' layoutClause=LayoutClause? block=Block?);
```

The cross-reference is to `ViewDeclaration`, and `nav X = …` is a `NavDeclaration`, so
`Col() { WordFlowerNavigator() FocusBar() }` does not resolve. The app root is a nav
(`Navigator nav`), so no author-owned render tree sits above it.

**But an app can already be rooted in a view.** `AppView: 'view' view=[ViewDeclaration:ID]`, and
`Apps/Test Apps/Navigation/Root View App.tao` exercises it: Tao synthesizes the navigator. So the
only missing capability is rendering a nav as a child of a view:

```tao
app WordFlower {
   Name "WordFlower"
   view WordFlowerShell
}

scene WordFlowerShell() {
   query FocusSessions as CurrentSession { limit 1 }
   render Col() [fill] {
      WordFlowerNavigator()          // the one capability that does not exist today
      when CurrentSession {
         empty -> { }
         otherwise -> { FocusBar() }
      }
   }
}
```

That is ordinary layout. It needs no fifth nav kind, no keyed slots, no `Size`, no per-slot
restoration profile, no conformance branch, and no keyed patch merging — all of which T1 built.
The empty-slot rule becomes an ordinary `when` in a render tree, a construct the language already
has and already tests.

**The cost, from the design record.** `Design - Keyboard driven apps.md` assessed nav-as-render-child
and found seven invariants that navs get free by being host-mounted roots. Re-read after building
the frame:

| # | Hazard                                                     | Assessment now                                                                                                                                                         |
| - | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | Identity: a render child could mount twice or per loop row | One validator rule: a nav renders at most once, never inside a loop                                                                                                    |
| 2 | A conditional render drops nav history                     | One validator rule: a nav's render is unconditional. Does not constrain the forcing feature — the conditional thing is the bar, a view; the navigator is unconditional |
| 3 | `present … as root` must be redefined                      | One §10 amendment                                                                                                                                                      |
| 4 | Back precedence among mounted navs                         | By region focus, falling back to app order. The design record itself calls this "arguably an improvement", and it is what T4's attention reducer computes anyway       |
| 5 | Restoration timing for view-mounted navs                   | "Restore when mounted"                                                                                                                                                 |
| 6 | Native safe areas under a docked bar                       | **Bites either way.** The frame deferred per-edge insets too                                                                                                           |
| 7 | The app composition root is a less complete one-page map   | Readability, not correctness                                                                                                                                           |

Ro judged constrained-(b) too costly at the time. That judgement was made before the frame existed;
the frame turned out to cost more than these rules would have.

**What retiring the frame would also retire.** Module-level `query` was introduced _only_ because
the frame is configuration and configuration has no view to hold a query. If the shell is a view, a
view-body query serves, and module-level `query` loses its forcing feature — it would have to be
justified separately or retired. The same applies to three smaller pieces added to make
configuration reactive: `TR.Deferred`, absence-unification in `Type.commonType`, and union-to-union
assignability. The last two are general improvements worth keeping regardless; the first exists
only for configured members.

**Also settled by Ro in this exchange:** the `@name` sigil belongs to named _render_ slots — content
a caller passes into a view that lays it out and owns the interaction — and the frame's edges are
not that. Whatever shape the shell takes, it should not spell its edges `@top` / `@bottom`.

## 2. Juxtaposition means two things, and one block does both

Tao declares a named-and-typed member by juxtaposition (`Title text`) and binds a value to a name
two different ways: `:` in literals, writes and arguments (`Title: "x"`), and juxtaposition in
configuration entries, command members and declaration-slot fills (`Label "Focus session"`).

`Decisions.md` §2 says "`:` binds a value to a name … at call sites and in literals, **and nowhere
else**", and "juxtaposition declares a typed slot". Both sentences are now false.

The rule that actually holds: **in a type body juxtaposition declares; in a value body it binds.**
That is unambiguous for a reader — until one block does both. The command block is the only such
block in the language:

```tao
command Finish {
   Document                    // declares a slot
   Title "Finish document"     // binds a member
   do -> { update Document { Final } }
}
```

which is why `Track Document` (a renamed typed slot) is undecidable there, and why the grammar had
to exclude bare-name member values — `Enabled CanSave` is invalid, and an author must write
`Enabled: CanSave`.

Three ways out, in increasing cost:

1. **Amend §2** to state the type-body/value-body rule and name the command block as the one place
   both meanings meet, with `:` as the explicit binder there.
2. **Make command members colon-only** (`Title: "Finish document"`). Restores §2 exactly and makes
   `Track Document` decidable, at the cost of respelling every member fill in the language,
   `scene` chrome slots included.
3. **Separate the halves syntactically** — slots in a parameter list, members in the body:
   `command Finish(Document) { Title "Finish document" … }`. Reads like every other parameterized
   declaration and the ambiguity disappears, because slots leave the block entirely.

### On requiring a trailing comma

Ro proposed requiring a comma after every tuple in a list, to collapse this class of problem.
Findings:

- **The case named — an argument list followed by a render block — is already unambiguous**, and
  this was verified empirically. `ArgumentList` already requires commas
  (`arguments+=Argument (',' arguments+=Argument)*`), an `Argument` is `(label=ID ':')? value` with
  no juxtaposition, and the parentheses delimit the list. An item-literal argument and a render
  block coexist today:

```tao
render Box(Item: Prompt { Title: "one", Minutes: 2 }) {
   @actions Leaf("go")
}
```

- **A comma marks where an entry ends, not what its parts mean.** It therefore does not recover
  `Track Document`: `Track Document,` is still both "a slot named Track of type Document" and "the
  member Track bound to the value Document". Required commas fix boundary ambiguity, and the
  remaining ambiguity in Tao is not a boundary ambiguity.

- **Most blocks are already safe for a different reason:** item literals, data writes and arguments
  use `label:` rather than juxtaposition, and entity fields draw their type from a closed set
  (`text | number | boolean | time`), so a bare name cannot be read as a type there.

So required commas would buy consistency and safety against a future two-part member, but would not
by themselves let `Track Document` back in, and are not needed for the case that prompted them.
