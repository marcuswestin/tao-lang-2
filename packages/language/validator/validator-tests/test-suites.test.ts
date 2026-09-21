import { Describe, Test } from '@shared/test'
import { testValidationMessages } from '../validator-src/validators/tests-validator'
import { accepts, app, fence, rejects, tsFence } from './test-validate'

const render = `render inject ${tsFence} return null ${fence}`

/**
 * A Tao test file nests twice: a file-level test names a suite, and the tests inside it are the
 * checks a run executes. Written one level short the same steps still parse and still validate step
 * by step, and the compiler — which takes a suite's checks from the tests nested in it and from
 * nothing else — turns the file into a suite of none. That file then runs nothing and passes, which
 * is the one way a test can be wrong that no test result can report. These tests hold the shape.
 */
Describe('validator: Tao test suites', () => {
  Test(
    'accepts a file-level suite whose checks are nested tests',
    accepts(app(
      render,
      `
      test "A suite" {
        test "a check" {
          run MyApp
        }
      }
    `,
    )),
  )

  Test(
    'rejects a file-level test written as a check, which would compile to a suite of none',
    rejects(
      app(
        render,
        `
        test "A suite" {
          run MyApp
        }
      `,
      ),
      testValidationMessages.emptySuite('A suite'),
    ),
  )

  // An empty file-level test is the same mistake with the steps left out, and it is reported as the
  // empty suite it is rather than only as a check that forgot to start an app.
  Test(
    'rejects a file-level test with an empty block',
    rejects(
      app(render, 'test "A suite" { }'),
      testValidationMessages.emptySuite('A suite'),
    ),
  )

  // Nested tests remain leaf journeys: the rule is about the level a test sits at, not about steps.
  Test(
    'keeps reporting a nested check that starts no app as a missing run',
    rejects(
      app(
        render,
        `
        test "A suite" {
          test "a check" {
            expect text "anything"
          }
        }
      `,
      ),
      testValidationMessages.missingRun('a check'),
    ),
  )
})
