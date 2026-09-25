<!--
Every ```tao block carries a directive after the language word — `program`, `edit`, `edit tail`,
`edit after=<kind>`, or `final` — which readers never see and which
`packages/cli/tao-cli/cli-tests/tutorials.test.ts` uses to replay this tutorial step by step. That suite
formats and validates the file after every step, reproduces the finished file from the steps, and
runs its behavior test. Keep the directives correct when editing a snippet; the suite says so when
they are not.
-->

# Your First Tao App

Build a reading list in one Tao file: add books, open one, edit it, mark it finished, and delete
it. About thirty minutes, start to finish.

Every snippet is copy-and-paste. The app grows one step at a time. Nothing is left as an exercise.
The last section is the finished file.

## What you will have built

One file with:

- a **library screen** listing your books, split into _Reading_ and _Finished_
- a **book screen** for editing a title and author, marking it finished, and deleting it
- **tabs** across Library and About
- a **design** of four colors and four named styles, applied everywhere
- a **layout** that puts the two lists side by side on a wide screen and stacks them on a narrow one
- a **behavior test** that drives the whole thing

## Step 1 — the smallest app

```tao program
use StackNav from @tao/nav
use Col, Text from @tao/ui

project {
   id "reading-list"
   name "ReadingList"
   remote none
   license MIT
}

app ReadingList {
   Name "Reading List"
   Navigator LibraryStack
}

nav LibraryStack = StackNav {
   Initial BookList
}

