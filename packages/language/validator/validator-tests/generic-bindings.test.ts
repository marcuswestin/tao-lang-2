import { Describe, Test } from '@shared/test'
import { AssociatedMethodsValidationMessages } from '../validator-src/validators/AssociatedMethodsValidationMessages'
import { FunctionsValidator } from '../validator-src/validators/functions-validator'
import { typeValidationMessages } from '../validator-src/validators/types-validator'
import { accepts, rejects } from './test-validate'

const numeric = `
  type Temperature is number
  type Celsius is Temperature
  type Fahrenheit is Temperature
  type RoomReading is Celsius
  func Earlier where type T is Temperature (Left T, Right T) -> T { return Left }
`

Describe('validator: bounded generic function calls', () => {
  Test(
    'accepts a supplied ancestor in either labeled argument order',
    accepts(`
    ${numeric}
    let Parent = Celsius 20
    let Child = RoomReading 21
    let First = Earlier(Right: Child, Left: Parent)
    let Second = Earlier(Left: Child, Right: Parent)
  `),
  )

  Test(
    'rejects sibling inputs without manufacturing an absent parent',
    rejects(
      `
    ${numeric}
    let Metric = Celsius 20
    let Imperial = Fahrenheit 68
    let Mixed = Earlier(Left: Metric, Right: Imperial)
  `,
      FunctionsValidator.messages.incompatibleGeneric('Earlier', 'T'),
    ),
  )

  Test(
    'accepts contextual generic roles with typed and raw payloads after inference',
    accepts(`
    ${numeric}
    let Parent = Celsius 20
    let Child = RoomReading 21
    let Typed = Earlier(.Right Child, .Left Parent)
    let Contextual = Earlier(.Left Parent, .Right 22)
  `),
  )

  Test(
    'requires an actually typed input to anchor contextual literals',
    rejects(
      `
    ${numeric}
    let Raw = Earlier(Left: 20, Right: 21)
  `,
      FunctionsValidator.messages.uninferredGeneric('Earlier', 'T'),
    ),
  )

  Test(
    'rejects duplicate type parameter identities',
    rejects(
      `
    func Bad where type T is number, type T is text (Value T) { return Value }
  `,
      FunctionsValidator.messages.duplicateGenericParameter('T'),
    ),
  )

  Test(
    'rejects unresolved bounds through ordinary type diagnostics',
    rejects(
      `
    func Bad where type T is Absent (Value T) { return Value }
  `,
      typeValidationMessages.unknownType('Absent'),
    ),
  )
  Test(
    'specializes inherited associated generic Self bounds to the actual receiver',
    accepts(`
    type Parent is text with {
      func Keep where type T is Self (Value T) -> T { return Value }
    }
    type Child is Parent
    let Receiver = Child "receiver"
    let Input = Child "input"
    let Result = Receiver.Keep(Input)
  `),
  )

  Test(
    'rejects an associated generic call without a bounded concrete substitution',
    rejects(
      `
    type Parent is text with {
      func Keep where type T is Self (Value T) -> T { return Value }
    }
    type Child is Parent
    let Receiver = Child "receiver"
    let Input = Parent "input"
    let Result = Receiver.Keep(Input)
  `,
      AssociatedMethodsValidationMessages.pending('Keep'),
    ),
  )
})
