import { RuntimeTesting } from '@expo-host/testing/runtime-testing'
import { Describe, Test, withTaoFiles } from '@shared/test'
import { registerRuntimeE2ELifecycle } from './test-compile-app'

registerRuntimeE2ELifecycle()

Describe('Expo mounted typed text field journey', () => {
  Test('edits a required nominal caller field and clears it through Tao steps', async () => {
    await withTaoFiles(
      'tao-typed-text-field-journey-',
      {
        'Main.test.tao': `
          use Form from ./

          test "Typed text field" {
            test "edits and clears a required title" {
              run Form
              expect #title input value ""
              expect text "Enter a title"
              expect text "true"
              enter "A title" into #title
              expect #title input value "A title"
              expect text "A title"
              expect text "false"
              expect missing text "Enter a title"
              enter "" into #title
              expect #title input value ""
              expect text "Enter a title"
              expect text "true"
            }
          }
        `,
        'Main.tao': `
          use Col, TextField from @tao/ui

          type TitleType is text
          data Books / Book { Title TitleType (required "Enter a title"), Note text }
          type NewBook is Book { Title }

          app Form { id "typed.text.field" version "1.0.0" name "Typed form" view Main }

          view Main() {
            state Draft = NewBook { Title: TitleType "" }
            render Col() {
              #title TextField(.Value Draft.Title)
              "{Draft.Title}"
              loop Draft.Problems / Problem {
                "{Problem}"
              }
              "{Draft.Incomplete}"
            }
          }
        `,
      },
      async paths => {
        await RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)
      },
    )
  })
})
