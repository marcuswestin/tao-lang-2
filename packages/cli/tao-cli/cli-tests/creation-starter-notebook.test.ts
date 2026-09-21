import { Describe, Test } from '@shared/test'
import { expectStarterReproducedFromItsPlan } from './test-starter-lowering'

Describe('tao create lowering: Notebook', () => {
  Test('reproduces Apps/Starters/Notebook byte for byte from its reference plan', async () => {
    await expectStarterReproducedFromItsPlan('Notebook')
  })
})
