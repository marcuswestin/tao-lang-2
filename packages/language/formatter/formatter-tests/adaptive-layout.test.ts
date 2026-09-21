import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('formatter: adaptive layout', () => {
  Test(
    'formats width max as one readable layout clause',
    formats(
      `view MainView(){render Column()[width   max   720]}`,
      `
        view MainView() {
           render Column() [width max 720]
        }
      `,
    ),
  )
})
