import { Describe, Expect, Test } from '@shared/test'
import { ViewsValidator } from '../validator-src/validators/views-validator'
import { app, rejects, stubContainer, stubView, testValidateCode } from './test-validate'

const renderables = `${stubContainer('Stack')}${stubView('Text', 'Value text')}`

function selectableApp(loopBody: string, setup = ''): string {
  return app(
    `
      state Selected = ""
      ${setup}
      render Stack() {
        ${loopBody}
      }
    `,
    renderables,
  )
}

Describe('validator: selectable loops', () => {
  Test('hints that a multi-root row carries no accessibility label, and only such a row', async () => {
    const result = await testValidateCode(`
      use Col, Text from @tao/ui
      app MyApp { view MainView }
      view MainView() {
        state Selected = ""
        render Col() {
          loop ["One"] / Row {
            Text(Row)
            Text(Row)
          }
          loop ["Two"] / Row {
            Col() { Text(Row) }
          }
          loop ["Three"] / Row {
            Text(Row)
            Text(Row)
            on select -> { set Selected = Row }
          }
          loop ["Four"] / Row {
            Text("Static")
            Text("Static")
          }
        }
      }
    `)
    const hints = result.diagnostics.filter(diagnostic => diagnostic.severity === 'hint')

    Expect(hints.map(hint => hint.message)).toEqual([ViewsValidator.messages.loopRowLabel])
  })

  Test(
    'reports a select handler outside a loop',
    rejects(
      selectableApp('on select -> { set Selected = "Invalid" }'),
      ViewsValidator.messages.loopSelectPlacement,
    ),
  )

  Test(
    'reports more than one direct select handler',
    rejects(
      selectableApp(`
        loop ["One"] / Row {
          Text(Row)
          on select -> { set Selected = Row }
          on select -> { set Selected = Row }
        }
      `),
      ViewsValidator.messages.loopSelectDuplicate,
    ),
  )

  Test(
    'requires an inline action block instead of a named action',
    rejects(
      selectableApp(
        `
        loop ["One"] / Row {
          Text(Row)
          on select Choose
        }
      `,
        'action Choose() { set Selected = "Named" }',
      ),
      ViewsValidator.messages.loopSelectInline,
    ),
  )

  Test(
    'keeps the singular row binding out of scope after the loop',
    rejects(
      selectableApp(`
        loop ["One"] / Row {
          Text(Row)
          on select -> { set Selected = Row }
        }
        Text(Row)
      `),
      "No value named 'Row' is in scope.",
    ),
  )
})