scene BookList() {
   Title "Reading List"
   render Col() {
      Text("Reading List")
}  }
```

Four declarations, and each one has a job:

- **`project`** identifies the project. `id` is the stable identity the toolchain stores data and
  releases under, and it never changes; `name` is the display name, which may. One `project` per
  project.
- **`app`** is what launches. `Navigator` names a navigator root directly; `view` instead names an
  ordinary shell view that may render a navigator.
- **`nav`** is a navigator _value_. `StackNav` pushes and pops screens, and `Initial` is what it
  shows first. Bare `@tao/nav` selects the native kit, so the platform owns its transition and bar.
- **`scene`** is a view intended for presentation. `render` is the tree it draws, and `Title` is
  reactive self-description read by the host that directly presents it. A plain `view` remains the
  reusable inline-content form; every `StackNav` entry here is a scene and supplies a title.

Closing braces gather on one line rather than marching down the page. That is Tao's convention.

The screen is a column with the words **Reading List**.

## Step 2 — layout

The scene's render tree composes ordinary views and containers. Take `Row` and `ScrollView` from
`@tao/ui`:

```tao edit
use Col, Row, ScrollView, Text from @tao/ui
```

Then replace the `scene BookList()` declaration with this:

```tao edit
scene BookList() {
   Title "Reading List"
   render ScrollView() {
      Col() [width max 960, centered, gap 10] {
         Text("Reading List")
         Row() [gap 8] {
            Text("The Dispossessed")
            Text("Ursula K. Le Guin")
}  }  }  }
```

- **`Col`** stacks its children vertically, **`Row`** places them horizontally, and **`ScrollView`**
  scrolls whatever is inside it.
- The bracketed list after a call is its **layout clauses**. They read left to right, and a later
  clause of the same kind wins. `width max 960` bounds a readable column, `centered` puts that
  column in the middle of the space, and `gap 10` spaces the children.

The two names appear side by side.

## Step 3 — design

Raw colors and sizes scattered through a UI are the thing you end up regretting. Tao's answer is a
`design` declaration: its **colors** are names for values, and its **styles** are names for lists of
the same clauses you would otherwise write inline.

Add this declaration after `app`:

```tao edit after=app
design ReadingListDesign {
   // Colors: a name bound to a value; the block says which kind of value every entry is.
   colors {
      paper #fbfaf7
      ink #1b1b1f
      inkMuted #5f6470
      line #e3e0d8
   }

   // Styles: a reusable list of the same clauses a render site can write inline.
   styles {
      screen [fill, content top stretch, pad 16, background paper]
      title [size 28, weight 700, ink ink]
      body [size 16, line 22, ink inkMuted]
      card [pad 12, radius 8, background paper, border line]
   }
}
```

Point the app at it by adding one line to `app ReadingList`:

```tao edit
app ReadingList {
   Name "Reading List"
   Design ReadingListDesign
   Navigator LibraryStack
}
```

Now apply the styles. A style goes in the same brackets as any other clause, and mixes with them:

```tao edit
scene BookList() {
   Title "Reading List"
   render ScrollView() [screen] {
      Col() [width max 960, centered, gap 10] {
         Text("Reading List") [title]
         Row() [card, gap 8] {
            Text("The Dispossessed") [body]
            Text("Ursula K. Le Guin") [body]
}  }  }  }
```

`[card, gap 8]` is the `card` style plus one inline clause — there is no separate syntax for
"styles" and "layout", because a style is only ever the clauses you could have typed yourself.

The screen has a background, a heading, and a bordered card.

## Step 4 — data

Two declarations turn this into a real app: what a book **is**, and where rows are **stored**.

Add the entity after `design`:

```tao edit after=design
data Books / Book {
   Title text
   Author text (default "Unknown")
   Finished yes / Reading no
   AddedAt time (default now)

   order by AddedAt
}
```

Reading it line by line:

- **`Books / Book`** names the collection first and the row second. You query `Books` and you loop
  over it as `Book`.
- **`Title text`** is a field: a name and a type.
- **`(default "Unknown")`** is a trait. Traits are parenthesized and trail the field.
- **`Finished yes / Reading no`** is a two-case field. Its positive case is the field's own name,
  `Finished`; `Reading` is the name for the other side. Without a default, a new row is `Reading`.
- **`AddedAt time (default now)`** — `now` is sampled separately for every row that gets created.
- **`order by AddedAt`** gives the entity a default order, so every query of it comes back sorted.

Then give the app somewhere to keep rows. Add a `Datasource` to `app ReadingList` and import
`Local`:

```tao edit
use Local from @tao/data/providers/local
```

```tao edit
app ReadingList {
   Name "Reading List"
   Design ReadingListDesign
   Navigator LibraryStack
   Datasource Local {
      StorageKey "ReadingListData"
}  }
```

`Local` persists on the device. The `StorageKey` belongs to the configured store, not to the app's
display name, which is what lets two variants of one app keep separate data.

Now read the rows. Take `Spinner` from `@tao/ui`:

```tao edit
use Col, Row, ScrollView, Spinner, Text from @tao/ui
```

And replace `scene BookList()` with this, followed by a new `view BookRow(Book)`:

```tao edit
scene BookList() {
   Title "Reading List"
   query Books { }
   render ScrollView() [screen] {
      Col() [width max 960, centered, gap 10] {
         Text("Reading List") [title]
         guard Books {
            loading -> { Spinner() }
            error -> Message { Text("Could not load your books: { Message }") [body] }
         }
         guard Books empty -> { Text("No books yet") [body] }

         #books
         loop Books / Book {
            BookRow(Book)
}  }  }  }

view BookRow(Book) {
   render Row() [card, gap 8] {
      Text(Book.Title) [body]
      Text(Book.Author) [body]
}  }
```

Four new ideas:

- **`query Books { }`** is a reactive list. Declare it before you use it; when rows change, the
  screen re-renders.
- **`guard`** handles a value's exceptional states. If a case matches, it renders and the rest of
  the enclosing block does not — so the lines after it can assume the data is there. `error ->
  Message` binds the message for that branch only.
- **`guard Books empty -> { … }`** is the same construct with a single case.
- **`loop Books / Book { … }`** repeats its body per row, binding each row to `Book`. `#books` above
  it is a **tag**: a name for tests to select, invisible to the person using the app.

`{ Message }` inside a string is interpolation — any expression goes between the braces.

`view BookRow(Book)` is reusable inline content. The presented `BookList` scene and this row share
the same view body grammar; `scene` adds only host-facing chrome and the rule that it is presented,
never composed. The parameter `Book` takes its type from its name.

