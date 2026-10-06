import { RuntimeTesting } from '@expo-host/testing/runtime-testing'
import { Describe, Test, withTaoFiles } from '@shared/test'
import { registerRuntimeE2ELifecycle } from './test-compile-app'

registerRuntimeE2ELifecycle()

Describe('Expo mounted query entity render journey', () => {
  Test('renders a genuine query row through its associated view without importing the singular name', async () => {
    await withTaoFiles('tao-query-entity-render-journey-', {
      'Main.test.tao': `
        use Library from ./
        test "Query entity rendering" {
          test "keeps the live entity receiver" {
            run Library
            expect missing text "Rendered Before"
            press #add
            expect text "Count 1"
            expect text "Rendered Before"
            press #rename
            expect text "Rendered After"
            expect missing text "Rendered Before"
          }
        }
      `,
      'Main.tao': `
        use Col, FormButton from @tao/ui
        use Memory from @tao/data/providers/memory
        use Books, Seed from ./Data
        app Library {
          id "query.entity.render" version "1.0.0" name "Query entity render"
          view Main
          Datasource Memory { }
        }
        view Main {
          query Feed = Books with { }
          render Col {
            "Count {Feed.Count}"
            #add FormButton("Add") { on press Seed }
            guard Feed
            loop Feed / Book { Book }
          }
        }
      `,
      'Data.tao': `
        use Col, FormButton from @tao/ui
        public data Books / Book {
          Title text,
          view Book.Render() { render BookRow(Book) }
        }
        view BookRow(Current Book) {
          render Col {
            "Rendered {Current.Title}"
            #rename FormButton("Rename") { on press -> { update Current { Title: "After" } } }
          }
        }
        public action Seed() { create Book { Title: "Before" } }
      `,
    }, async paths => {
      await RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)
    })
  })
})
