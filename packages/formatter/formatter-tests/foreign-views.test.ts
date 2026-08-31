import { Describe, Expect, Test } from '@shared/test'
import Formatter from '../formatter-src/formatter'

Describe('formatter: foreign views', () => {
  Test('formats a foreign implementation head and declared capabilities', async () => {
    Expect(
      await Formatter.formatCode(
        'view CodeEditor(Content text,Change action(text))responds Result accepts content slots @header,@footer from ./CodeEditor.tsx\ntype Result is Done|Cancelled',
      ),
    ).toBe(
      'view CodeEditor(Content text, Change action(text)) responds Result accepts content slots @header, @footer from ./CodeEditor.tsx\n\ntype Result is Done | Cancelled\n',
    )
  })
})
