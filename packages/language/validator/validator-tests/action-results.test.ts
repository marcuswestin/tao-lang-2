import { Type } from '@ast-utils'
import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { ActionsValidator } from '../validator-src/validators/ActionsValidator'
import {
  accepts,
  rejects,
  testValidateCode,
  testValidateCodeWithErrors,
  validationErrorMessages,
} from './test-validate'

Describe('validator: action results', () => {
  Test(
    'accepts typed result uses and ordinary do discarding results',
    accepts(`
    action Read() returns text from ./Bindings.ts
    action Consume(Value text) { }
    action Paste() { let Pasted = do Read() do Consume(Pasted) do Read() }
  `),
  )
  Test(
    'accepts nullable results for optional parameters',
    accepts(`
    action Read() returns text? from ./Bindings.ts
    action Consume(Value text?) { }
    action Paste() { let Pasted = do Read() do Consume(Pasted) }
  `),
  )
  Test(
    'rejects nullable results for required parameters',
    rejects(
      `
    action Read() returns text? from ./Bindings.ts
    action Consume(Value text) { }
    action Paste() { let Pasted = do Read() do Consume(Value: Pasted) }
  `,
      ActionsValidator.messages.namedArgumentType('Consume', 'Value', 'Consume.Value', 'text | none'),
    ),
  )
  Test('infers source action results through an action alias and a result binding', async () => {
    const result = await testValidateCode(`
      action Read() { return "ready" }
      action Consume(Value text) { }
      action Export() {
        let ReadAlias = Read
        let Payload = do ReadAlias()
        do Consume(Value: Payload)
      }
    `)
    Expect(validationErrorMessages(result)).toEqual([])
    const read = result.entry.ast.statements.find(
      statement => AST.isActionDeclaration(statement) && statement.name === 'Read',
    )
    Expect.Is(read, AST.isActionDeclaration)
    Expect(Type.displayName(Type.ofActionResult(read))).toBe('text')
  })
  Test(
    'rejects source action result paths that can fall through',
    rejects(
      'action Maybe(Flag boolean) { if Flag { return "value" } }',
      ActionsValidator.messages.sourceActionMayCompleteWithoutResult('Maybe'),
    ),
  )
  Test(
    'accepts a total literal-true return before unreachable statements',
    accepts(`
    action Read(Value text) { if true { return Value } return "unreachable" }
    action Consume(Value text) { }
    action Export() { let Payload = do Read(Value: "ready") do Consume(Payload) }
  `),
  )
  Test('accepts an explicit none return as an optional action result', async () => {
    const result = await testValidateCode(`
      action Maybe(Flag boolean) { if Flag { return "value" } return none }
      action Consume(Value text?) { }
      action Export() { let Payload = do Maybe(Flag: true) do Consume(Payload) }
    `)
    const maybe = result.entry.ast.statements.find(
      statement => AST.isActionDeclaration(statement) && statement.name === 'Maybe',
    )
    Expect.Is(maybe, AST.isActionDeclaration)
    Expect(Type.displayName(Type.ofActionResult(maybe))).toBe('text | none')
  })
  Test(
    'treats check exits as missing values when an action also returns a result',
    rejects(
      'action Maybe(Flag boolean) { check Flag return "value" }',
      ActionsValidator.messages.sourceActionMayCompleteWithoutResult('Maybe'),
    ),
  )
  Test('accepts a successful check before a source return', accepts('action Read() { check true return "value" }'))
  Test(
    'rejects binding a void action',
    rejects(
      `
    action Read() from ./Bindings.ts
    action Paste() { let Pasted = do Read() }
  `,
      ActionsValidator.messages.resultRequired,
    ),
  )
  Test(
    'rejects a result on a native body',
    rejects('action Read() returns text { }', ActionsValidator.messages.returnNative),
  )
  Test(
    'rejects runs latest results',
    rejects('action Read() returns text runs latest from ./Bindings.ts', ActionsValidator.messages.returnLatest),
  )
  Test(
    'rejects duplicate results',
    rejects(
      `
    action Read() returns text from ./Bindings.ts
    action Paste() { let Pasted = do Read() let Pasted = do Read() }
  `,
      ActionsValidator.messages.duplicateResult('Pasted'),
    ),
  )
  Test(
    'rejects using a result before its binding',
    rejects(`
    action Read() returns text from ./Bindings.ts
    action Consume(Value text) { }
    action Paste() { do Consume(Pasted) let Pasted = do Read() }
  `),
  )
  Test(
    'rejects using a result outside its block',
    rejects(`
    action Read() returns text from ./Bindings.ts
    action Consume(Value text) { }
    action Paste() { if true { let Pasted = do Read() } do Consume(Pasted) }
  `),
  )
  Test(
    'rejects mutation of a result',
    rejects(`
    action Read() returns text from ./Bindings.ts
    action Paste() { let Pasted = do Read() set Pasted = "new" }
  `),
  )
  Test(
    'rejects a result with the wrong argument type',
    rejects(
      `
    action Read() returns text from ./Bindings.ts
    action Consume(Value number) { }
    action Paste() { let Pasted = do Read() do Consume(Value: Pasted) }
  `,
      ActionsValidator.messages.namedArgumentType('Consume', 'Value', 'Consume.Value', 'text'),
    ),
  )
  Test('keeps a result name unavailable inside its own initializer', async () => {
    const result = await testValidateCodeWithErrors(`
      action Read(Value text) { return Value }
      action Export() {
        let Result = do Read(Value: Result)
        return Result
      }
    `)
    const action = result.entry.ast.statements.find(
      statement => AST.isActionDeclaration(statement) && statement.name === 'Export',
    )
    Expect.Is(action, AST.isActionDeclaration)
    const binding = action.block?.statements.find(AST.isActionResultStatement)
    Expect.Is(binding, AST.isActionResultStatement)
    const argumentValue = binding.invocation.argumentList?.arguments[0]?.value
    Expect.Is(argumentValue, AST.isValueReference)
    Expect(argumentValue.target.ref).toBeUndefined()
  })
})
