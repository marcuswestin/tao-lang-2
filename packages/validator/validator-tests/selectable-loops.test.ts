import { Describe, Test } from '@shared/test'
import { ViewsValidator } from '../validator-src/validators/views-validator'
import { accepts, app, rejects, stubLayout, stubView } from './test-validate'

const renderables = `${stubLayout('Stack')}${stubView('Text', 'Value text')}`

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
  Test(
    'allows one inline direct handler to reference the singular row binding',
    accepts(selectableApp(`
      loop ["One"] / Row {
        Text(Row)
        on select -> { set Selected = Row }
      }
    `)),
  )

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
      "Could not resolve reference to ValueDeclaration named 'Row'.",
    ),
  )
})
