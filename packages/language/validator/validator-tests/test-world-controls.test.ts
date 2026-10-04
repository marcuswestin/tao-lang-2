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
    data Notes / Note { Title text }
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

  Test(
    'rejects a fault targeting a nonexistent entity',
    rejects(
      app(
        render,
        `test "Demo" { test "typo" {
      run MyApp
      datasource fails after create Typo "never fires"
    } }`,
      ),
      testValidationMessages.unknownDatasourceFailureEntity('Typo'),
    ),
  )

  Test(
    'rejects a fault targeting an entity outside the running app',
    rejects(
      `
      use Memory from @tao/data/providers/memory
      use StackNav from @tao/nav
      data Notes / Note { Title text }
      data Tasks / Task { Title text }
      datasource NotesStore = Memory { Data { Notes } }
      datasource TasksStore = Memory { Data { Tasks } }
      scene Main() { Title "Main" render inject ${tsFence} return null ${fence} }
      app NotesApp { id "notesapp" version "1.0.0" name "Notes" Navigator StackNav { Initial Main } Datasource { NotesStore } }
      test "Notes" { test "wrong store" {
        run NotesApp
        datasource fails after create Task "never fires"
      } }
    `,
      testValidationMessages.unboundDatasourceFailureEntity('Task', 'NotesApp'),
    ),
  )
})
