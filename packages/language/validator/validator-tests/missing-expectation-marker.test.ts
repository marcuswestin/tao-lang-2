import { Describe, Test } from '@shared/test'
import { testValidationMessages } from '../validator-src/validators/tests-validator'
import { accepts, app, fence, rejects, tsFence } from './test-validate'

const render = `render inject ${tsFence} return null ${fence}`

Describe('validator: missing text expectation marker', () => {
  Test(
    'accepts the missing marker on direct and grouped text expectations',
    accepts(app(
      render,
      `test "Text" { test "visibility" {
        run MyApp
        expect text "Ready"
        expect missing text "Loading"
        expect { text "Ready" missing label "Loading" }
      } }`,
    )),
  )

  Test(
    'rejects another ID in place of the missing marker on a direct expectation',
    rejects(
      app(render, `test "Text" { test "visibility" { run MyApp expect absent text "Loading" } }`),
      testValidationMessages.missingModifier('absent'),
    ),
  )

  Test(
    'rejects another ID in place of the missing marker in a grouped expectation',
    rejects(
      app(render, `test "Text" { test "visibility" { run MyApp expect { absent text "Loading" } } }`),
      testValidationMessages.missingModifier('absent'),
    ),
  )
})
