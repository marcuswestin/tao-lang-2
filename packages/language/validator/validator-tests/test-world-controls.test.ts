import { Describe, Test } from '@shared/test'
import { testValidationMessages } from '../validator-src/validators/tests-validator'
import { accepts, app, fence, rejects, tsFence } from './test-validate'

const render = `render inject ${tsFence} return null ${fence}`

Describe('validator: test world controls', () => {
  Test(
    'accepts ordered controls after run',
    accepts(app(
      render,
      `
    test "Demo" { test "syncs" {
      run MyApp
      network offline
      datasource fails after create Note "rejected"
      network online
      wait for sync
    } }
  `,
    )),
  )

  Test(
    'rejects a world control before run',
    rejects(
      app(
        render,
        `
    test "Demo" { test "syncs" { network offline run MyApp } }
  `,
      ),
      testValidationMessages.expectationBeforeRun,
    ),
  )

  Test(
    'rejects network outside a test',
    rejects(app(render, `network offline`), testValidationMessages.networkPlacement),
  )
})
