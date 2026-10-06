import { Describe, Test } from '@shared/test'
import { FunctionalCoreValidator } from '../validator-src/validators/FunctionalCoreValidator'
import { accepts, rejects } from './test-validate'

Describe('validator: action loop check placement', () => {
  Test(
    'rejects a check that would exit only an iteration callback',
    rejects(
      'action Visit(Items list of text) { loop Items / Item { check no } }',
      FunctionalCoreValidator.messages.checkPlacement,
    ),
  )

  Test(
    'keeps an action-level check before the loop valid',
    accepts('action Visit(Items list of text) { check no loop Items / Item {} }'),
  )
})