The list is empty, which is progress — nothing can create a book yet.

## Step 5 — creating rows

Take `FormButton` and `TextInput` from `@tao/ui`:

```tao edit
use Col, FormButton, Row, ScrollView, Spinner, Text, TextInput from @tao/ui
```

Then replace `scene BookList()` with the version below — `view BookRow(Book)` underneath it does not
change:

```tao edit
scene BookList() {
   Title "Reading List"
   state NewTitle = ""
   query Books { }
   action AddBook() {
      check NewTitle is not empty
      create Book {
         Title: NewTitle
      }
      set NewTitle = ""
   }
   render ScrollView() [screen] {
      Col() [width max 960, centered, gap 10] {
         Text("Reading List") [title]
         guard Books {
            loading -> { Spinner() }
            error -> Message { Text("Could not load your books: { Message }") [body] }
         }

         #newTitle
         TextInput(Value: NewTitle, Label: "Book title", Placeholder: "Add a book") {
            on submit AddBook
         }

         #addBook
         FormButton("Add book", Disabled: NewTitle is empty) {
            on press AddBook
         }
         guard Books empty -> { Text("No books yet") [body] }

         #books
         loop Books / Book {
            BookRow(Book)
}  }  }  }
```

- **`state NewTitle = ""`** is view-local and reactive. `TextInput(Value: NewTitle, …)` binds to it
  in both directions, so typing updates it with no handler of your own.
- **`action AddBook()`** groups what happens on an event. `on press AddBook` and `on submit AddBook`
  both run it, so Enter in the field and the button do the same thing.
- **`check NewTitle is not empty`** is the action's early exit: if the title is empty, the action
  stops there and nothing is created. (`guard`, below, is the view-side construct.)
- **`create Book { Title: NewTitle }`** writes a row. `Author`, `Finished`, and `AddedAt` all have
  defaults, so naming `Title` is enough.
- **`Disabled: NewTitle is empty`** — `is empty` tests text, lists, and queries.

Type a title and press **Add book**. The row appears, and it survives a reload because `Local`
persisted it.

## Step 6 — a second screen

A row you can only look at is not much use. Make the rows selectable, and give them somewhere to go.

Replace the loop at the end of `scene BookList()` — everything from `#books` down — with this:

```tao edit tail
         #books
         loop Books / Book {
            BookRow(Book)
            on select -> { present BookScreen(Book) }
}  }  }  }
```

`on select` makes each row pressable, scoped to that row — so `Book` in the handler is the row you
touched. **`present`** puts a view on screen; because the app's navigator is a `StackNav`, it pushes,
and Back pops it. The native bar reads `Title Book.Title` from that directly presented occurrence;
if the saved title changes, the bar changes with it.

Now the screen itself. Take `Checkbox` from `@tao/ui`:

```tao edit
use Checkbox, Col, FormButton, Row, ScrollView, Spinner, Text, TextInput from @tao/ui
```

And add this declaration at the end:

```tao edit
scene BookScreen(Book) {
   Title Book.Title
   state TitleDraft = Book.Title
   state AuthorDraft = Book.Author
   action Save() {
      check TitleDraft is not empty
      update Book {
         Title: TitleDraft
         Author: AuthorDraft
   }  }
   action SetFinished(Value boolean) {
      update Book {
         Finished: Value
   }  }
   action Remove() {
      delete Book
      dismiss
   }
   render ScrollView() [screen] {
      Col() [width max 720, centered, gap 10] {
         guard Book {
            loading -> { Spinner() }
            missing -> { Text("That book is gone.") [body] }
            error -> Message { Text("Could not load that book: { Message }") [body] }
         }
         Text(Book.Title) [title]

         #title
         TextInput(Value: TitleDraft, Label: "Title", Placeholder: "Title") {
            on submit Save
         }

         #author
         TextInput(Value: AuthorDraft, Label: "Author", Placeholder: "Author") {
            on submit Save
         }

         #finished
         Checkbox(Value: Book.Finished is Finished, Label: "Finished") {
            on change SetFinished
         }

         #save
         FormButton("Save", Disabled: TitleDraft is empty) {
            on press Save
         }

         #remove
         FormButton("Remove") {
            on press Remove
}  }  }  }
```

