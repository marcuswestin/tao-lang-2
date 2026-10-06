import { Describe, Test } from '@shared/test'
import { configuredItemValidationMessages } from '../validator-src/validators/configured-item-validator'
import { FunctionsValidator } from '../validator-src/validators/functions-validator'
import { accepts, acceptsFiles, rejects, rejectsFiles } from './test-validate'

const subtract = 'func Subtract(Left number, Right number) -> number { return Left - Right }'
const names = `
  type Name is text
  type GivenName is Name
  type FamilyName is Name
  public func PersonName(GivenName, FamilyName) -> text { return "{GivenName} {FamilyName}" }
`

Describe('validator: signature roles', () => {
  Test(
    'accepts reordered contextual roles, full paths and existing named arguments',
    accepts(`
    ${subtract}
    let Bare = Subtract(Right 2, Left 5)
    let Relative = Subtract(.Right 2, .Left 5)
    let Qualified = Subtract(Subtract.Right 2, Subtract.Left 5)
    let Named = Subtract(Right: 2, Left: 5)
  `),
  )

  Test(
    'accepts a private signature projection descendant across files',
    acceptsFiles({
      'Main.tao': `
      use PersonName from ./library/Names
      type ProfileName is PersonName.GivenName
      let Person = PersonName(ProfileName "Ada", .FamilyName "Lovelace")
      let Fallback = PersonName(GivenName "Ada", FamilyName "Lovelace")
    `,
      'library/Names.tao': names,
    }),
  )

  Test(
    'uses explicit projection to escape a colliding ordinary type',
    acceptsFiles({
      'Main.tao': `
      use PersonName from ./library/Names
      type GivenName is number
      let Relative = PersonName(.GivenName "Ada", .FamilyName "Lovelace")
      let Qualified = PersonName(PersonName.GivenName "Ada", PersonName.FamilyName "Lovelace")
    `,
      'library/Names.tao': names,
    }),
  )

  Test(
    'reports an incompatible visible constructor without signature fallback',
    rejectsFiles({
      'Main.tao': `
      use PersonName from ./library/Names
      type GivenName is number
      let Person = PersonName(GivenName "Ada", .FamilyName "Lovelace")
    `,
      'library/Names.tao': names,
    }, configuredItemValidationMessages.constructorShape('GivenName', 'number')),
  )

  Test(
    'rejects downward role conversion',
    rejects(
      `
    type Name is text
    type Given is Name
    func OnlyGiven(Value Given) -> text { return Value }
    let Parent = Name "Ada"
    let Narrowed = OnlyGiven(Parent)
  `,
      FunctionsValidator.messages.functionUnmatchedArgument('OnlyGiven'),
    ),
  )

  Test(
    'rejects sibling role conversion',
    rejects(
      `
    type Name is text
    type Given is Name
    type Family is Name
    func OnlyGiven(Value Given) -> text { return Value }
    let Sibling = Family "Ada"
    let Reinterpreted = OnlyGiven(Sibling)
  `,
      FunctionsValidator.messages.functionUnmatchedArgument('OnlyGiven'),
    ),
  )
})
