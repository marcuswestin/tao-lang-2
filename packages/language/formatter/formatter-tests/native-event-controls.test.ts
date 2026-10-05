import { Describe, Expect, Test } from '@shared/test'
import Formatter from '../formatter-src/formatter'

Describe('formatter: native event controls', () => {
  Test('formats binding controls and preserves the named action arrow', async () => {
    const formatted = await Formatter.formatCode(
      'view Main(){render Button(){on press( preventDefault ,stopPropagation )->Save}}',
    )

    Expect(formatted).toBe(
      'view Main() {\n   render Button() {\n      on press (preventDefault, stopPropagation) -> Save\n}  }\n',
    )
    Expect(await Formatter.formatCode(formatted)).toBe(formatted)
  })

  Test('formats an inline controlled block and retains an ordinary named handler', async () => {
    const formatted = await Formatter.formatCode(
      'view Main(){render Button(){on press(stopImmediatePropagation)->{do Save()}}render Button(){on press Save}}',
    )

    Expect(formatted).toBe(
      'view Main() {\n   render Button() {\n      on press (stopImmediatePropagation) -> { do Save() }\n   }\n   render Button() {\n      on press Save\n}  }\n',
    )
    Expect(await Formatter.formatCode(formatted)).toBe(formatted)
  })
})
