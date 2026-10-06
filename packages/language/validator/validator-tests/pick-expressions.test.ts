import { Describe, Test } from '@shared/test'
import { FunctionalCoreValidator } from '../validator-src/validators/FunctionalCoreValidator'
import { accepts, rejects } from './test-validate'

Describe('validator: total pick expressions', () => {
  Test(
    'accepts predicate selection with a fallback',
    accepts(`
    func Earlier(Left number, Right number) -> number {
      return pick { Left <= Right -> Left otherwise -> Right }
    }
  `),
  )

  Test(
    'accepts every boolean case without introducing none into the result',
    accepts(`
    func Label(Value yes/no) -> text { return pick Value { yes -> "yes" no -> "no" } }
  `),
  )

  Test(
    'accepts every enum case without a fallback',
    accepts(`
    type Mode is one of Quiet, Loud
    func Label(Value Mode) -> text { return pick Value { Quiet -> "quiet" Loud -> "loud" } }
  `),
  )

  Test(
    'accepts a predicate with a statically unconditional match',
    accepts(`
    func Label(Value yes/no) -> text { return pick { Value -> "yes" yes -> "fallback" } }
  `),
  )

  for (const body of ['pick Value { yes -> "yes" }', 'pick { Value -> "yes" }']) {
    Test(
      `rejects an uncovered input: ${body}`,
      rejects(
        `func Label(Value yes/no) { return ${body} }`,
        FunctionalCoreValidator.messages.pickTotal,
      ),
    )
  }
})
