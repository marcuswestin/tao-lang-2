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

  Test(
    'indents and line-breaks an associated block that holds only actions',
    formats(
      'type Box is item with { action A() from ./x.ts\naction B(Value text) returns text from ./x.ts\nstatic action C() from ./x.ts\n}',
      `
      type Box is item with {
         action A() from ./x.ts
         action B(Value text) returns text from ./x.ts
         static action C() from ./x.ts
      }
    `,
    ),
  )

  Test(
    'keeps already indented associated actions in place',
    formats(
      `
      type Box is item with {
            action A() from ./x.ts
         action B() from ./x.ts
      }
    `,
      `
      type Box is item with {
         action A() from ./x.ts
         action B() from ./x.ts
      }
    `,
    ),
  )

  Test(
    'separates an associated action from an adjacent method by a blank line',
    formats(
      'type Box is item with {action A() from ./x.ts\nfunc Name() -> text {return "box"}\naction B() from ./x.ts}',
      `
      type Box is item with {
         action A() from ./x.ts

         func Name() -> text {
            return "box"
         }

         action B() from ./x.ts
      }
    `,
    ),
  )
})
