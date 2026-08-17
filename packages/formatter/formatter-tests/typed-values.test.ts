import { Describe, Test } from '@shared/test'
import { fence, formats, tsFence } from './test-format'

Describe('Tao formatter typed values', () => {
  Test(
    'formats ascriptions, typed lists, optional fields, and typed injections',
    formats(
      `
        type Profile is{optional Subtitle text,Name text}
        let Names is list of text=["Ada","Grace"]
        function Count(Value is text)returns number{return inject number Value ${tsFence}
        return Value.length
        ${fence}}
      `,
      `
        type Profile is {
           optional Subtitle text,
           Name text
        }

        let Names is list of text = ["Ada", "Grace"]

        function Count(Value is text) returns number {
           return inject number Value ${tsFence}
              return Value.length
           ${fence}
        }
      `,
    ),
  )
})
