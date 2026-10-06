import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('operator methods and conversions formatter', () => {
  Test(
    'formats a nominal yes/no state shorthand',
    formats(
      `type GroupMode is yes/no\nscene Main{state GroupMode   no render "state"}`,
      `
      type GroupMode is yes/no

      scene Main {
         state GroupMode no
         render "state"
      }
    `,
    ),
  )
  Test(
    'formats static operator methods and keeps conversion precedence visible',
    formats(
      `type NumberBox is number with{static func +(Value number)->number{return Value}}
let Arithmetic=1+2as number
let Compared=1 as number<2+3 as number`,
      `
        type NumberBox is number with {
           static func +(Value number) -> number {
              return Value
           }
        }

        let Arithmetic = 1 + 2 as number
        let Compared = 1 as number < 2 + 3 as number
      `,
    ),
  )

  Test(
    'formats and roundtrips an associated converter body',
    formats(
      `type Source is number
type Target is text
type Convert is{Source as Target fails never{return Target("converted")}}`,
      `
        type Source is number

        type Target is text

        type Convert is {
           Source as Target fails never {
              return Target("converted")
        }  }
      `,
    ),
  )

  Test(
    'retains parentheses that separate a value reference from the following constructor slot',
    formats(
      `app Demo{id "com.tao.test.demo" version "1.0.0" name "Demo" Navigator(CustomStack) Datasource SnapshotStore{StorageKey "demo"}}`,
      `
        app Demo {
           id "com.tao.test.demo"
           version "1.0.0"
           name "Demo"
           Navigator (CustomStack)
           Datasource SnapshotStore {
              StorageKey "demo"
        }  }
      `,
    ),
  )
})
