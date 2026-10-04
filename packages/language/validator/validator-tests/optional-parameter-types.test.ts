import { Describe, Test } from '@shared/test'
import { ActionsValidator } from '../validator-src/validators/ActionsValidator'
import { FunctionsValidator } from '../validator-src/validators/functions-validator'
import { InvocationsValidator } from '../validator-src/validators/invocations-validator'
import { typeValidationMessages } from '../validator-src/validators/types-validator'
import { accepts, rejects, stubView } from './test-validate'

Describe('validator: optional parameter types', () => {
  for (const declaration of ['Value text?', 'Value?']) {
    const prelude = declaration === 'Value?' ? 'type Value is text' : ''

    Test(
      `accepts none and concrete action arguments for ${declaration}`,
      accepts(`
      ${prelude}
      action Accept(${declaration}) { }
      action Run() { do Accept(none) do Accept(Value: "ready") }
    `),
    )

    Test(
      `accepts none defaults and omitted action arguments for ${declaration}`,
      accepts(`
      ${prelude}
      action Accept(${declaration} default none) { }
      action Run() { do Accept() }
    `),
    )

    Test(
      `still requires an argument without a default for ${declaration}`,
      rejects(
        `
      ${prelude}
      action Accept(${declaration}) { }
      action Run() { do Accept() }
    `,
        ActionsValidator.messages.missingArgument('Accept', 'Value'),
      ),
    )
  }

  Test(
    'accepts nullable function parameters and defaults',
    accepts(`
    function Accept(Value text? default none) returns boolean { return true }
    let Empty = Accept()
    let Explicit = Accept(Value: none)
    let Concrete = Accept(Value: "ready")
  `),
  )

  Test(
    'still requires a nullable function argument',
    rejects(
      `
    function Accept(Value text?) returns boolean { return true }
    let Empty = Accept()
  `,
      FunctionsValidator.messages.functionMissingArgument('Accept', 'Value'),
    ),
  )

  Test(
    'accepts nullable view arguments and defaults',
    accepts(`
    app Example { view Main }
    view Main() { render Accept() }
    view Explicit() { render Accept(Value: none) }
    view Concrete() { render Accept(Value: "ready") }
    ${stubView('Accept', 'Value text? default none')}
  `),
  )

  Test(
    'still requires a nullable view argument',
    rejects(
      `
    app Example { view Main }
    view Main() { render Accept() }
    ${stubView('Accept', 'Value text?')}
  `,
      InvocationsValidator.messages.missingArgument('Accept', 'Value'),
    ),
  )

  Test(
    'rejects none for a required nonnullable parameter',
    rejects(
      `
    action Accept(Value text) { }
    action Run() { do Accept(none) }
  `,
      ActionsValidator.messages.unmatchedArgument('Accept'),
    ),
  )

  Test(
    'rejects a none default for a nonnullable parameter',
    rejects(
      `
    action Accept(Value text default none) { }
  `,
      typeValidationMessages.defaultParameterType('Value', 'Accept.Value', 'none'),
    ),
  )

  Test(
    'preserves absence when referring to a nullable inline parameter type',
    accepts(`
    action First(Value text?) { }
    action Second(Value First.Value default none) { }
    action Run() { do Second() do Second(Value: none) }
  `),
  )
})
