import { Describe, Test } from '@shared/test'
import { testFormatCode } from './test-format'

Describe('functional core formatter', () => {
  Test('formats functions, expressions, conditionals, and iteration deterministically', async () => {
    await testFormatCode(
      `function Label Count is number returns text=interpolate "Count: ",Count+1\nview Main{render Stack{if Count>0 and not false{Text Label(Count)}else{Text "Empty"}for Name in["Inbox" "Today"]{Text Name}}}`,
      `
        function Label Count is number returns text = interpolate "Count: ", Count + 1

        view Main {
           render Stack {
              if Count > 0 and not false {
                 Text Label(Count)
              } else {
                 Text "Empty"
              }
              for Name in ["Inbox" "Today"] {
                 Text Name
        }  }  }
      `,
    )
  })
})
