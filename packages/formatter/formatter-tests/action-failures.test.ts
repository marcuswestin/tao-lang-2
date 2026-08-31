import { Describe, Expect, Test } from '@shared/test'
import Formatter from '../formatter-src/formatter'

Describe('formatter: action failures', () => {
  Test('formats native fail statements and foreign failure declarations', async () => {
    Expect(
      await Formatter.formatCode(
        'type SaveFailure is one of Offline\naction Save(){fail Offline"Could not save."}\naction Publish()runs latest fails Offline"Unavailable." from ./Api.ts',
      ),
    ).toBe(
      'type SaveFailure is one of Offline\n\naction Save() {\n   fail Offline "Could not save."\n}\n\naction Publish() runs latest fails Offline "Unavailable." from ./Api.ts\n',
    )
  })
})
