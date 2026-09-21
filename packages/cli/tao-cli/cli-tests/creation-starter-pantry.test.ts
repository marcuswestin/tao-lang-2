import { Describe, Test } from '@shared/test'
import { expectStarterReproducedFromItsPlan } from './test-starter-lowering'

Describe('tao create lowering: Pantry', () => {
  Test('reproduces Apps/Starters/Pantry byte for byte from its reference plan', async () => {
    await expectStarterReproducedFromItsPlan('Pantry')
  })
})
