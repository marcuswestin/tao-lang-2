import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('formatter: generic views', () => {
  Test(
    'keeps constrained type parameters before the ordinary input list',
    formats(
      `public view Rows where type T is Keyed and Displayed,type U is Keyed(Items list of T,Footer U)accepts slots @item(Value T,Ordinal number)from ./Rows.tsx`,
      `
      public
      view Rows where type T is Keyed and Displayed, type U is Keyed (Items list of T, Footer U) accepts slots @item(Value T, Ordinal number) from ./Rows.tsx
    `,
    ),
  )
})
