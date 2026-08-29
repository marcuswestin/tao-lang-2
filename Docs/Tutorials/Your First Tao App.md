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

```tao
use StackNav from @tao/nav
use Col, Text from @tao/ui

project {
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

ui BookList() {
   render Col() {
      Text("Reading List")
}  }
```

Four declarations, and each one has a job:

- **`project`** names the project. One per project.
- **`app`** is what launches. It mounts a navigator; an app never renders content itself.
- **`nav`** is a navigator _value_. `StackNav` pushes and pops screens, and `Initial` is what it
  shows first.
- **`ui`** is content a navigator can present. `render` is the tree it draws.

Closing braces gather on one line rather than marching down the page. That is Tao's convention.

The screen is a column with the words **Reading List**.

## Step 2 — layout

Views compose out of a few containers. Replace the `ui BookList()` declaration with this, and add
`Row` and `ScrollView` to the `@tao/ui` use line:

```tao
use Col, Row, ScrollView, Text from @tao/ui
```

```tao
ui BookList() {
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
`design` declaration: **tokens** are names for values, and **bundles** are names for lists of the
same clauses you would otherwise write inline.

Add this declaration after `app`:

```tao
design ReadingListDesign {
   // Flat tokens: a name bound to a value.
   paper #fbfaf7
   ink #1b1b1f
   inkMuted #5f6470
   line #e3e0d8

   // Named bundles: a reusable list of the same clauses a render site can write inline.
   screen [fill, content top stretch, pad 16, bg paper]
   title [size 28, weight 700, fg ink]
   body [size 16, line 22, fg inkMuted]
   card [pad 12, radius 8, bg paper, border line]
}
```

Point the app at it by adding one line to `app ReadingList`:

```tao
app ReadingList {
   Name "Reading List"
   Design ReadingListDesign
   Navigator LibraryStack
}
```

Now apply the bundles. A bundle goes in the same brackets as any other clause, and mixes with them:

```tao
ui BookList() {
   render ScrollView() [screen] {
      Col() [width max 960, centered, gap 10] {
         Text("Reading List") [title]
         Row() [card, gap 8] {
            Text("The Dispossessed") [body]
            Text("Ursula K. Le Guin") [body]
}  }  }  }
```

`[card, gap 8]` is the `card` bundle plus one inline clause — there is no separate syntax for
"styles" and "layout", because a bundle is only ever the clauses you could have typed yourself.

The screen has a background, a heading, and a bordered card.

## Step 4 — data

Two declarations turn this into a real app: what a book **is**, and where rows are **stored**.

Add the entity after `design`:

```tao
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

```tao
use Local from @tao/data
```