That completes CRUD:

- **`update Book { … }`** writes named fields on a live row.
- **`delete Book`** removes it, and **`dismiss`** closes this screen — without it you would be
  looking at a screen for a row that no longer exists.
- **`guard Book { … }`** guards a single row rather than a list. `missing` is the case for a row
  that has been deleted out from under the screen, which is exactly what the guard is for.
- **`Book.Finished is Finished`** reads the two-case field as a yes/no for the checkbox, and
  `on change SetFinished` hands the new value to an action that writes it back.

The drafts are worth a second look. `TitleDraft` starts from `Book.Title` and only reaches the store
when `Save` runs, so typing does not write on every keystroke.

Add a book, tap the row, edit it, tick **Finished**, and press **Remove**.

## Step 7 — tabs

One screen is a stack. Several areas are a selection. Take `SelectionNav` from `@tao/nav`:

```tao edit
use SelectionNav, StackNav from @tao/nav
```

Replace the `nav LibraryStack` declaration with these two:

```tao edit
nav LibraryStack = StackNav {
   Initial BookList
}

nav ReadingListNavigator = SelectionNav {
   Initial @library
   Display "automatic"
   @library {
      Label "Library"
      Icon "books.vertical"
      Content LibraryStack
   }
   @about {
      Label "About"
      Icon "info.circle"
      Content About
}  }
```

And point the app at the new one:

```tao edit
app ReadingList {
   Name "Reading List"
   Design ReadingListDesign
   Navigator ReadingListNavigator
   Datasource Local {
      StorageKey "ReadingListData"
}  }
```

And a screen for the second tab, at the end of the file:

```tao edit
scene About() {
   Title "About"
   render Col() [screen, gap 10] {
      Text("About") [title]
      Text("A small reading list, written in Tao.") [body]
}  }
```

- **`SelectionNav`** shows one of several keyed areas at a time. `@library` and `@about` are its
  keys, and each names a `Label`, an `Icon`, and its `Content`.
- **`Content LibraryStack`** nests the stack inside the tab, so pushing a book screen keeps the tabs
  and Back still works.
- **`Display "automatic"`** lets the runtime choose the shape — a tab bar on a phone, a sidebar on a
  wide screen. You do not write that rule; you say what the areas are.

Same declaration, two shapes.

## Step 8 — one layout for phone and desktop

The library still shows one list. Split it into _Reading_ and _Finished_, side by side when there is
room and stacked when there is not.

Take `Panes` from `@tao/ui`:

```tao edit
use Checkbox, Col, FormButton, Panes, Row, ScrollView, Spinner, Text, TextInput from @tao/ui
```

Then replace `scene BookList()` one last time. Two more queries join the first, and the single loop
becomes a `Panes` with one column each:

```tao edit
scene BookList() {
   Title "Reading List"
   state NewTitle = ""
   query Books { }
   query Books as CurrentlyReading {
      where is Reading
   }
   query Books as FinishedBooks {
      where is Finished
   }
   action AddBook() {
      check NewTitle is not empty
      create Book {
         Title: NewTitle
      }
      set NewTitle = ""
   }
   render ScrollView() [screen] {
      Col() [width max 960, centered, gap 10] {
         Text("Reading List") [title]
         guard Books {
            loading -> { Spinner() }
            error -> Message { Text("Could not load your books: { Message }") [body] }
         }

         #newTitle
         TextInput(Value: NewTitle, Label: "Book title", Placeholder: "Add a book") {
            on submit AddBook
         }

         #addBook
         FormButton("Add book", Disabled: NewTitle is empty) {
            on press AddBook
         }
         Panes() [gap 16] {
            Col() [gap 6] {
               Text("Reading: { CurrentlyReading.Count }") [title]
               guard CurrentlyReading empty -> { Text("Nothing on the go") [body] }

               #reading
               loop CurrentlyReading / Book {
                  BookRow(Book)
                  on select -> { present BookScreen(Book) }
            }  }
            Col() [gap 6] {
               Text("Finished: { FinishedBooks.Count }") [title]
               guard FinishedBooks empty -> { Text("Nothing finished yet") [body] }

               #finished
               loop FinishedBooks / Book {
                  BookRow(Book)
                  on select -> { present BookScreen(Book) }
}  }  }  }  }  }
```

