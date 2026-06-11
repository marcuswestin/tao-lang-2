import { Text } from '@shared'
import { Expect } from '@shared/test'
import Formatter, { type FormatOptions } from '../formatter-src/formatter'

/** testFormatCode formats Tao source and asserts the expected output and formatting idempotency. */
export async function testFormatCode(source: string, expected: string, opts: FormatOptions = {}): Promise<string> {
  const expectedText = `${Text.stripIndent(expected)}\n`
  const formatted = await Formatter.formatCode(Text.stripIndent(source), opts)

  Expect(formatted).toBe(expectedText)
  Expect(await Formatter.formatCode(formatted, opts)).toBe(expectedText)
  return formatted
}
