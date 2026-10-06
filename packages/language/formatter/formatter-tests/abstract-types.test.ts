import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('abstract type formatter', () => {
  Test(
    'preserves the abstract marker on a type declaration',
    formats('abstract type NumericFamily is numeric', 'abstract type NumericFamily is numeric'),
  )
})