`Books as CurrentlyReading` renames the source so one screen can hold several views of it, and
`where is Reading` filters by the case name the entity declared. The `guard Books empty` branch is
gone: each column now says for itself when it has nothing in it.

**`Panes`** is the whole adaptive story: it lays its children out side by side when each of them can
have at least 320 logical pixels after gaps, and stacks them in source order when they cannot. There
is no breakpoint syntax and no per-platform branch — the same declaration is a two-column desktop
layout and a stacked phone layout.

`.Count` works on any query or list.

Narrow the window until the two columns become one.

## Step 9 — a test that drives the whole app

Tao tests are journeys: they act on rendered controls the way a person would, and assert what is on
screen. Add this at the end of the same file:

```tao edit
test "Reading List" {
   test "adds a book, opens it, finishes it, and removes it" {
      run ReadingList
      expect navigation title "Reading List"
      expect text "Nothing on the go"
      enter "The Dispossessed" into #newTitle
      press #addBook
      expect {
         text "Reading: 1"
         text "The Dispossessed"
      }
      select #reading[1] {
         press "The Dispossessed"
      }
      expect navigation title "The Dispossessed"
      enter "Ursula K. Le Guin" into #author
      press #save
      expect checkbox #finished unchecked
      press #finished
      back
      expect {
         text "Reading: 0"
         text "Finished: 1"
      }
      select #finished[1] {
         press "The Dispossessed"
      }
      press #remove
      expect {
         text "Nothing on the go"
         text "Nothing finished yet"
}  }  }
```

- **`test "…"`** declares a journey, and journeys nest — the outer one groups, the inner one runs.
- **`run ReadingList`** launches the app. Every journey gets a fresh store and a fresh clock, so
  they never leak into each other.
- Steps select by **visible text** or by **`#tag`**. `press "The Dispossessed"` is what a person
  reads; `press #addBook` reaches what visible text cannot identify.
- **`select #reading[1] { … }`** scopes the steps inside it to the first tagged row.
- **`back`** is the same operation as the platform's Back.
- **`expect { … }`** groups assertions that must all hold at that moment.

## The complete app

