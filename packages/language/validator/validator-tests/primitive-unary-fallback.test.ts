import { Describe, Test } from '@shared/test'
import { accepts, rejects } from './test-validate'

const contracts = `
  type Other is number with {
    static func -(Value Other) fails never -> Other { return Value }
  }
  type Measure is numeric with { units { seconds 1 (default) } }
`

Describe('validator: primitive unary fallback', () => {
  Test(
    'keeps primitive negation and signed construction when another owner declares negation',
    accepts(`
    ${contracts}
    let Negative = -2 seconds
    let Grouped = (-2) seconds
    func Negate(Value number) -> number { return -Value }
  `),
  )

  Test(
    'still requires an authored operator to negate a constructed quantity',
    rejects(
      `
    ${contracts}
    func Negate(Value Measure) -> Measure { return -Value }
  `,
      "Operator '-' has no applicable authored contract for these ordered operands.",
    ),
  )
})
