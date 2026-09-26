import { Describe, Test } from '@shared/test'
import { parses, rejectsParser } from './test-parse'

// The decided dialect (Docs/Roadmap/Tao Revolution/Decisions.md §2, §8, §15, §16). Each test guards a
// spelling the dialect migration tranche introduced, including the traps the spike surfaced.
Describe('parser: decided dialect', () => {
  Test(
    'juxtaposed parameter types beside bare inferred names and defaults',
    parses(`
      type Tone is one of Neutral, Good
      action FetchRecipe(Link text) { }
      view Status(Message text, Tone Tone default Neutral) { }
      view Card(Recipe) { }
      view Both(Recipe, Message text) { }
    `),
  )

  Test(
    'postfix ? optionality on parameters, including an action-typed one',
    parses(`
      view CookScreen(Recipe, Meal?) { }
      view Card(Recipe, Press action?) { }
    `),
  )

  Test(
    'postfix ? optionality on item fields',
    parses(`
      type Prompt is {
        Title text,
        Subtitle text?,
      }
    `),
  )

  Test(
    'the closed trait list on data fields',
    parses(`
      type Course is one of Breakfast, Lunch, Dinner
      data Recipes / Recipe {
        Title text (required "Name this recipe", unique, search, title),
        Servings number (default 4),
        ChangedAt time (default now, touch on change),
        Course (default Dinner),
        Ingredients (owned, ordered),
        Photo text?,
        order by ChangedAt
      }
    `),
  )

  Test(
    'inline item return type immediately before a body brace',
    parses(`
      function Fetch(Link text) returns { Foo text, Bar text } {
        return Link
      }
    `),
  )

  Test(
    'unit accessors on numbers beside decimal literals',
    parses(`
      let Wait = 220.ms
      let Ratio = 1.5
      let Precise = 1.5.s
      let Back = Wait.s
    `),
  )

  Test(
    'one of and yes / Alias no as type expressions',
    parses(`
      type Course is one of Breakfast, Lunch, Dinner
      type Unit is one of "g", "kg"
      type Testing is yes / Production no
      type Plain is yes / no
    `),
  )

  Test(
    'yes / Alias no on data fields, with the alias an ordinary identifier',
    parses(`
      data Documents / Document {
        Final yes / Draft no,
        Public yes / Private no (default Public),
        Pinned yes / no,
        Name text
      }
    `),
  )

  Test(
    'a primitive implementation is a named import',
    parses(`
      public type Local is datasource with {
        StorageKey text
        provider LocalProvider from ./Local.ts
      }
    `),
  )

  Test(
    'tests nest and select by visible text or tag',
    parses(`
      test "workspaces" {
        test "creating one names it" {
          press "New workspace"
          enter "Novel" into #workspaceName
          submit #workspaceName
          expect text "Novel"
        }
        test "opening one shows its documents" {
          press "Novel"
          expect text "Untitled"
        }
      }
    `),
  )

  Test(
    'a typed relation names a target the field name does not',
    parses(`
      data Accounts / Account { Name text }
      data Members / Member {
        Household,
        Person Accounts
      }
      data Households / Household {
        Seats Members (owned)
      }
    `),
  )

  // Naming the app is an assertion, not the address, so both statements read without one.
  Test(
    'ambient navigation targets the enclosing app',
    parses(`
      view Panel() { }
      let Fallback = "stand-in for a nav value"
      view Home() {
        render Panel() {
          on press -> { present @workspace }
          on change -> { replace Fallback in app }
          on submit -> { replace Fallback }
        }
      }
    `),
  )

  Test(
    'the retired enum head no longer parses',
    rejectsParser('enum ConfirmResult { Confirmed, Cancelled }'),
  )

  Test(
    'the case set that replaced it does parse',
    parses('type ConfirmResult is one of Confirmed, Cancelled'),
  )
})