```tao final
use Local from @tao/data/providers/local
use SelectionNav, StackNav from @tao/nav
use Checkbox, Col, FormButton, Panes, Row, ScrollView, Spinner, Text, TextInput from @tao/ui

project {
   id "reading-list"
   name "ReadingList"
   remote none
   license MIT
}

app ReadingList {
   Name "Reading List"
   Design ReadingListDesign
   Navigator ReadingListNavigator
   Datasource Local {
      StorageKey "ReadingListData"
}  }

design ReadingListDesign {
   // Colors: a name bound to a value; the block says which kind of value every entry is.
   colors {
      paper #fbfaf7
      ink #1b1b1f
      inkMuted #5f6470
      line #e3e0d8
   }

   // Styles: a reusable list of the same clauses a render site can write inline.
   styles {
      screen [fill, content top stretch, pad 16, background paper]
      title [size 28, weight 700, ink ink]
      body [size 16, line 22, ink inkMuted]
      card [pad 12, radius 8, background paper, border line]
   }
}

data Books / Book {
   Title text
   Author text (default "Unknown")
   Finished yes / Reading no
   AddedAt time (default now)

   order by AddedAt
}

nav LibraryStack = StackNav {
   Initial BookList
}

nav ReadingListNavigator = SelectionNav {
   Initial @library
   Display "automatic"
   @library {
      Label "Library"
      Icon "books.vertical"
      Content LibraryStack
   }
   @about {
      Label "About"
      Icon "info.circle"
      Content About
}  }

scene BookList() {
   Title "Reading List"
   state NewTitle = ""
   query Books { }
   query Books as CurrentlyReading {
      where is Reading
   }
   query Books as FinishedBooks {
      where is Finished
   }
   action AddBook() {
      check NewTitle is not empty
      create Book {
         Title: NewTitle
      }
      set NewTitle = ""
   }
   render ScrollView() [screen] {
      Col() [width max 960, centered, gap 10] {
         Text("Reading List") [title]
         guard Books {
            loading -> { Spinner() }
            error -> Message { Text("Could not load your books: { Message }") [body] }
         }

         #newTitle
         TextInput(Value: NewTitle, Label: "Book title", Placeholder: "Add a book") {
            on submit AddBook
         }

         #addBook
         FormButton("Add book", Disabled: NewTitle is empty) {
            on press AddBook
         }
         Panes() [gap 16] {
            Col() [gap 6] {
               Text("Reading: { CurrentlyReading.Count }") [title]
               guard CurrentlyReading empty -> { Text("Nothing on the go") [body] }

               #reading
               loop CurrentlyReading / Book {
                  BookRow(Book)
                  on select -> { present BookScreen(Book) }
            }  }
            Col() [gap 6] {
               Text("Finished: { FinishedBooks.Count }") [title]
               guard FinishedBooks empty -> { Text("Nothing finished yet") [body] }

               #finished
               loop FinishedBooks / Book {
                  BookRow(Book)
                  on select -> { present BookScreen(Book) }
}  }  }  }  }  }

view BookRow(Book) {
   render Row() [card, gap 8] {
      Text(Book.Title) [body]
      Text(Book.Author) [body]
}  }

scene BookScreen(Book) {
   Title Book.Title
   state TitleDraft = Book.Title
   state AuthorDraft = Book.Author
   action Save() {
      check TitleDraft is not empty
      update Book {
         Title: TitleDraft
         Author: AuthorDraft
   }  }
   action SetFinished(Value boolean) {
      update Book {
         Finished: Value
   }  }
   action Remove() {
      delete Book
      dismiss
   }
   render ScrollView() [screen] {
      Col() [width max 720, centered, gap 10] {
         guard Book {
            loading -> { Spinner() }
            missing -> { Text("That book is gone.") [body] }
            error -> Message { Text("Could not load that book: { Message }") [body] }
         }
         Text(Book.Title) [title]

         #title
         TextInput(Value: TitleDraft, Label: "Title", Placeholder: "Title") {
            on submit Save
         }

         #author
         TextInput(Value: AuthorDraft, Label: "Author", Placeholder: "Author") {
            on submit Save
         }

         #finished
         Checkbox(Value: Book.Finished is Finished, Label: "Finished") {
            on change SetFinished
         }

         #save
         FormButton("Save", Disabled: TitleDraft is empty) {
            on press Save
         }

         #remove
         FormButton("Remove") {
            on press Remove
}  }  }  }

scene About() {
   Title "About"
   render Col() [screen, gap 10] {
      Text("About") [title]
      Text("A small reading list, written in Tao.") [body]
}  }

test "Reading List" {
   test "adds a book, opens it, finishes it, and removes it" {
      run ReadingList
      expect navigation title "Reading List"
      expect text "Nothing on the go"
      enter "The Dispossessed" into #newTitle
      press #addBook
      expect {
         text "Reading: 1"
         text "The Dispossessed"
      }
      select #reading[1] {
         press "The Dispossessed"
      }
      expect navigation title "The Dispossessed"
      enter "Ursula K. Le Guin" into #author
      press #save
      expect checkbox #finished unchecked
      press #finished
      back
      expect {
         text "Reading: 0"
         text "Finished: 1"
      }
      select #finished[1] {
         press "The Dispossessed"
      }
      press #remove
      expect {
         text "Nothing on the go"
         text "Nothing finished yet"
}  }  }
```
