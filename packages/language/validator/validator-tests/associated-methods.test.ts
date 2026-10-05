import { Describe, Test } from '@shared/test'
import { AssociatedMethodsValidationMessages as messages } from '../validator-src/validators/AssociatedMethodsValidationMessages'
import { accepts, rejects } from './test-validate'

Describe('validator: associated declaration boundaries', () => {
  Test(
    'accepts independent text owners and a descendant inheriting their methods',
    accepts(`
    type Token is text with { func ToText() -> text { return "token:{Token}" } }
    type Label is text with { func ToText() -> text { return "label:{Label}" } }
    type Child is Token
    can Display { ToText() -> text }
    func Relay(Value Display) -> Display { return Value }
  `),
  )

  Test(
    'rejects unsupported owner families before replacing an existing runtime surface',
    rejects(
      `
    type Count is number with { func ToText() -> text { return "count" } }
  `,
      messages.family,
    ),
  )

  Test(
    'keeps a declared failure bound separate and rejects unsupported bound spellings',
    rejects(
      `
    can Display { ToText() fails Maybe -> text }
  `,
      messages.failureBound,
    ),
  )

  Test(
    'rejects duplicate structural requirement names',
    rejects(
      `
    can Display { ToText() -> text ToText() -> text }
  `,
      messages.duplicateRequirement('ToText'),
    ),
  )
})
