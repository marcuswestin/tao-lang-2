import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('formatter: generic bindings', () => {
  Test(
    'formats conjunctive bounds and their following parameter lists canonically',
    formats(
      'func EarlierLabel where type T is Ordered and Display,type T2 is Other(Left T,Right T,Foo T2)->text{return ""}\nfunc Ordinary(Value text)->text{return Value}',
      `
        func EarlierLabel where type T is Ordered and Display, type T2 is Other (Left T, Right T, Foo T2) -> text {
           return ""
        }

        func Ordinary(Value text) -> text {
           return Value
        }
      `,
    ),
  )

  Test(
    'formats generic associated methods with a contextual Self bound',
    formats(
      'type Box is {func Keep where type T is Self(Value T)->T{return Value}}',
      `
        type Box is {
           func Keep where type T is Self (Value T) -> T {
              return Value
           }
        }
      `,
    ),
  )
})
