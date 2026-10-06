import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('formatter: named import aliases', () => {
  Test(
    'formats source and local names with canonical spacing around as',
    formats(
      'use Card   as Button, Note as   N from ./Library',
      'use Card as Button, Note as N from ./Library',
    ),
  )
})
