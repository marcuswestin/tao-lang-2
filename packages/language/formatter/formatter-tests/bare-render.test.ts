import { Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import Formatter from '../formatter-src/formatter'

Describe('formatter: bare renders', () => {
  Test('roundtrips bare headers, roots, children and styled interpolated quotations', async () => {
    const formatted = await Formatter.formatCode(
      'view Main{state Name is text="Books" render Col{Spacer "{Name}"[pad 8] "" Text("")}}',
    )
    Expect(formatted).toBe(
      'view Main {\n   state Name is text = "Books"\n   render Col {\n      Spacer\n      "{ Name }" [pad 8]\n      ""\n      Text("")\n}  }\n',
    )
    Expect(Parser.parseSyntax(formatted).errors).toBe(0)
    Expect(await Formatter.formatCode(formatted)).toBe(formatted)
  })

  Test('keeps explicit parentheses and declaration fills as valid input', async () => {
    const formatted = await Formatter.formatCode('scene Main(){Title "Books" render Col(){Spacer()}}')
    Expect(formatted).toBe('scene Main() {\n   Title "Books"\n   render Col() {\n      Spacer()\n}  }\n')
    Expect(Parser.parseSyntax(formatted).errors).toBe(0)
  })
})
