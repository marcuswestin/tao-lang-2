import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('associated actions formatter', () => {
  Test(
    'preserves singular and plural owner prefixes in entity action entries',
    formats(
      'data Books/Book{Title text,Returned yes / NotReturned no,action Book . Return ( ){update Book{Returned yes}},action Books . Return ( ){loop Books/Book{do Book . Return ( )}},} action Ordinary( ){ }',
      `
      data Books / Book {
         Title text,
         Returned yes / NotReturned no,
         action Book.Return() {
            update Book {
               Returned yes
            }
         },
         action Books.Return() {
            loop Books / Book {
               do Book.Return()
            }
         },
      }

      action Ordinary() { }
    `,
    ),
  )
})
