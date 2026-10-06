import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('formatter: pick value expressions', () => {
  Test(
    'formats a predicate pick with its fallback',
    formats(
      'func Earlier(Left number,Right number)->number{return pick{Left<=Right->Left otherwise->Right}}',
      `
      func Earlier(Left number, Right number) -> number {
         return pick {
            Left <= Right -> Left
            otherwise -> Right
      }  }
    `,
    ),
  )

  Test(
    'formats an exhaustive subject pick with declared cases',
    formats(
      'type Phase is one of Draft,Published\nfunc Label(Value Phase)->text{return pick Value{Draft->"draft" Published->"published"}}',
      `
      type Phase is one of Draft, Published

      func Label(Value Phase) -> text {
         return pick Value {
            Draft -> "draft"
            Published -> "published"
      }  }
      `,
    ),
  )
})
