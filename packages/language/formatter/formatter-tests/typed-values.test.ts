import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('Tao formatter typed values', () => {
  Test(
    'formats ascriptions, typed lists, fields?, and bridged expressions',
    formats(
      `
        type Profile is{Subtitle text?,Name text}
        let Names is list of text=["Ada","Grace"]
        function Count(Value text)returns number{return Count(Value)from ./Text.ts}
      `,
      `
        type Profile is {
           Subtitle text?,
           Name text
        }

        let Names is list of text = ["Ada", "Grace"]

        function Count(Value text) returns number {
           return Count(Value) from ./Text.ts
        }
      `,
    ),
  )
})
