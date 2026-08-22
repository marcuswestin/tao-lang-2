import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('formatter: checkbox test expectations', () => {
  Test(
    'formats tag-only checked and unchecked assertions',
    formats(
      `test "Checkbox state"{test "checks state"{run CheckboxApp
expect   checkbox   #markFinal   checked
expect checkbox #marketingOptIn unchecked}}`,
      `
        test "Checkbox state" {
           test "checks state" {
              run CheckboxApp

              expect checkbox #markFinal checked
              expect checkbox #marketingOptIn unchecked
           }
        }
      `,
    ),
  )
})
