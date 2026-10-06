import { Describe, Test } from '@shared/test'
import { FunctionsValidator } from '../validator-src/validators/functions-validator'
import { accepts, rejects } from './test-validate'

Describe('validator: enum read effect publication', () => {
  Test(
    'admits a declared enum case as a pure function result',
    accepts(`
    type Role is one of Reader, Editor
    func DefaultRole() -> Role { return Reader }
  `),
  )

  Test(
    'admits optional enum comparisons through nested when values',
    accepts(`
    type Role is one of Reader, Editor
    func RoleLabel(Value Role?) -> text {
      return when (Value == none) {
        true -> "none"
        otherwise -> when (Value == Reader) {
          true -> "Reader"
          otherwise -> "Editor"
        }
      }
    }
  `),
  )

  Test(
    'retains purity rejection for mutable enum parameter reads',
    rejects(
      `
    type Role is one of Reader, Editor
    func MutableRole(mutable Value Role) -> Role { return Value }
  `,
      FunctionsValidator.messages.functionPurity('MutableRole'),
    ),
  )
})
