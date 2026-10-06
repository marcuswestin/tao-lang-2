import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('formatter: signature role constructors', () => {
  Test(
    'keeps comma spacing before an explicit signature role stable',
    formats(
      'let Person=PersonName(ProfileName "Ada",.FamilyName "Lovelace")',
      'let Person = PersonName(ProfileName "Ada", .FamilyName "Lovelace")',
    ),
  )

  Test(
    'keeps both parenthesis and comma gaps owned by the invocation',
    formats(
      'let Difference=Subtract( .Right 2 , .Left 5 )',
      'let Difference = Subtract(.Right 2, .Left 5)',
    ),
  )

  Test(
    'keeps explicit roles stable inside a quoted interpolation',
    formats(
      'let Greeting="Hello {PersonName(ProfileName "Ada",.FamilyName "Lovelace")}"',
      'let Greeting = "Hello { PersonName(ProfileName "Ada", .FamilyName "Lovelace") }"',
    ),
  )
})
