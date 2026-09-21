import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('formatter: async actions', () => {
  Test(
    'formats async blocks as ordinary indented action blocks',
    formats(
      'action Launch(){async{toggle Ready}toggle Ready}',
      `
        action Launch() {
           async {
              toggle Ready
           }
           toggle Ready
        }
      `,
    ),
  )
})
