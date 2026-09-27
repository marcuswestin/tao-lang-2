import { Describe, Test } from '@shared/test'
import { ActionsValidator } from '../validator-src/validators/ActionsValidator'
import { accepts, rejects } from './test-validate'

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
})
