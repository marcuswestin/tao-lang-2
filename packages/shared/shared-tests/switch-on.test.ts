import { Describe, Expect, Test } from '@shared/test'
import { Switch } from '../shared-src/shared'

const inheritedKeys = ['constructor', 'toString', '__proto__', 'hasOwnProperty']

Describe('Switch.on', () => {
  Test('dispatches exhaustively on a property, passing the handler the narrowed item', () => {
    type Message =
      | { type: 'text'; value: string }
      | { type: 'count'; value: number }

    const text: Message = { type: 'text', value: 'hello' }
    const count: Message = { type: 'count', value: 3 }

    const describe = (message: Message): string =>
      Switch.on(message, 'type', {
        // The `text` branch narrows to `{ type: 'text'; value: string }`, so `.toUpperCase()` type-checks
        // only because Switch.on passed the whole narrowed item rather than just `message.type`.
        text: item => item.value.toUpperCase(),
        count: item => item.value.toFixed(1),
      })

    Expect(describe(text)).toBe('HELLO')
    Expect(describe(count)).toBe('3.0')
  })

  Test('a message with no matching handler throws', () => {
    const type: string = 'unknown'

    Expect(() => Switch.on({ type } as { type: 'known' }, 'type', { known: Switch.nothing }))
      .toThrow('Unhandled property value: unknown')
  })

  Test('an inherited Object member never resolves as a handler', () => {
    for (const type of inheritedKeys) {
      Expect(() => Switch.on({ type } as { type: 'known' }, 'type', { known: Switch.nothing }))
        .toThrow('Unhandled property value')
    }
  })
})
