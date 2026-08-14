import { Text } from '@shared'
import { Expect, fence, tsFence } from '@shared/test'
import Formatter from '../formatter-src/formatter'

export { fence, tsFence }

const formatterSession = Formatter.createSession()

/** testFormatCode formats Tao source and asserts the expected output and formatting idempotency. */
export async function testFormatCode(source: string, expected: string): Promise<string> {
  const expectedText = `${Text.stripIndent(expected)}\n`
  const formatted = await formatterSession.formatCode(Text.stripIndent(source))

  Expect(formatted).toBe(expectedText)
  Expect(await formatterSession.formatCode(formatted)).toBe(expectedText)
  return formatted
}

/** formats returns a test callback that asserts canonical formatted source. */
export function formats(source: string, expected: string): () => Promise<string> {
  return async () => await testFormatCode(source, expected)
}

/** formatsUnchanged returns a test callback that asserts source is already canonical. */
export function formatsUnchanged(source: string): () => Promise<string> {
  return async () => await testFormatCode(source, source)
}