```tao
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

Now read the rows. Replace `ui BookList()` with:

```tao
ui BookList() {
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

Add `Spinner` to the `@tao/ui` use line. Four new ideas:

- **`query Books { }`** is a reactive list. Declare it before you use it; when rows change, the
  screen re-renders.
- **`guard`** handles a value's exceptional states. If a case matches, it renders and the rest of
  the enclosing block does not — so the lines after it can assume the data is there. `error ->
  Message` binds the message for that branch only.
- **`guard Books empty -> { … }`** is the same construct with a single case.
- **`loop Books / Book { … }`** repeats its body per row, binding each row to `Book`. `#books` above
  it is a **tag**: a name for tests to select, invisible to the person using the app.

`{ Message }` inside a string is interpolation — any expression goes between the braces.

`view BookRow(Book)` is a second kind of declaration. A **`view`** is embeddable content; a **`ui`**
is content a navigator can present. The parameter `Book` takes its type from its name.

The list is empty, which is progress — nothing can create a book yet.

## Step 5 — creating rows

Add `FormButton` and `TextInput` to the `@tao/ui` use line, then replace `ui BookList()` with the
version below — `view BookRow(Book)` underneath it does not change:

```tao
ui BookList() {
   state NewTitle = ""
   query Books { }
   action AddBook() {
      guard NewTitle empty
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
- **`guard NewTitle empty`** with no branch body is an early exit: if the title is empty, the action
  stops there.
- **`create Book { Title: NewTitle }`** writes a row. `Author`, `Finished`, and `AddedAt` all have
  defaults, so naming `Title` is enough.
- **`Disabled: NewTitle is empty`** — `is empty` tests text, lists, and queries.

Type a title and press **Add book**. The row appears, and it survives a reload because `Local`
persisted it.

## Step 6 — a second screen

A row you can only look at is not much use. Make the rows selectable, and give them somewhere to go.

Add `on select` inside the loop:

```tao
         #books
         loop Books / Book {
            BookRow(Book)
            on select -> { present BookScreen(Book) }
}  }  }  }
```

`on select` makes each row pressable, scoped to that row — so `Book` in the handler is the row you
touched. **`present`** puts a `ui` on screen; because the app's navigator is a `StackNav`, it pushes,
and Back pops it.

Now the screen itself. Add `Checkbox` to the `@tao/ui` use line and add this declaration at the end:

```tao
ui BookScreen(Book) {
   state TitleDraft = Book.Title
   state AuthorDraft = Book.Author
   action Save() {
      guard TitleDraft empty
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

One screen is a stack. Several areas are a selection. Replace the `nav LibraryStack` declaration
with these two, add `SelectionNav` to the `@tao/nav` use line, and point the app at the new one:

```tao
use SelectionNav, StackNav from @tao/nav
```

```tao
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

```tao
app ReadingList {
   Name "Reading List"
   Design ReadingListDesign
   Navigator ReadingListNavigator
   Datasource Local {
      StorageKey "ReadingListData"
}  }
```

And a screen for the second tab, at the end of the file:

```tao
ui About() {
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

Add two more queries beside the first, and add `Panes` to the `@tao/ui` use line:

```tao
query Books { }
query Books as CurrentlyReading {
   where is Reading
}
query Books as FinishedBooks {
   where is Finished
}
```

`Books as CurrentlyReading` renames the source so one screen can hold several views of it, and
`where is Reading` filters by the case name the entity declared. Replace everything from
`guard Books empty` to the end of the render block with:

```tao
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

**`Panes`** is the whole adaptive story: it lays its children out side by side when each of them can
have at least 320 logical pixels after gaps, and stacks them in source order when they cannot. There
is no breakpoint syntax and no per-platform branch — the same declaration is a two-column desktop
layout and a stacked phone layout.

`.Count` works on any query or list.

Narrow the window until the two columns become one.

## Step 9 — a test that drives the whole app

Tao tests are journeys: they act on rendered controls the way a person would, and assert what is on
screen. Add this at the end of the same file:

```tao
test "Reading List" {
   test "adds a book, opens it, finishes it, and removes it" {
      run ReadingList

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

```tao
use Local from @tao/data
use SelectionNav, StackNav from @tao/nav
use Checkbox, Col, FormButton, Panes, Row, ScrollView, Spinner, Text, TextInput from @tao/ui

project {
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
   // Flat tokens: a name bound to a value.
   paper #fbfaf7
   ink #1b1b1f
   inkMuted #5f6470
   line #e3e0d8

   // Named bundles: a reusable list of the same clauses a render site can write inline.
   screen [fill, content top stretch, pad 16, bg paper]
   title [size 28, weight 700, fg ink]
   body [size 16, line 22, fg inkMuted]
   card [pad 12, radius 8, bg paper, border line]
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

ui BookList() {
   state NewTitle = ""
   query Books { }
   query Books as CurrentlyReading {
      where is Reading
   }
   query Books as FinishedBooks {
      where is Finished
   }
   action AddBook() {
      guard NewTitle empty
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

ui BookScreen(Book) {
   state TitleDraft = Book.Title
   state AuthorDraft = Book.Author
   action Save() {
      guard TitleDraft empty
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

ui About() {
   render Col() [screen, gap 10] {
      Text("About") [title]
      Text("A small reading list, written in Tao.") [body]
}  }

test "Reading List" {
   test "adds a book, opens it, finishes it, and removes it" {
      run ReadingList

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
