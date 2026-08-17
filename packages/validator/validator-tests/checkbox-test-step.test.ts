import { Describe, Test } from '@shared/test'
import { testValidationMessages } from '../validator-src/validators/tests-validator'
import { accepts, app, fence, rejects, tsFence } from './test-validate'

const render = `render inject ${tsFence} return null ${fence}`

function checkboxCheck(steps: string): string {
  return app(
    render,
    `
    test "Checkbox state" {
      check "checks state" {
        ${steps}
      }
    }
  `,
  )
}

Describe('validator: checkbox test expectations', () => {
  Test(
    'accepts tag-only checked and unchecked assertions after run',
    accepts(checkboxCheck(`
      run MyApp
      expect checkbox #markFinal checked
      expect checkbox #marketingOptIn unchecked
    `)),
  )

  Test(
    'rejects checkbox assertions before run',
    rejects(
      checkboxCheck(`
        expect checkbox #markFinal checked
        run MyApp
      `),
      testValidationMessages.expectationBeforeRun,
    ),
  )

  Test(
    'rejects checkbox assertions outside check blocks',
    rejects(
      app(render, 'expect checkbox #markFinal checked'),
      testValidationMessages.expectationPlacement,
    ),
  )
})
