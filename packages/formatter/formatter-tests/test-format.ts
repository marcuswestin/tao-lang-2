import { Text } from '@shared'
import { Expect } from '@shared/test'
import Formatter from '../formatter-src/formatter'

const formatterSession = Formatter.createSession()

/** testFormatCode formats Tao source and asserts the expected output and formatting idempotency. */
export async function testFormatCode(source: string, expected: string): Promise<string> {
  const expectedText = `${Text.stripIndent(expected)}\n`
  const formatted = await formatterSession.formatCode(Text.stripIndent(source))

  Expect(formatted).toBe(expectedText)
  Expect(await formatterSession.formatCode(formatted)).toBe(expectedText)
  return formatted
}
