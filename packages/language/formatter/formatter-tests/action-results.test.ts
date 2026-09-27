import { Describe, Expect, Test } from '@shared/test'
import Formatter from '../formatter-src/formatter'

Describe('formatter: action results', () => {
  Test('formats return declarations and awaited result bindings', async () => {
    Expect(
      await Formatter.formatCode('action Read()returns text? from ./Bindings.ts\naction Paste(){let Pasted=do Read()}'),
    ).toBe(
      'action Read() returns text? from ./Bindings.ts\n\naction Paste() {\n   let Pasted = do Read()\n}\n',
    )
  })
})
