import { Text } from '@shared'
import { Expect } from '@shared/test'
import Formatter from '../formatter-src/formatter'

/** testFormatCode formats Tao source and asserts the expected output and formatting idempotency. */
export async function testFormatCode(source: string, expected: string): Promise<string> {
  const expectedText = `${Text.stripIndent(expected)}\n`
  const formatted = await Formatter.formatCode(Text.stripIndent(source))

  Expect(formatted).toBe(expectedText)
  Expect(await Formatter.formatCode(formatted)).toBe(expectedText)
  return formatted
}
