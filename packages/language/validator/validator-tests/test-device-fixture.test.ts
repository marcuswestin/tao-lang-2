import { Describe, Test } from '@shared/test'
import { testValidationMessages } from '../validator-src/validators/tests-validator'
import { accepts, app, fence, rejects, stubView, tsFence } from './test-validate'

const render = `render inject ${tsFence} return null ${fence}`

const withFixture = `
  data Households / Household { Name text }
  fixture StarterWorkspace {
    Home = create Household { Name: "Home" }
  }
`

Describe('validator: test device and fixture clauses', () => {
  Test(
    'accepts `on` and `with` on a test, inherited by a nested test that repeats neither',
    accepts(app(
      render,
      `
      ${withFixture}
      test "WordFlower" on phone with StarterWorkspace {
        test "opens the starter workspace" {
          run MyApp
        }
        test "on a tablet" on tablet {
          run MyApp
        }
      }
    `,
    )),
  )

  Test(
    'rejects a duplicate `on` clause on one test',
    rejects(
      app(render, 'test "WordFlower" on phone on tablet { test "opens" { run MyApp } }'),
      testValidationMessages.duplicateHeadClause('WordFlower', 'on'),
    ),
  )

  Test(
    'rejects a duplicate `with` clause on one test',
    rejects(
      app(
        render,
        `
        ${withFixture}
        fixture OtherWorkspace { }
        test "WordFlower" with StarterWorkspace with OtherWorkspace {
          test "opens" { run MyApp }
        }
      `,
      ),
      testValidationMessages.duplicateHeadClause('WordFlower', 'with'),
    ),
  )

  Test(
    'rejects non-positive-integer device dimensions',
    rejects(
      app(render, 'test "WordFlower" on tablet 0 x 100 { test "opens" { run MyApp } }'),
      testValidationMessages.deviceDimensions,
    ),
  )

  Test(
    'rejects a fixture whose entity the running app does not bind',
    rejects(
      `
        use Local from @tao/data/providers/local
        use Memory from @tao/data/providers/memory
        use StackNav from @tao/nav
        ${stubView('Main')}
        data Stories / Story { Title text }
        data Bookmarks / Bookmark { Note text }
        fixture Notes {
          Draft = create Bookmark { Note: "Draft" }
        }
        datasource Feed = Memory { Data { Stories } }
        datasource Personal = Local { StorageKey "personal" Data { Bookmarks } }
        app Reader { id "reader" version "1.0.0" name "Reader" Navigator StackNav { Initial Main } Datasource { Feed } }
        test "Reader" with Notes {
          test "opens" { run Reader }
        }
      `,
      testValidationMessages.fixtureAppBinding('Notes', 'Bookmark', 'Reader'),
    ),
  )

  Test(
    'accepts a fixture whose entity the running app does bind',
    accepts(
      `
        use Local from @tao/data/providers/local
        use Memory from @tao/data/providers/memory
        use StackNav from @tao/nav
        ${stubView('Main')}
        data Stories / Story { Title text }
        data Bookmarks / Bookmark { Note text }
        fixture Notes {
          Draft = create Bookmark { Note: "Draft" }
        }
        datasource Feed = Memory { Data { Stories } }
        datasource Personal = Local { StorageKey "personal" Data { Bookmarks } }
        app Reader { id "reader" version "1.0.0" name "Reader" Navigator StackNav { Initial Main } Datasource { Feed, Personal } }
        test "Reader" with Notes {
          test "opens" { run Reader }
        }
      `,
    ),
  )
})
